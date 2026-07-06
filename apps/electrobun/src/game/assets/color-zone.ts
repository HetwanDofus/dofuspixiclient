/**
 * Canonical `GlobalSpriteHandler.getColorIndex` permutation table
 * (`GlobalSpriteHandler.as:75-309`), ported from wc3's
 * `game/world/actor/color_zone.rs`. For each known character / monster
 * `gfxId`, maps the wire colour slot (1 = head, 2 = body, 3 = bottom)
 * to the engine zone id baked into the SWF's `applyColor(N)` calls.
 *
 * Four canonical permutations:
 * - **A** `[3, 1, 2]` — head→3, body→1, bottom→2
 * - **B** `[2, 3, 1]` — head→2, body→3, bottom→1
 * - **C** `[1, 2, 3]` — identity (Cra)
 * - **D** `[1, 3, 2]` — head→1, body→3, bottom→2
 *
 * AS2 `switch` falls through to the first matching `case`; this is
 * load-bearing for `9235` which appears under both Group D (line 186)
 * and Group B (line 204) — first match wins, so it is Group D.
 *
 * Unknown `gfxId` → IDENTITY (wc3 deviation from canonical: canonical
 * `getColorIndex` returns -1 and the applyHead/Body/BottomColor family
 * no-ops, but wire-coloured monsters (e.g. the arakne) tint through the
 * direct `applyColor(N)` family which bypasses the table — identity
 * keeps those coloured, matching wc3's validated render).
 */

const GROUP_A = new Set([
  10, 11, 9224, 9225, 9248, 9249, 30, 31, 9228, 9229, 9252, 9253, 100, 9241,
  9266,
]);
// Listed BEFORE Group B so 9235 hits Group D first (canonical AS2
// first-match-wins).
const GROUP_D = new Set([
  61, 9235, 9259, 101, 9242, 9267, 120, 121, 8010, 8011, 1264, 7030, 7031,
  9245, 9246, 9247, 9270, 9271,
]);
const GROUP_B = new Set([
  20, 21, 9226, 9227, 9250, 9251, 40, 41, 9230, 9231, 9254, 9255, 50, 51,
  9232, 9233, 9256, 9257, 60, 9234, 9258, 70, 71, 80, 81, 9236, 9260, 9261,
  9237, 9238, 9262, 9263, 110, 111, 9243, 9244, 9268, 9269,
]);
const GROUP_C = new Set([90, 91, 9239, 9240, 9264, 9265]);

const PERM_A: readonly [number, number, number] = [3, 1, 2];
const PERM_B: readonly [number, number, number] = [2, 3, 1];
const PERM_C: readonly [number, number, number] = [1, 2, 3];
const PERM_D: readonly [number, number, number] = [1, 3, 2];

function permutationFor(
  gfxId: number,
): readonly [number, number, number] | null {
  if (GROUP_A.has(gfxId)) return PERM_A;
  if (GROUP_D.has(gfxId)) return PERM_D;
  if (GROUP_B.has(gfxId)) return PERM_B;
  if (GROUP_C.has(gfxId)) return PERM_C;
  return null;
}

/**
 * Redistribute wire-order colours `[c1, c2, c3]` (each 0xRRGGBB or -1 =
 * unset) into engine-zone order `[zone1, zone2, zone3]` per the
 * canonical permutation for `gfxId`. Unknown gfx → identity.
 */
export function wireColorsToZones(
  gfxId: number,
  wire: readonly [number, number, number],
): [number, number, number] {
  const perm = permutationFor(gfxId);
  if (!perm) return [wire[0], wire[1], wire[2]];
  const zones: [number, number, number] = [-1, -1, -1];
  for (let slot = 0; slot < 3; slot++) {
    zones[perm[slot] - 1] = wire[slot];
  }
  return zones;
}
