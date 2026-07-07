/**
 * Creature mode — the canonical big-crowd mechanism.
 *
 * When the live player count on a map crosses the `CreaturesMode`
 * threshold, every eligible player avatar swaps its body to the
 * generic per-breed creature clip `{breed}2.swf` (no accessories, no
 * mount, authored palette). Because at most 12 breeds exist, the
 * unique render-key set collapses from O(players) distinct looks to
 * ≤ 12 bodies × directions × frames — which is exactly how canonical
 * Dofus 1.29 keeps 100+-player maps renderable.
 *
 * Canonical sources:
 *   - ank/battlefield/SpriteHandler.as:605 `setCreatureMode(bEnabled)`
 *     — the per-sprite save/swap/restore sweep.
 *   - dofus/managers/GameManager.as:971 `applyCreatureMode()` — the
 *     threshold + hysteresis controller.
 *   - dofus/datacenter/Character.as:175 `canSwitchInCreaturesMode`
 *     — restriction bit 0x40 gate.
 *   - dofus/managers/OptionsManager.as:6 — the `CreaturesMode` option
 *     (canonical default 50).
 */

/**
 * localStorage key holding the `CreaturesMode` threshold (a number, or
 * `Infinity` to disable — mirroring the canonical option slider's
 * "infinite" stop, Options.as:557-560). Follows the repo's raw
 * localStorage option pattern (no central settings store).
 */
export const CREATURES_MODE_STORAGE_KEY = "creaturesMode";

/**
 * Default threshold. Canonical is 50 (OptionsManager.as:6
 * `CreaturesMode:50`) — tuned for 2006 Flash on 2006 hardware.
 * PRODUCT DECISION: this client sustains 60 fps with hundreds of
 * fully-dressed actors (validated 60fps@500, see
 * `feedback_battlefield_render_architecture`), so the deviation to
 * 300 keeps full looks on any realistically-populated map and lets
 * creature mode kick in only at genuine stress scale.
 */
export const CREATURES_MODE_DEFAULT_THRESHOLD = 300;

/**
 * Hysteresis width: mode turns ON at `count >= threshold` and OFF at
 * `count < threshold - CREATURES_MODE_HYSTERESIS`. Canonical uses −2
 * (GameManager.as:984 `if (count < threshold - 2)`) — at a 50-scale
 * threshold two leavers is meaningful churn, but at our 300-scale
 * default ±2 would flap the whole-map swap on every pair of map
 * joins/leaves, so the band widens to 10.
 */
export const CREATURES_MODE_HYSTERESIS = 10;

/**
 * Read the CreaturesMode threshold option. Accepts any finite number
 * plus `Infinity` (= never switch); anything unset / malformed falls
 * back to the default. Read on every apply — it's a couple of string
 * ops on roster-change frequency, and keeps the option live without a
 * store subscription (canonical OptionsManager.as:188 re-applies on
 * option change the same way).
 */
export function getCreaturesModeThreshold(): number {
  try {
    const raw = globalThis.localStorage?.getItem(CREATURES_MODE_STORAGE_KEY);
    if (raw == null || raw === "") {
      return CREATURES_MODE_DEFAULT_THRESHOLD;
    }
    const n = Number(raw);
    return Number.isNaN(n) ? CREATURES_MODE_DEFAULT_THRESHOLD : n;
  } catch {
    return CREATURES_MODE_DEFAULT_THRESHOLD;
  }
}

/**
 * Canonical Character.as:175-178:
 *   `return (this._nRestrictions & 0x40) != 64;`
 * Bit 0x40 SET means the GM restrictions forbid the creature swap.
 */
export function canSwitchInCreaturesMode(restrictions: number): boolean {
  return (restrictions & 0x40) !== 0x40;
}

/**
 * Map a player body gfxId to its breed's creature gfxId, or null when
 * the gfx isn't a player avatar body.
 *
 * Player bodies are `breed*10 + sex` (breed 1..12, sex 0/1 — e.g.
 * Feca male 10 / female 11). The creature clip is `breed*10 + 2`
 * (12.swf, 22.swf, … 122.swf — all 12 verified present under
 * assets/sources/clips/sprites/). Canonical builds the same path from
 * the sprite's breed field: SpriteHandler.as:628
 * `CLIPS_PERSOS_PATH + <breed> + "2.swf"` (the decompiler mislabels
 * the breed field `Guild`; CharactersManager.as:84 shows it's
 * `Number(oData.spriteType)`, i.e. the breed).
 *
 * The range gate doubles as the canonical class guards: NPCs (gfx
 * 9000+), monsters, and Mutants (monster gfx) all fall outside
 * breed 1..12 / sex 0..1, mirroring `instanceof Character &&
 * !(instanceof Mutant)` (SpriteHandler.as:614-619).
 */
export function creatureGfxIdFor(gfxId: number): number | null {
  const breed = Math.floor(gfxId / 10);
  const sex = gfxId % 10;
  if (breed < 1 || breed > 12 || sex > 1) {
    return null;
  }
  return breed * 10 + 2;
}

/**
 * Build the effective creature look for a player body gfxId, or null
 * when ineligible. No accessories, no colors:
 *
 *   - Accessories: canonical swaps the WHOLE gfx clip
 *     (SpriteHandler.as:629 setSpriteGfx) — the creature clip has no
 *     accessory attachment rig, so accessories vanish.
 *   - Colors: the -1 sentinel means "authored palette". The creature
 *     clips carry ZERO AS2 applyColor zones (verified offline:
 *     render-player-tinted on 12.swf reports "0 sprites tagged with
 *     applyColor zones" and all four test palettes rasterize
 *     identically — traces/creature12-tinted.png), so canonical
 *     player colors are a visual no-op on them. Using the sentinel
 *     instead of passing the (ignored) per-player colors keeps the
 *     render cache keys identical across players — which is the
 *     entire collapse mechanism.
 */
export function creatureLookFor(gfxId: number): string | null {
  const creatureGfx = creatureGfxIdFor(gfxId);
  if (creatureGfx === null) {
    return null;
  }
  return `${creatureGfx}|-1|-1|-1|`;
}
