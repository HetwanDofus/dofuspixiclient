/**
 * Out-of-combat life regeneration, derived from a timestamp.
 *
 * There is no timer here, and that is the whole design. A per-player
 * interval would not scale past a few hundred connections, would be lost
 * every time the core restarts (which it does on every file save, in
 * watch mode), and would regenerate nothing while a player is offline —
 * whereas a 1.29 character heals while logged out, which is most of how
 * anyone ever gets back to full life.
 *
 * Instead `players.life_updated_at` records when life was last exact,
 * and every read of a character's life resolves it forward. The cost is
 * zero background work and the behaviour survives anything.
 */

/**
 * Milliseconds of real time per life point regained while standing.
 *
 * 1.29 heals a standing character slowly and a seated one much faster —
 * sitting down is the actual mechanic players use between fights.
 */
export const REGEN_MS_PER_LIFE_STANDING = 2_000;

/**
 * Seated regeneration is four times faster.
 *
 * Declared, documented, and deliberately unused: there is no sit-down
 * emote anywhere in the server (no emote slice exists at all), so there
 * is nothing that could set a character's posture. Inventing one here
 * would be a feature smuggled into a bug fix. When the emote lands, this
 * is the constant it reaches for.
 */
export const REGEN_SEATED_MULTIPLIER = 4;

export interface ResolvedLife {
  /** Life after applying everything owed since `lifeUpdatedAt`. */
  life: number;
  /**
   * The instant to record as the new `life_updated_at`.
   *
   * Deliberately not "now": it is advanced by exactly the whole points
   * granted, so the leftover fraction of a period carries over to the
   * next read. Stamping `now` instead would throw that remainder away
   * every time, and a client that asks for its stats often — the
   * character sheet refreshes on every equipment change — would
   * regenerate slower the more it looked, or never at all.
   */
  lifeUpdatedAt: Date;
  /**
   * Whether this differs from what the database holds, i.e. whether the
   * caller needs to write it back. False for a character already at full
   * life, or one whose elapsed time is not yet worth a single point —
   * both cases must not produce a write, or every stats frame would
   * issue a pointless UPDATE.
   */
  changed: boolean;
}

export interface LifeRegenInput {
  /** Current life as stored. */
  life: number;
  /**
   * Maximum life, from `maxLifePoints(level, totalVitality)`. Never a
   * column — there is none — so that a gear change moves the cap with it
   * instead of letting a stale maximum drift above the real one.
   */
  maxLife: number;
  /** When life was last exact; null for a character never measured. */
  lifeUpdatedAt: Date | null;
  /** Now, injectable so the tests do not have to wait two seconds. */
  now?: number;
}

/**
 * Resolve a character's life forward to now.
 *
 * A character at or above their cap is clamped down to it: the cap is
 * derived, so unequipping a vitality item legitimately leaves current
 * life above maximum, and that must resolve rather than persist.
 *
 * A character who has never been measured (`lifeUpdatedAt` null) regains
 * nothing — we cannot know how long they have been waiting — but is
 * still reported as changed so the timestamp gets stamped and the next
 * read has a baseline.
 */
export function resolveLife(input: LifeRegenInput): ResolvedLife {
  const { life, maxLife } = input;
  const now = input.now ?? Date.now();
  // Normalised rather than trusted: the column is nullable, and a row
  // that reached us from anywhere but a fresh SELECT (a handoff restore,
  // a test fixture) can be missing it outright.
  const stampedAt = input.lifeUpdatedAt ?? null;

  if (life >= maxLife) {
    return {
      life: maxLife,
      lifeUpdatedAt: new Date(now),
      changed: life !== maxLife,
    };
  }

  if (stampedAt === null) {
    return { life, lifeUpdatedAt: new Date(now), changed: true };
  }

  const elapsedMs = now - stampedAt.getTime();

  // A clock that went backwards (NTP correction, a restored handoff
  // snapshot) must not remove life.
  if (elapsedMs <= 0) {
    return { life, lifeUpdatedAt: stampedAt, changed: false };
  }

  const regained = Math.floor(elapsedMs / REGEN_MS_PER_LIFE_STANDING);

  if (regained <= 0) {
    return { life, lifeUpdatedAt: stampedAt, changed: false };
  }

  const resolved = Math.min(maxLife, life + regained);

  // Advance by the points actually granted, not to `now`. When the cap
  // truncates the grant, the surplus time is dropped with it — a
  // character sitting at full life has no credit to bank.
  const granted = resolved - life;
  const consumedMs =
    resolved === maxLife ? elapsedMs : granted * REGEN_MS_PER_LIFE_STANDING;

  return {
    life: resolved,
    lifeUpdatedAt: new Date(stampedAt.getTime() + consumedMs),
    changed: true,
  };
}
