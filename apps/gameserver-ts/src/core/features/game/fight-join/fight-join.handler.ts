import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import { SpriteType } from "@dofus/proto/common_pb";
import {
  type GameActionRequest,
  GameActionRequestSchema,
  GameMovementSchema,
  SpriteMovementEntrySchema,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { Fighter } from "@modules/fight/core/fight.fighter";
import { StateName } from "@modules/fight/fight.types";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { PlayersRepository } from "@modules/players/players.repository";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

@Injectable()
export class FightJoinHandler {
  private readonly logger = new Logger(FightJoinHandler.name);

  constructor(
    private readonly sessions: SessionRegistry,
    private readonly presence: PlayerPresenceService,
    private readonly frames: GatewayFrameService,
    private readonly fightRegistry: FightRegistryService,
    private readonly players: PlayersRepository
  ) {}

  @MessageHandler(GameActionRequestSchema)
  async handleJoinFight(
    ctx: HandlerContext,
    msg: GameActionRequest
  ): Promise<void> {
    if (msg.actionType !== 903) {
      return;
    }

    const fightId = Number.parseInt(msg.params, 10);
    if (Number.isNaN(fightId)) {
      return;
    }

    const fight = this.fightRegistry.getById(fightId);
    if (!fight || fight.state.name !== StateName.Placement) {
      return;
    }

    if (this.fightRegistry.isInFight(ctx.sessionId)) {
      return;
    }

    const session = this.sessions.get(ctx.sessionId);
    if (!session?.characterId) {
      return;
    }

    const player = this.presence.getByCharacter(session.characterId);
    if (!player) {
      return;
    }

    // Load player data
    const playerData = await this.players.findById(session.characterId);
    const stats = await this.players.findStats(session.characterId);
    if (!playerData) {
      return;
    }

    // Create fighter from player
    const fighter = Fighter.fromPlayer(ctx.sessionId, {
      id: Number(session.characterId),
      name: player.name,
      level: player.level,
      life: playerData.life,
      sex: player.sex,
      gfx: player.gfx,
      direction: player.direction,
      stats: {
        strength: stats?.strength ?? 0,
        vitality: stats?.vitality ?? 0,
        wisdom: stats?.wisdom ?? 0,
        intelligence: stats?.intelligence ?? 0,
        chance: stats?.chance ?? 0,
        agility: stats?.agility ?? 0,
      },
    });

    // Add to first team (0)
    fight.teams[0].add(fighter);
    this.fightRegistry.registerSession(ctx.sessionId, fight.id);

    // Assign placement cell
    const cells = fight.fightMap.teamCells[0];
    let cellAssigned = false;
    for (const cell of cells) {
      if (fight.fightMap.isFree(cell)) {
        fighter.cell = cell;
        fight.fightMap.occupy(cell, fighter.id);
        cellAssigned = true;
        break;
      }
    }

    if (!cellAssigned) {
      // No free cell, cannot join
      this.fightRegistry.unregisterSession(ctx.sessionId);
      fight.teams[0].remove(fighter.id);
      return;
    }

    // Broadcast new fighter to existing participants
    const targets = fight.allSessions();
    this.frames.broadcast(
      targets,
      create(DofusMessageSchema, {
        payload: {
          case: "gameMovement",
          value: create(GameMovementSchema, {
            entries: [
              create(SpriteMovementEntrySchema, {
                operation: 0, // ADD
                spriteType: SpriteType.CHARACTER,
                spriteId: String(fighter.id),
                cellId: fighter.cell,
                direction: fighter.direction,
                name: fighter.name,
                level: fighter.level,
                gfxId: fighter.player?.gfx ?? 0,
                scaleX: 100,
                scaleY: 100,
              }),
            ],
          }),
        },
      })
    );

    this.logger.log(
      `Fighter ${fighter.id} (${fighter.name}) joined fight ${fight.id}`
    );
  }
}
