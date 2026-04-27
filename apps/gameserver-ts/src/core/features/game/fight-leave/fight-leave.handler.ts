import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  type GameLeaveRequest,
  GameLeaveRequestSchema,
  GameLeaveSchema,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { StateName } from "@modules/fight/fight.types";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

@Injectable()
export class FightLeaveHandler {
  private readonly logger = new Logger(FightLeaveHandler.name);

  constructor(
    readonly _sessions: SessionRegistry,
    private readonly fightRegistry: FightRegistryService,
    private readonly frames: GatewayFrameService
  ) {}

  @MessageHandler(GameLeaveRequestSchema)
  handleLeave(ctx: HandlerContext, _msg: GameLeaveRequest): void {
    const fight = this.fightRegistry.getBySession(ctx.sessionId);
    if (!fight) {
      return;
    }

    const fighter = fight.fighters().find((f) => f.sessionId === ctx.sessionId);
    if (!fighter) {
      return;
    }

    // In Active state: end their turn
    if (fight.state.name === StateName.Active) {
      const runner = this.fightRegistry.getRunner(fight.id);
      if (runner) {
        runner.requestEnd(fighter.id);
      }
    }

    // In Placement state: just remove from the fight
    if (fight.state.name === StateName.Placement) {
      for (const team of fight.teams) {
        team.remove(fighter.id);
      }
    }

    // Broadcast leave frame to remaining fighters
    const targets = fight
      .fighters()
      .filter((f) => f.sessionId && f.sessionId !== ctx.sessionId)
      .map((f) => f.sessionId as string);

    if (targets.length > 0) {
      this.frames.broadcast(
        targets,
        create(DofusMessageSchema, {
          payload: {
            case: "gameLeave",
            value: create(GameLeaveSchema, {}),
          },
        })
      );
    }

    this.logger.log(`Fighter ${fighter.id} left fight ${fight.id}`);
  }
}
