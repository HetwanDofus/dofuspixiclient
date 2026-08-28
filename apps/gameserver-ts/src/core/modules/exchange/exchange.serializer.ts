import { Injectable } from "@nestjs/common";

/**
 * One thing at a time, per session.
 *
 * `GatewayFrameService.onFrame` dispatches without awaiting, so two
 * frames from one client are not serialised anywhere between the socket
 * and a handler — their `await`s interleave. Nothing at the gateway
 * de-duplicates or rate-limits either (QA-045, QA-064), so a double
 * click really does arrive as two concurrent moves.
 *
 * The database refuses to duplicate an item on its own — every write in
 * `ItemTransferService` carries its precondition — but "the second click
 * is refused with `not-enough`" is a worse answer than "the second click
 * finds the stack already gone and does nothing". This queue turns the
 * first into the second by making a session's operations run one after
 * another.
 *
 * Belt; the conditional updates are the braces. Neither is enough alone:
 * this queue is per process and would not survive two cores, and the
 * predicates alone leave the user-visible behaviour ragged.
 */
@Injectable()
export class ExchangeSerializer {
  private readonly tails = new Map<string, Promise<unknown>>();

  /**
   * Run `fn` after everything already queued for `sessionId`.
   *
   * A rejection is contained: the chain records completion, not outcome,
   * so one failed operation cannot wedge the session's queue.
   */
  runExclusive<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(sessionId) ?? Promise.resolve();
    const result = previous.then(fn, fn);

    const tail = result.then(
      () => undefined,
      () => undefined
    );

    this.tails.set(sessionId, tail);

    void tail.then(() => {
      // Only the newest tail owns the slot; an older one finishing must
      // not evict a queue that has since grown.
      if (this.tails.get(sessionId) === tail) {
        this.tails.delete(sessionId);
      }
    });

    return result;
  }

  /**
   * Drop a queue slot. Queued work still runs to completion.
   *
   * There is deliberately no restart sweep to go with this: a handoff
   * starts a **new process**, so a restored session arrives with an
   * empty queue map by construction. Only a close needs to clean up.
   */
  forget(sessionId: string): void {
    this.tails.delete(sessionId);
  }
}
