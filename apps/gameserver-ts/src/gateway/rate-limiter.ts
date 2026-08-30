/**
 * A fixed-window counter, in memory, per key.
 *
 * Deliberately not a distributed limiter: the only thing behind it is the
 * admin provisioning route, one gateway process owns the socket, and the
 * point is to stop a stuck retry loop from hammering postgres — not to
 * enforce a quota across a fleet.
 */
export class FixedWindowLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number
  ) {}

  /** True when the call is allowed, and counts it. */
  take(key: string, now = Date.now()): boolean {
    this.prune(now);

    const window = this.hits.get(key);

    if (!window || window.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });

      return true;
    }

    if (window.count >= this.max) {
      return false;
    }

    window.count += 1;

    return true;
  }

  private prune(now: number): void {
    for (const [key, window] of this.hits) {
      if (window.resetAt <= now) {
        this.hits.delete(key);
      }
    }
  }
}
