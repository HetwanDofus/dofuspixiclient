import type { Serializable } from "@shared/handoff/handoff.coordinator";
import { Injectable, Logger } from "@nestjs/common";
import { HandoffPart } from "@shared/handoff/handoff-part.decorator";

// Tracks validated-but-not-yet-ACKed moves per session. A client must echo
// GameActionAck with the action_id for the server to commit the final cell
// and broadcast GameActionsFinish. Handoff-serialized so in-flight moves
// survive a restart without desynchronising.

export interface PendingMove {
  sessionId: string;
  characterId: string;
  actionId: number;
  mapId: number;
  endCell: number;
  endDirection: number;
  /**
   * The validated path, step by step. Only an interruption reads it:
   * `GKE` names a cell somewhere along the walk, and the server has to
   * check it really is on the path it authorised before committing it —
   * otherwise the cancel is a free teleport.
   *
   * Optional because a move restored from an older handoff snapshot has
   * no such list; those can still be acked normally, only interrupted
   * to the destination.
   */
  steps?: { cell: number; direction: number }[];
}

interface SerializedPending {
  nextActionId: number;
  moves: PendingMove[];
}

@Injectable()
@HandoffPart()
export class PendingMovesService implements Serializable<SerializedPending> {
  readonly name = "player-presence.pending-moves";

  private readonly logger = new Logger(PendingMovesService.name);
  private readonly bySession = new Map<string, PendingMove>();
  private nextActionId = 1;

  allocateActionId(): number {
    return this.nextActionId++;
  }

  set(move: PendingMove): void {
    this.bySession.set(move.sessionId, move);
  }

  take(sessionId: string): PendingMove | undefined {
    const move = this.bySession.get(sessionId);

    if (move) {
      this.bySession.delete(sessionId);
    }

    return move;
  }

  drop(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  serialize(): SerializedPending {
    return {
      nextActionId: this.nextActionId,
      moves: Array.from(this.bySession.values()),
    };
  }

  restore(state: SerializedPending): void {
    this.bySession.clear();
    this.nextActionId = state.nextActionId;

    for (const move of state.moves) {
      this.bySession.set(move.sessionId, move);
    }

    this.logger.log(
      `restored ${state.moves.length} pending move(s), nextActionId=${this.nextActionId}`
    );
  }
}
