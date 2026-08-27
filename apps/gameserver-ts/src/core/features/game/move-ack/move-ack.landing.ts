import type { PendingMove } from "@modules/player-presence/player-presence.pending-moves.service";

/** Where a move ended, and which cell the character faces there. */
export interface MoveLanding {
  cell: number;
  direction: number;
  /**
   * The cell the client claimed to have stopped on when that claim was
   * refused, for the caller to log. `null` on any accepted ack.
   */
  refusedClaim: string | null;
}

/**
 * Resolve the cell a move actually ended on from the ack that closed it.
 *
 * `GKK` (`is_ack`) means the walk played out to the destination the
 * server validated. `GKE` is the 1.29 cancel: the player cut the walk
 * short — by clicking somewhere else — and names the cell they stopped
 * on.
 *
 * A claimed cell is honoured only if it is one of the steps of this very
 * move. Every one of those was checked for adjacency and walkability
 * when the path was validated, so committing one is always legal;
 * accepting anything else would turn a cancel into a free teleport.
 * A claim that fails falls back to the destination — exactly what a
 * plain ack would have committed — rather than dropping the move and
 * leaving the character stuck on a cell the client has already left.
 */
export function resolveMoveLanding(
  move: Pick<PendingMove, "endCell" | "endDirection" | "steps">,
  ack: { isAck: boolean; cancelParams: string }
): MoveLanding {
  if (ack.isAck) {
    return {
      cell: move.endCell,
      direction: move.endDirection,
      refusedClaim: null,
    };
  }

  const claimed = Number.parseInt(ack.cancelParams, 10);
  const step = Number.isNaN(claimed)
    ? undefined
    : move.steps?.find((s) => s.cell === claimed);

  if (!step) {
    return {
      cell: move.endCell,
      direction: move.endDirection,
      refusedClaim: ack.cancelParams,
    };
  }

  return { cell: step.cell, direction: step.direction, refusedClaim: null };
}
