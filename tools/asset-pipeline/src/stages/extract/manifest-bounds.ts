import { readFile } from "node:fs/promises";

/**
 * Authoritative Flash character bounds for one asset id, in pixel units
 * (SWF twips / 20). The PHP extractors write these into their manifest.json
 * files — see `ExtractTileCommand::calculateBounds` and the matching
 * helpers in the sprite/accessory commands.
 */
export interface FlashBoundsEntry {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  /** Present for tile/sprite manifests; 0 when absent. */
  frameCount: number;
}

/**
 * Parse a PHP extractor manifest.json that uses `{prefix}-{id}` keys with
 * `{offsetX, offsetY, width, height, frameCount?}` payloads. Used by the
 * tile/sprite/chevauchor compile stages to feed authoritative Flash bounds
 * into `compileSpriteFromFrames` via its `frameBounds` option.
 *
 * Returns an empty Map when the file is absent or unparseable so the caller
 * can fall back to the legacy zero-clipRect behavior without special-casing.
 */
export async function loadFlashBoundsManifest(
  manifestPath: string,
  keyPrefix: string
): Promise<Map<number, FlashBoundsEntry>> {
  const out = new Map<number, FlashBoundsEntry>();
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch {
    return out;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return out;
  }
  const prefixWithDash = `${keyPrefix}-`;
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.startsWith(prefixWithDash)) continue;
    const id = Number(key.slice(prefixWithDash.length));
    if (!Number.isFinite(id)) continue;
    const entry = value as Partial<FlashBoundsEntry> | undefined;
    if (!entry) continue;
    out.set(id, {
      width: Number(entry.width) || 0,
      height: Number(entry.height) || 0,
      offsetX: Number(entry.offsetX) || 0,
      offsetY: Number(entry.offsetY) || 0,
      frameCount: Number(entry.frameCount) || 0,
    });
  }
  return out;
}
