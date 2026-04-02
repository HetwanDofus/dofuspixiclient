import { Assets, type Texture } from "pixi.js";

/**
 * Load an SVG file through the custom loadSvgStroke parser.
 * Handles resolution-based cache-busting, alias generation, and deduplication.
 */
export async function loadSvg(
  path: string,
  resolution: number,
  alias?: string,
  look?: string,
): Promise<Texture> {
  const effectiveAlias = alias ?? `svg:${path}:${resolution}${look ? `:${look}` : ""}`;
  let src = `${path}?r=${resolution}`;
  if (look) src += `&look=${encodeURIComponent(look)}`;
  return Assets.load({
    alias: effectiveAlias,
    src,
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
