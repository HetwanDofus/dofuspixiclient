// Browser-safe surface of `@dofus/dofasset-format`. Node-only pipeline
// helpers (image extraction, sprite/static compile, binary writer) live in
// `./pipeline.ts` and are reachable via `@dofus/dofasset-format/pipeline`.
// Do NOT add imports that pull `node:fs`, `node:path`, or `node:crypto`
// into this file — the electrobun client bundles this module directly and
// Vite's prebundler will externalize those imports at runtime.
export {
  readHeader,
  readExtras,
  readSpellExtras,
  readTileExtras,
  type DofassetHeader,
  type ReadExtrasResult,
  type SpellExtras,
  type SpellExtrasAnimation,
  type TileExtras,
  type TileExtrasAnimation,
} from "./binary-reader.ts";
export { applyColorZones } from "./color-mapper.ts";
export { deduplicate, type AnimationInput } from "./deduplicator.ts";
export { parseSvg } from "./svg-parser.ts";
export { parseFrameSvg, namespaceSvgIds, type ParsedFrameSvg } from "./frame-svg.ts";
export * from "./types.ts";
