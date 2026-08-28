import { create } from "@bufbuild/protobuf";
import { ExchangeType } from "@dofus/proto/common_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { StorageInformationsSchema } from "@dofus/proto/world_pb";
import { ExchangeService } from "@modules/exchange/exchange.service";
import {
  BANK_SLOTS,
  DEFAULT_LANDING_DIRECTION,
  HOUSE_STORAGE_SLOTS,
  InteractiveSkill,
} from "@modules/interactive-objects/interactive-objects.constants";
import { InteractiveObjectsRepository } from "@modules/interactive-objects/interactive-objects.repository";
import { bankOwner, houseOwner } from "@modules/items/item-owner";
import { MapCacheService } from "@modules/maps/maps.cache.service";
import { MapTransitionService } from "@modules/maps/maps.transition.service";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { WaypointsService } from "@modules/waypoints/waypoints.service";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

/**
 * `GA;500;<cellId>;<skillId>` — the canonical 1.29 "use the interactive
 * element on this cell" action (`GameManager.useRessource`).
 *
 * The client is never trusted with *what* it clicked: it names a cell and a
 * skill, and everything else is re-derived here from the map's own cell data.
 * A cell only carries an element when its `layerObject2Interactive` bit is
 * armed — the same gfx is decoration elsewhere on the map — and a skill is
 * only accepted when the element's own template lists it. That is the same
 * shape of check as `validatePath`'s adjacency test: the request says where,
 * the server decides whether.
 */
@Injectable()
export class InteractiveObjectsService {
  private readonly logger = new Logger(InteractiveObjectsService.name);

  constructor(
    private readonly repo: InteractiveObjectsRepository,
    private readonly mapCache: MapCacheService,
    private readonly presence: PlayerPresenceService,
    private readonly transition: MapTransitionService,
    private readonly waypoints: WaypointsService,
    private readonly exchange: ExchangeService,
    private readonly frames: GatewayFrameService
  ) {}

  async use(
    sessionId: string,
    accountId: string,
    characterId: string,
    cellId: number,
    skillId: number
  ): Promise<void> {
    const placed = this.presence.getByCharacter(characterId);

    if (!placed) {
      return;
    }

    const map = await this.mapCache.load(placed.mapId);
    const cell = map?.cells[cellId];

    if (!cell?.layerObject2Interactive || cell.layer2 === 0) {
      this.logger.warn(
        `interactive-use: map=${placed.mapId} cell=${cellId} carries no element`
      );
      return;
    }

    const template = await this.repo.findTemplate(cell.layer2);

    if (!template) {
      this.logger.warn(
        `interactive-use: no template for gfx=${cell.layer2} (map=${placed.mapId} cell=${cellId})`
      );
      return;
    }

    const offered = template.skills
      .split(",")
      .map((s) => Number.parseInt(s, 10));

    if (!offered.includes(skillId)) {
      this.logger.warn(
        `interactive-use: skill=${skillId} not offered by "${template.name}" (gfx=${cell.layer2})`
      );
      return;
    }

    switch (skillId) {
      case InteractiveSkill.EnterHouse:
        await this.enterHouse(sessionId, characterId, placed.mapId, cellId);
        return;
      case InteractiveSkill.UseZaap:
        await this.waypoints.openZaapMenu(sessionId, characterId);
        return;
      case InteractiveSkill.OpenStorage:
        await this.openStorage(sessionId, accountId, characterId, placed.mapId);
        return;
      default:
        this.logger.log(
          `interactive-use: skill=${skillId} on "${template.name}" not implemented`
        );
    }
  }

  private async enterHouse(
    sessionId: string,
    characterId: string,
    mapId: number,
    cellId: number
  ): Promise<void> {
    const house = await this.repo.findHouseByDoor(mapId, cellId);

    if (!house) {
      this.logger.warn(
        `interactive-use: no house registered at map=${mapId} cell=${cellId}`
      );
      return;
    }

    // About a fifth of the houses have no exit anywhere in the retail dump, so
    // the importer left them without an entry rather than sealing a player
    // inside one — see `scripts/import-starloco-triggers.ts`.
    if (house.entryMapId === null || house.entryCellId === null) {
      this.logger.log(
        `interactive-use: house=${house.id} has no importable interior, staying shut`
      );
      return;
    }

    await this.transition.teleport(
      sessionId,
      characterId,
      house.entryMapId,
      house.entryCellId,
      DEFAULT_LANDING_DIRECTION
    );
  }

  /**
   * "Ouvrir" on a chest. The same sprite is a house's own storage indoors
   * and the account bank in a bank building, told apart by whether the
   * map belongs to a house.
   *
   * Two things go out, and the order matters. `sI` announces the
   * storage's size — that is all it has ever meant in 1.29. The contents
   * and every later movement are the exchange protocol, opened here
   * rather than on a client request: the 1.29 client has no code path
   * that sends `ER` for a storage, so the server is the only thing that
   * can start one. See QA-086.
   */
  private async openStorage(
    sessionId: string,
    accountId: string,
    characterId: string,
    mapId: number
  ): Promise<void> {
    const house = await this.repo.findHouseByInteriorMap(mapId);

    const owner = house ? houseOwner(house.id) : bankOwner(accountId);
    const totalSlots = house ? HOUSE_STORAGE_SLOTS : BANK_SLOTS;
    const usedSlots = await this.repo.countStacks(owner);

    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "storageInformations",
          value: create(StorageInformationsSchema, { totalSlots, usedSlots }),
        },
      })
    );

    await this.exchange.openStorage(
      sessionId,
      accountId,
      characterId,
      owner,
      ExchangeType.EXCHANGE_STORAGE
    );
  }
}
