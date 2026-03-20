import { Assets, type Texture } from "pixi.js";

/**
 * Load an SVG file through the custom loadSvgStroke parser.
 * Handles resolution-based cache-busting, alias generation, and deduplication.
 */
export async function loadSvg(
  path: string,
  resolution: number,
  alias?: string,
): Promise<Texture> {
  const effectiveAlias = alias ?? `svg:${path}:${resolution}`;
  return Assets.load({
    alias: effectiveAlias,
    src: `${path}?r=${resolution}`,
    parser: "loadSvgStroke",
    data: { resolution },
  });
}

/**
 * Batch-load multiple SVGs in parallel.
 */
export async function loadSvgBatch(
  items: Array<{ path: string; resolution: number; alias?: string }>,
): Promise<Texture[]> {
  return Promise.all(items.map((i) => loadSvg(i.path, i.resolution, i.alias)));
}
