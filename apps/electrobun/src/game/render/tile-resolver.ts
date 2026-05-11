/**
 * Standalone tile-key resolver. Maps `"ground_42"`, `"objects_343"`,
 * `"tactic_arene_0"`, `"cell_s1"` etc. to their `(bundle, exportName,
 * frameCount, fps, kind)` tuple by probing pre-loaded SWF bundles.
 *
 * Extracted from the (now-deleted) `TileVelloRenderer`; used by the
 * per-frame tile pipeline so the placement list can be built in pure
 * data form without instantiating Pixi sprites.
 */
import { createLogger } from "@/utils/logger";

import {
  isSwfBundleLoaded,
  swfAnimFrameCount,
  swfBundleFrameRate,
  swfTileAnimKind,
} from "./vello-loader";

const log = createLogger("TileResolver");

const GROUND_BUNDLES = ["g1", "g2"] as const;
const OBJECT_BUNDLES = [
  "o1",
  "o2",
  "o3",
  "o4",
  "o5",
  "o6",
  "o7",
  "o8",
  "o9",
  "o10",
  "o11",
  "o12",
] as const;

export type TileAnimKind = "" | "animated" | "random" | "slope";

export interface ResolvedTile {
  bundle: string;
  exportName: string;
  frameCount: number;
  /** Bundle-level frame rate (g1/g2=12; o3/o8/o9/o11=40; others=60). */
  fps: number;
  kind: TileAnimKind;
}

export class TileResolver {
  private readonly cache = new Map<string, ResolvedTile | null>();

  /**
   * Resolve a tileKey by probing the relevant pre-loaded bundles. Result
   * is memoized — bundle identity doesn't change after boot, so a tile
   * that resolved once stays resolved.
   */
  resolve(tileKey: string): ResolvedTile | null {
    const cached = this.cache.get(tileKey);
    if (cached !== undefined) {
      return cached;
    }

    const underscore = tileKey.indexOf("_");
    const type = underscore === -1 ? tileKey : tileKey.slice(0, underscore);
    const idStr = underscore === -1 ? tileKey : tileKey.slice(underscore + 1);

    let bundleHit: string | null = null;
    let exportName = idStr;

    if (type === "ground") {
      bundleHit = this.probe(GROUND_BUNDLES, idStr);
    } else if (type === "objects") {
      bundleHit = this.probe(OBJECT_BUNDLES, idStr);
    } else if (type === "cell" || type === "tactic") {
      // cell/tactic tile keys carry the export verbatim (often `s1`,
      // `i7`, or a string token rather than a decimal). The bundle is
      // always the type itself (`cell`, `tactic`).
      if (isSwfBundleLoaded(type) && swfAnimFrameCount(type, idStr) > 0) {
        bundleHit = type;
      }
    } else {
      log.warn(`Unknown tile type "${type}" in key "${tileKey}"`);
    }

    if (!bundleHit) {
      log.warn(`Tile ${tileKey} not found in any SWF bundle`);
      this.cache.set(tileKey, null);
      return null;
    }

    const frameCount = Math.max(1, swfAnimFrameCount(bundleHit, exportName));
    const fps = swfBundleFrameRate(bundleHit) || 60;
    const kind = swfTileAnimKind(bundleHit, exportName) as TileAnimKind;

    const resolved: ResolvedTile = {
      bundle: bundleHit,
      exportName,
      frameCount,
      fps,
      kind,
    };
    this.cache.set(tileKey, resolved);
    return resolved;
  }

  private probe(
    bundles: readonly string[],
    exportName: string
  ): string | null {
    for (const bundle of bundles) {
      if (!isSwfBundleLoaded(bundle)) continue;
      if (swfAnimFrameCount(bundle, exportName) > 0) {
        return bundle;
      }
    }
    return null;
  }

  clear(): void {
    this.cache.clear();
  }
}
