/**
 * What a harvest sounds like, per gathering job.
 *
 * 1.29 has no harvest sound *event*: `GA;501` only loops the tool animation
 * (`GameActionsEx.as:210-226` — `setSpriteLoopAnim`), and what you hear comes
 * from the clips themselves, each calling `_root.SOMA.playSound(<linkname>)`
 * on the frame that needs it. Fishing is the one job that got the treatment:
 * every fishing spot (gfx 7529-7549) plays `flotteur` when it is taken and
 * `fish_out` when it gives, and the character's own `anim18End` plays `fish`.
 * The axe animation (`anim17`, worn by every axe, pickaxe and scythe) carries
 * none, and neither does any tree — cutting one is silent in retail.
 *
 * So this table extends 1.29 rather than reproducing it, and it does so with
 * 1.29's own sounds: the effects are the ones the retail bundle ships, named
 * by the same linkage names the clips use, and fishing keeps the pair the
 * fishing spots themselves play. See `doc/issues/audio/QA-147-…`, which
 * records what 1.29 does and does not do here.
 */
export interface HarvestSounds {
  /** Fires once per swing, on the frame the tool animation lands its blow. */
  work: string;
  /** Fires once, when the resource gives — the tree falling, the fish out. */
  done: string;
}

/** Job id → sounds. Keyed by `SK[skill].j`, the skill's own job. */
const BY_JOB: ReadonlyMap<number, HarvestSounds> = new Map([
  // Bûcheron — the axe, then the trunk giving way.
  [2, { work: "hache_2m", done: "cassage_bois" }],
  // Mineur — the pick, then the vein breaking open.
  [24, { work: "pic", done: "impact_lourd" }],
  // Alchimiste — a plant pulled by hand.
  [26, { work: "herbe", done: "feuillage" }],
  // Paysan — the scythe through the stalks.
  [28, { work: "herbe", done: "feuillage2" }],
  // Pêcheur — the float, then the catch. Both are what the spot plays.
  [36, { work: "flotteur", done: "fish_out" }],
]);

/** The sounds a job's harvest makes, or null for a job that has none. */
export function harvestSoundsFor(jobId: number): HarvestSounds | null {
  return BY_JOB.get(jobId) ?? null;
}
