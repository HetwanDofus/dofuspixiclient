import type { Fight } from "@modules/fight/core/fight.entity";
import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import { SpriteType } from "@dofus/proto/common_pb";
import {
  GameMovementSchema,
  GamePositionStartSchema,
  GameReadySchema,
  type GameSetPosition,
  GameSetPositionSchema,
  type GameSetReady,
  GameSetReadySchema,
  SpriteMovementEntrySchema,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { fighterColors } from "@features/game/fight-start/fight-start.shared";
import { PlacementState } from "@modules/fight/core/fight.states";
import { FightLifecycleService } from "@modules/fight/engine/fight.lifecycle.service";
import { FighterKind, StateName } from "@modules/fight/fight.types";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { Injectable } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

@Injectable()
export class FightPlacementHandler {
  constructor(
    readonly _sessions: SessionRegistry,
    private readonly frames: GatewayFrameService,
    private readonly fightRegistry: FightRegistryService,
    private readonly lifecycle: FightLifecycleService
  ) {}

  @MessageHandler(GameSetPositionSchema)
  handleSetPosition(ctx: HandlerContext, msg: GameSetPosition): void {
    const fight = this.fightRegistry.getBySession(ctx.sessionId);
    if (!fight || fight.state.name !== StateName.Placement) {
      return;
    }

    const placement = fight.state as PlacementState;
    const fighter = fight.fighters().find((f) => f.sessionId === ctx.sessionId);
    if (!fighter) {
      return;
    }

    if (!placement.move(fight, fighter, msg.cellNum)) {
      return;
    }

    // Broadcast updated position to all fight participants
    const targets = this.fightSessions(fight);
    this.frames.broadcast(
      targets,
      create(DofusMessageSchema, {
        payload: {
          case: "gameMovement",
          value: create(GameMovementSchema, {
            entries: [
              create(SpriteMovementEntrySchema, {
                operation: 3, // UPDATE
                spriteType: SpriteType.CHARACTER,
                spriteId: String(fighter.id),
                cellId: fighter.cell,
                // Without `direction` on this UPDATE the client falls
                // back to undefined → 0/SE (Sprite.as:59) and never
                // refreshes the placement-facing the engine just set.
                // Result: fighters during placement face their stale
                // roleplay direction; once the fight starts the engine
                // re-emits direction and they snap to the correct
                // SE/NW orientation.
                direction: fighter.direction,
                lp: fighter.lp,
                lpMax: fighter.lpMax,
                ap: fighter.ap,
                mp: fighter.mp,
                level: fighter.level,
                team: fighter.team?.side ?? 0,
                gfxId:
                  fighter.kind === FighterKind.Monster
                    ? fighter.monsterGfx
                    : (fighter.player?.gfx ?? 0),
                name: fighter.name,
                colors: fighterColors(fighter),
              }),
            ],
          }),
        },
      })
    );

    // Broadcast updated placement cells
    this.frames.broadcast(
      targets,
      create(DofusMessageSchema, {
        payload: {
          case: "gamePositionStart",
          value: create(GamePositionStartSchema, {
            team1Cells: fight.fightMap.teamCells[0],
            team2Cells: fight.fightMap.teamCells[1],
            currentTeam: fighter.team?.side ?? 0,
          }),
        },
      })
    );
  }

  @MessageHandler(GameSetReadySchema)
  handleSetReady(ctx: HandlerContext, msg: GameSetReady): void {
    const fight = this.fightRegistry.getBySession(ctx.sessionId);
    if (!fight || fight.state.name !== StateName.Placement) {
      return;
    }

    const placement = fight.state as PlacementState;
    const fighter = fight.fighters().find((f) => f.sessionId === ctx.sessionId);
    if (!fighter) {
      return;
    }

    placement.setReady(fighter, msg.ready);

    // Broadcast ready state
    const targets = this.fightSessions(fight);
    this.frames.broadcast(
      targets,
      create(DofusMessageSchema, {
        payload: {
          case: "gameReady",
          value: create(GameReadySchema, {
            isReady: fighter.ready,
            spriteId: String(fighter.id),
          }),
        },
      })
    );

    // Check if all fighters are ready → start fight
    if (fight.allReady()) {
      this.lifecycle.startFight(fight);
    }
  }

  private fightSessions(fight: Fight): string[] {
    return fight.allSessions();
  }
}
