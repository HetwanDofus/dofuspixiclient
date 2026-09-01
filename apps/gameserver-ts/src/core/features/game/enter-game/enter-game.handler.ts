import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import { DialogLeaveSchema } from "@dofus/proto/chat_pb";
import {
  type GameCreateRequest,
  GameCreateRequestSchema,
  GameCreateSchema,
  GameMovementSchema,
  type SpriteMovementEntry,
  SpriteMovementEntry_Operation,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { SpellListSchema } from "@dofus/proto/spells_pb";
import { AccessoriesService } from "@modules/inventory/accessories.service";
import { InventoryFramesService } from "@modules/inventory/inventory.frames.service";
import { JobsService } from "@modules/jobs/jobs.service";
import { buildMapData } from "@modules/maps/maps.build-data";
import { MapsRepository } from "@modules/maps/maps.repository";
import { MapMonsterService } from "@modules/monsters/map-monster.service";
import { monsterGroupToSpriteEntry } from "@modules/monsters/map-monster.sprite-entry";
import { MapNpcService } from "@modules/npcs/map-npc.service";
import { npcToSpriteEntry } from "@modules/npcs/map-npc.sprite-entry";
import { NpcDialogSessionService } from "@modules/npcs/npc-dialog.session";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { toSpriteEntry } from "@modules/player-presence/player-presence.sprite-entry";
import { PlayersProgressionService } from "@modules/players/players.progression.service";
import { PlayersRepository } from "@modules/players/players.repository";
import { ShortcutsFramesService } from "@modules/shortcuts/shortcuts.frames.service";
import { SpellsService } from "@modules/spells/spells.service";
import { StatsService } from "@modules/stats/stats.service";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

const DEFAULT_COLOR = -1;

@Injectable()
export class EnterGameHandler {
  private readonly logger = new Logger(EnterGameHandler.name);

  constructor(
    private readonly players: PlayersRepository,
    private readonly progression: PlayersProgressionService,
    private readonly maps: MapsRepository,
    private readonly mapMonsters: MapMonsterService,
    private readonly mapNpcs: MapNpcService,
    private readonly npcDialogs: NpcDialogSessionService,
    private readonly presence: PlayerPresenceService,
    private readonly sessions: SessionRegistry,
    private readonly frames: GatewayFrameService,
    private readonly stats: StatsService,
    private readonly spells: SpellsService,
    private readonly accessories: AccessoriesService,
    private readonly items: InventoryFramesService,
    private readonly jobs: JobsService,
    private readonly shortcuts: ShortcutsFramesService
  ) {}

  @MessageHandler(GameCreateRequestSchema)
  async handle(ctx: HandlerContext, msg: GameCreateRequest): Promise<void> {
    const session = this.sessions.get(ctx.sessionId);

    if (!session?.characterId) {
      this.logger.warn(`enter-game: no character on session=${ctx.sessionId}`);
      return this.reject(ctx, msg.type);
    }

    const player = await this.players.loadPresence(session.characterId);

    if (!player) {
      this.logger.warn(
        `enter-game: player not found id=${session.characterId}`
      );
      return this.reject(ctx, msg.type);
    }

    const map = await this.maps.findById(player.mapId);

    if (!map) {
      this.logger.warn(`enter-game: map not found id=${player.mapId}`);
      return this.reject(ctx, msg.type);
    }

    const tStart = performance.now();
    const accessories = await this.accessories.buildPresence(player.id);
    const tAcc = performance.now();

    const entering = {
      sessionId: ctx.sessionId,
      characterId: player.id,
      mapId: player.mapId,
      cellId: player.cellId,
      direction: player.direction,
      name: player.name,
      level: player.level,
      sex: player.sex,
      gfx: player.gfx,
      color1: player.color1 ?? DEFAULT_COLOR,
      color2: player.color2 ?? DEFAULT_COLOR,
      color3: player.color3 ?? DEFAULT_COLOR,
      accessories,
    };

    const peers = this.presence.sessionsOnMap(player.mapId, player.id);
    const existing = this.presence.onMap(player.mapId);

    this.presence.enter(entering);

    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "gameCreate",
          value: create(GameCreateSchema, { success: true, state: msg.type }),
        },
      })
    );

    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: { case: "gameMapData", value: buildMapData(map) },
      })
    );

    await this.stats.sendStats(ctx.sessionId, session.characterId);
    const tStats = performance.now();

    // Without this, an item looted in one session is invisible in the
    // next: it sits in `player_items` and the client's inventory store
    // is never told it exists, which reads exactly like the loot never
    // worked. The server emitted no `item*` frame at all before QA-060.
    await this.items.sendInventory(ctx.sessionId, session.characterId);
    // The client only ever learns a template id from `ItemData.item_id`;
    // this is what resolves it to a name, description, icon and legal
    // equip positions, same as `sendInventory` above must precede it.
    await this.items.sendTemplatesForPlayer(ctx.sessionId, session.characterId);
    // Item shortcuts are replayed as one OrA per slot — 1.29 has no bulk
    // frame for them. Must follow the templates above: the client needs
    // the template to draw the icon the shortcut points at.
    await this.shortcuts.sendAll(ctx.sessionId, session.characterId);

    // `JS` then `JX`, which is the order the 1.29 client needs: `onSkills`
    // constructs the `Job` objects and `onXP` only updates ones it can find
    // by id. Must follow the inventory, because the harvest actions the
    // client will offer are gated on the tool it can see equipped.
    await this.jobs.pushAll(ctx.sessionId, session.characterId);

    // Catch-up before the snapshot is built, so a character whose level
    // was raised outside a fight — by hand in SQL, which is how every
    // character in this project has ever levelled — walks in with the
    // spells that level unlocks instead of a book frozen at creation.
    // A no-op once the book is complete.
    await this.progression.syncSpellBook(session.characterId);

    const spellData = await this.spells.buildSpellList(session.characterId);
    const tSpells = performance.now();
    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "spellList",
          value: create(SpellListSchema, { spells: spellData }),
        },
      })
    );

    const selfAdd = toSpriteEntry(entering, SpriteMovementEntry_Operation.ADD);
    let monsterEntries: SpriteMovementEntry[] = [];
    try {
      const monsterGroups = await this.mapMonsters.ensureSpawned(player.mapId);
      monsterEntries = monsterGroups.map(monsterGroupToSpriteEntry);
    } catch (err) {
      this.logger.error(
        `failed to spawn monsters on map=${player.mapId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const tMonsters = performance.now();

    // NPCs are static furniture: no spawn roll, just the map's placements.
    // Same defensive shape as the monsters above — a map whose NPC rows are
    // broken must still let the player in.
    // Every map change comes back through here, and an open dialog pins an
    // NPC the player may no longer be standing next to — or on the same map
    // as. Closing silently is not enough: the client would keep the window up
    // with no way to dismiss it, because its own DV would then answer nothing.
    if (this.npcDialogs.close(ctx.sessionId)) {
      this.frames.broadcast(
        [ctx.sessionId],
        create(DofusMessageSchema, {
          payload: {
            case: "dialogLeave",
            value: create(DialogLeaveSchema, {}),
          },
        })
      );
    }

    let npcEntries: SpriteMovementEntry[] = [];
    try {
      const npcs = await this.mapNpcs.onMap(player.mapId);
      npcEntries = npcs.map((npc) => npcToSpriteEntry(npc));
    } catch (err) {
      this.logger.error(
        `failed to resolve NPCs on map=${player.mapId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const tNpcs = performance.now();

    this.logger.log(
      `enter-game timing: acc=${(tAcc - tStart).toFixed(0)}ms ` +
        `stats=${(tStats - tAcc).toFixed(0)}ms ` +
        `spells=${(tSpells - tStats).toFixed(0)}ms ` +
        `monsters=${(tMonsters - tSpells).toFixed(0)}ms ` +
        `npcs=${(tNpcs - tMonsters).toFixed(0)}ms ` +
        `total=${(tNpcs - tStart).toFixed(0)}ms (accs=${accessories.length})`
    );

    this.logger.log(
      `sending GM: self=${entering.characterId} cell=${entering.cellId} gfx=${entering.gfx} + ${existing.length} peers + ${monsterEntries.length} monster groups + ${npcEntries.length} NPCs`
    );

    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "gameMovement",
          value: create(GameMovementSchema, {
            entries: [
              ...existing.map((p) =>
                toSpriteEntry(p, SpriteMovementEntry_Operation.ADD)
              ),
              selfAdd,
              ...monsterEntries,
              ...npcEntries,
            ],
          }),
        },
      })
    );

    if (peers.length > 0) {
      this.frames.broadcast(
        peers,
        create(DofusMessageSchema, {
          payload: {
            case: "gameMovement",
            value: create(GameMovementSchema, { entries: [selfAdd] }),
          },
        })
      );
    }

    this.logger.log(
      `enter-game: character=${session.characterId} map=${map.id} peers=${peers.length}`
    );
  }

  private reject(ctx: HandlerContext, state: number): void {
    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "gameCreate",
          value: create(GameCreateSchema, { success: false, state }),
        },
      })
    );
  }
}
