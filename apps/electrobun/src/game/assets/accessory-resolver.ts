/**
 * Accessory SWF resolver. Maps a parsed `(type, gfxId)` pair from a
 * look string to the bundle that contains the symbol "TYPE_GFXID".
 *
 * Layout in `assets/sources/clips/sprites/accessories/`:
 *   - `a1.swf`: type 16 (hats — exclusive)
 *   - `a2.swf`: types 1, 17
 *   - `a3.swf`: type 18
 *   - `a4.swf`: types 1-8, 19-22, 81, 82 (most weapons)
 *   - `a5.swf`: types 2, 6, 16, 17, 18, 82
 *   - `a6.swf`: types 6, 16, 17, 18, 82
 *   - `a7.swf`: types 16, 17, 18, 82
 *   - `a8.swf`: types 4, 7, 16, 17, 18, 19, 82
 *   - `accessories.swf`: type 4 only
 *   - `accessories_autres.swf`: types 1-8, 19-22, 81, 82
 *
 * Same `(type, gfxId)` symbol may exist in multiple bundles; we
 * probe in declaration order and cache the first hit. Bundle names
 * sent to the WASM `loadSwfBundle` are `acc-a1`, `acc-a2`, …,
 * `acc-default`, `acc-autres` so they don't collide with the
 * `sprite-N` naming used for character bundles.
 */
import {
  isSwfBundleLoaded,
  loadSwfBundle,
  swfAnimFrameCount,
} from "@/game/render/vello-loader";
import { createLogger } from "@/utils/logger";

const log = createLogger("AccessoryResolver");

interface BundleSpec {
  /** Name passed to loadSwfBundle / used in renderSwfStripRangeAccessorized. */
  name: string;
  /** URL to fetch the SWF from. */
  url: string;
}

const BUNDLES: readonly BundleSpec[] = [
  { name: "acc-a1", url: "/swf/sprites/accessories/a1.swf" },
  { name: "acc-a2", url: "/swf/sprites/accessories/a2.swf" },
  { name: "acc-a3", url: "/swf/sprites/accessories/a3.swf" },
  { name: "acc-a4", url: "/swf/sprites/accessories/a4.swf" },
  { name: "acc-a5", url: "/swf/sprites/accessories/a5.swf" },
  { name: "acc-a6", url: "/swf/sprites/accessories/a6.swf" },
  { name: "acc-a7", url: "/swf/sprites/accessories/a7.swf" },
  { name: "acc-a8", url: "/swf/sprites/accessories/a8.swf" },
  { name: "acc-default", url: "/swf/sprites/accessories/accessories.swf" },
  { name: "acc-autres", url: "/swf/sprites/accessories/accessories_autres.swf" },
];

/** `(type, gfxId)` → bundle name where the symbol was found. Cached forever. */
const resolutionCache = new Map<string, string | null>();
let bundlesLoaded = false;
let bundleLoadPromise: Promise<void> | null = null;

/**
 * Pre-load every accessory bundle. Idempotent. Should be called once
 * during boot (alongside the regular character bundle warmup) so the
 * renderer can resolve any `(type, gfxId)` synchronously after.
 */
export async function preloadAccessoryBundles(): Promise<void> {
  if (bundlesLoaded) return;
  if (bundleLoadPromise) return bundleLoadPromise;
  bundleLoadPromise = (async () => {
    await Promise.all(
      BUNDLES.map(async (b) => {
        if (isSwfBundleLoaded(b.name)) return;
        const ok = await loadSwfBundle(b.name, b.url);
        if (!ok) {
          log.warn(`failed to load accessory bundle ${b.name} from ${b.url}`);
        }
      })
    );
    bundlesLoaded = true;
  })();
  return bundleLoadPromise;
}

/**
 * Resolve `(type, gfxId)` to the bundle whose symbol "TYPE_GFXID"
 * exists. Returns null if no bundle has it. Bundles must be
 * preloaded before calling.
 */
export function resolveAccessoryBundle(
  type: number,
  gfxId: number
): string | null {
  const exportName = `${type}_${gfxId}`;
  const cacheKey = exportName;
  const cached = resolutionCache.get(cacheKey);
  if (cached !== undefined) return cached;

  for (const b of BUNDLES) {
    if (!isSwfBundleLoaded(b.name)) continue;
    if (swfAnimFrameCount(b.name, exportName) > 0) {
      resolutionCache.set(cacheKey, b.name);
      return b.name;
    }
  }
  resolutionCache.set(cacheKey, null);
  return null;
}

/**
 * Convert an accessory's positional index in the look string to its
 * AS2 mount slot. Per the canonical Dofus 1.29 AS2 source
 * (`GAC.applyAccessory(targetClip, slotIndex, frame)` in
 * `__Packages/.../battlefield/...as`): the AS2 `slotIndex` arg is
 * an INDEX INTO `spriteData.accessories[]`, and `spriteData.accessories
 * = lookAccessories` is a wholesale assignment (`_loc4_.accessories =
 * _SafeStr_857`). So the mapping is identity: `look[X] → slot X`.
 *
 *   look.accessories[0] = weapon  → slot 0
 *   look.accessories[1] = hat     → slot 1
 *   look.accessories[2] = cape    → slot 2
 *   look.accessories[3] = pet     → slot 3
 *   look.accessories[4] = shield  → slot 4
 *
 * Note: vanilla player SWFs (e.g. sprite 10) have NO `applyAccessory(0)`
 * call in their static structure — the weapon attachment is wired by
 * external AS2 at runtime via `attachMovie`. With this identity
 * mapping, weapon won't render via the static-mount path; that path
 * needs separate attach-by-name logic. Hat / cape / pet / shield all
 * have static mounts and will render correctly.
 */
export function lookIndexToMountSlot(lookIndex: number): number | null {
  if (lookIndex >= 0 && lookIndex <= 4) {
    return lookIndex;
  }
  return null;
}

/**
 * Given a character animation name (e.g. "staticR", "walkL", "anim1F"),
 * return the corresponding accessory frame index. Accessory SWFs
 * encode 5 directions × 3 sub-frames each:
 *   R=0..2, L=3..5, F=6..8, B=9..11, S=12..14
 *
 * For the per-character animation frame `charFrame` we cycle through
 * the 3 sub-frames of the right direction so an accessory animates
 * in lockstep with the body (e.g. cape sway during walking).
 */
export function accessoryFrameForAnim(
  animName: string,
  charFrame: number
): number {
  const lastChar = animName[animName.length - 1];
  let dirOffset: number;
  switch (lastChar) {
    case "R":
      dirOffset = 0;
      break;
    case "L":
      dirOffset = 3;
      break;
    case "F":
      dirOffset = 6;
      break;
    case "B":
      dirOffset = 9;
      break;
    case "S":
      dirOffset = 12;
      break;
    default:
      dirOffset = 0;
  }
  return dirOffset + (charFrame % 3);
}
