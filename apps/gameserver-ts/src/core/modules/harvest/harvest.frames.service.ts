import type { InteractiveFrameValue } from "@modules/harvest/harvest.constants";
import { create } from "@bufbuild/protobuf";
import {
  ActionHarvestSchema,
  FrameObjectEntrySchema,
  GameActionSchema,
  GameActionType,
  GameFrameObject2Schema,
} from "@dofus/proto/game_pb";
import { InfoMessageSchema } from "@dofus/proto/chat_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import {
  HARVEST_DENIAL_MESSAGES,
  InteractiveFrame,
} from "@modules/harvest/harvest.constants";
import { Injectable } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

/**
 * What the map sees while somebody harvests.
 *
 * Both frames go to **everyone on the map**, not to the actor alone. That is
 * not a nicety: the animation is how a bystander knows the tree is taken, and
 * `GDF` is the only thing that stops their client offering them the same
 * resource (QA-132).
 */
@Injectable()
export class HarvestFramesService {
  constructor(private readonly frames: GatewayFrameService) {}

  /**
   * `GA;501` — "this sprite is working on that cell for that long".
   *
   * The duration is the server's own figure and the client counts it down
   * rather than recomputing it; that is what keeps a client that has guessed
   * a shorter action from being right about it.
   */
  sendAction(
    sessionIds: readonly string[],
    spriteId: string,
    cellId: number,
    durationMs: number
  ): void {
    if (sessionIds.length === 0) {
      return;
    }

    this.frames.broadcast(
      sessionIds,
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: 0,
            actionType: GameActionType.ACTION_HARVEST,
            spriteId,
            rawParams: `${cellId},${durationMs}`,
            actionData: {
              case: "harvest",
              value: create(ActionHarvestSchema, {
                cellId,
                durationMs,
                animId: 0,
              }),
            },
          }),
        },
      })
    );
  }

  /**
   * `Im` — why nothing happened.
   *
   * The refusal goes to the actor alone, and it is the only thing that
   * distinguishes "you have no axe" from "the game is broken" for somebody
   * standing in front of a tree. `InfoMessage` was typed and had no
   * producer until this.
   */
  sendRefusal(sessionId: string, reason: string): void {
    const message = HARVEST_DENIAL_MESSAGES[reason];

    if (!message) {
      return;
    }

    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "infoMessage",
          value: create(InfoMessageSchema, { message }),
        },
      })
    );
  }

  /** `GDF` — one or more cells changing frame. */
  sendFrames(
    sessionIds: readonly string[],
    entries: readonly { cellId: number; frame: InteractiveFrameValue }[]
  ): void {
    if (sessionIds.length === 0 || entries.length === 0) {
      return;
    }

    this.frames.broadcast(
      sessionIds,
      create(DofusMessageSchema, {
        payload: {
          case: "gameFrameObject2",
          value: create(GameFrameObject2Schema, {
            entries: entries.map((entry) =>
              create(FrameObjectEntrySchema, {
                cellId: entry.cellId,
                frame: entry.frame,
                // A resource is only clickable in its resting frame. The
                // 1.29 client uses this flag alone to decide, so a depleted
                // cell has to say `false` rather than simply change frame.
                interactive: entry.frame === InteractiveFrame.Ready,
              })
            ),
          }),
        },
      })
    );
  }

  /** Shorthand for the one-cell case, which is every case but the map join. */
  sendFrame(
    sessionIds: readonly string[],
    cellId: number,
    frame: InteractiveFrameValue
  ): void {
    this.sendFrames(sessionIds, [{ cellId, frame }]);
  }
}
