import { createHash } from "node:crypto";
import * as path from "node:path";

import { match, P } from "ts-pattern";

import type {
  CanonicalDefinition,
  DeduplicationResult,
  DeduplicationStats,
  Definition,
  ImageExportOptions,
  OptimizationOptions,
  ParsedFrame,
  ProcessedSprite,
  UseElement,
} from "../types.ts";
import { exportImage, type ImageRegistry } from "./image-exporter.ts";
import { formatViewBox } from "./parser.ts";
import {
  extractBase64Data,
  replaceReferences,
  restoreBase64Data,
} from "./utils.ts";

/**
 * Generate MD5 hash of content
 */
function md5(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

/**
 * Generate short hash (first 12 characters)
 */
function shortHash(content: string): string {
  return md5(content).substring(0, 12);
}

/**
 * Extract all reference IDs from definition content
 * Handles: xlink:href="#id", href="#id", url(#id), fill="url(#id)", etc.
 */
function extractAllRefs(content: string): string[] {
  const refs: string[] = [];

  // Match xlink:href="#..."
  for (const m of content.matchAll(/xlink:href="#([^"]+)"/g)) {
    refs.push(m[1]);
  }

  // Match href="#..." (but not xmlns declarations)
  for (const m of content.matchAll(/(?<!xmlns:xlink=")href="#([^"]+)"/g)) {
    refs.push(m[1]);
  }

  // Match url(#...)
  for (const m of content.matchAll(/url\(#([^)]+)\)/g)) {
    refs.push(m[1]);
  }

  return [...new Set(refs)];
}

/**
 * Build dependency graph for definitions within a frame
 * Returns map of defId -> set of defIds it depends on
 */
function buildFrameDependencyGraph(
  definitions: Definition[]
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const definedIds = new Set(definitions.map((d) => d.originalId));

  for (const def of definitions) {
    const allRefs = extractAllRefs(def.normalizedContent);
    const deps = new Set<string>();

    for (const ref of allRefs) {
      if (definedIds.has(ref)) {
        deps.add(ref);
      }
    }

    graph.set(def.originalId, deps);
  }

  return graph;
}

/**
 * Topologically sort definitions within a frame
 * Returns definitions in order where dependencies come first
 */
function topologicallySortDefs(definitions: Definition[]): Definition[] {
  const graph = buildFrameDependencyGraph(definitions);
  const defMap = new Map(definitions.map((d) => [d.originalId, d]));

  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      // Cycle detected - just add it to avoid infinite loop
      sorted.push(id);
      visited.add(id);
      return;
    }

    visiting.add(id);
    const deps = graph.get(id) ?? new Set();

    for (const dep of deps) {
      visit(dep);
    }

    visiting.delete(id);
    visited.add(id);
    sorted.push(id);
  }

  for (const def of definitions) {
    visit(def.originalId);
  }

  return sorted
    .map((id) => defMap.get(id))
    .filter((d): d is Definition => d !== undefined);
}

/**
 * Compute content hash for a definition
 * For base definitions (no refs): use content directly
 * For derived definitions: replace refs with their canonical IDs first
 */
function computeContentHash(
  def: Definition,
  animationName: string,
  resolvedMapping: Map<string, string>
): string {
  // Base64 patterns can be shared globally (no animation scope needed)
  if (def.isPattern && def.base64Data) {
    return shortHash(def.normalizedContent);
  }

  // Check if this definition has any refs that need resolution
  const allRefs = extractAllRefs(def.normalizedContent);

  if (allRefs.length === 0) {
    // No refs - just hash with animation scope
    return shortHash(`${animationName}:${def.normalizedContent}`);
  }

  // Has refs - resolve them to canonical IDs before hashing
  // This ensures definitions with same structure but different ref targets get different hashes
  const resolvedContent = resolveRefsForHashing(
    def.normalizedContent,
    resolvedMapping
  );
  return shortHash(`${animationName}:${resolvedContent}`);
}

/**
 * Replace reference IDs with their canonical IDs for hashing purposes
 */
function resolveRefsForHashing(
  content: string,
  mapping: Map<string, string>
): string {
  let result = content;

  // Replace xlink:href="#..."
  result = result.replace(/xlink:href="#([^"]+)"/g, (original, id) => {
    const canonical = mapping.get(id);
    return canonical ? `xlink:href="#${canonical}"` : original;
  });

  // Replace href="#..."
  result = result.replace(
    /(?<!xmlns:xlink=")href="#([^"]+)"/g,
    (original, id) => {
      const canonical = mapping.get(id);
      return canonical ? `href="#${canonical}"` : original;
    }
  );

  // Replace url(#...)
  result = result.replace(/url\(#([^)]+)\)/g, (original, id) => {
    const canonical = mapping.get(id);
    return canonical ? `url(#${canonical})` : original;
  });

  return result;
}

/** Default optimization options */
const DEFAULT_OPTIMIZATION: OptimizationOptions = {
  shortIds: false,
  minify: false,
  precision: 2,
  stripDefaults: false,
};

/**
 * Deduplicate definitions across all frames using multi-pass approach
 *
 * Pass 1: Process base definitions (no internal refs) - can be shared globally for base64 patterns
 * Pass 2: Process derived definitions with resolved refs - animation-scoped
 *
 * @param imageRegistry - Optional registry for exporting rasterized images to files
 */
export function deduplicateDefinitions(
  frames: ParsedFrame[],
  options: Partial<OptimizationOptions> = {},
  imageRegistry?: ImageRegistry
): DeduplicationResult {
  const opts = { ...DEFAULT_OPTIMIZATION, ...options };
  const canonicalDefs = new Map<string, CanonicalDefinition>();
  const idMapping = new Map<string, Map<string, string>>();

  let totalDefinitions = 0;
  let totalBytes = 0;
  let idCounter = 0;

  // Process each frame
  for (const frame of frames) {
    const frameMapping = new Map<string, string>();
    idMapping.set(frame.filename, frameMapping);

    // Sort definitions topologically so dependencies are processed first
    const sortedDefs = topologicallySortDefs(frame.definitions);

    for (const def of sortedDefs) {
      totalDefinitions++;
      totalBytes += def.size;

      // Compute hash with resolved refs (using already-processed definitions)
      const hash = computeContentHash(def, frame.animationName, frameMapping);
      def.contentHash = hash;

      const existingDef = canonicalDefs.get(hash);

      match(existingDef)
        .with(P.not(P.nullish), (existing) => {
          // Existing definition - increment ref count
          existing.refCount++;
          frameMapping.set(def.originalId, existing.id);
        })
        .otherwise(() => {
          // New unique definition - use short ID if enabled
          const canonicalId = opts.shortIds ? `d${idCounter++}` : `def_${hash}`;
          const canonical: CanonicalDefinition = {
            id: canonicalId,
            hash,
            content: def.normalizedContent,
            tagName: def.tagName,
            refCount: 1,
            size: def.size,
            isPattern: def.isPattern,
          };

          // Export base64 image if registry is provided and definition has base64 data
          if (imageRegistry && def.base64Data) {
            const exported = exportImage(imageRegistry, def.base64Data);
            if (exported) {
              canonical.exportedImageHash = exported.hash;
              canonical.base64DataUri = def.base64Data;
            }
          }

          canonicalDefs.set(hash, canonical);
          frameMapping.set(def.originalId, canonicalId);
          def.canonicalId = canonicalId;
        });
    }
  }

  // Calculate statistics
  let uniqueBytes = 0;
  let patternCount = 0;

  for (const def of canonicalDefs.values()) {
    uniqueBytes += def.size;
    if (def.isPattern) patternCount++;
  }

  const topDefinitions = Array.from(canonicalDefs.values())
    .sort((a, b) => b.refCount - a.refCount)
    .slice(0, 10)
    .map((d) => ({ id: d.id, refCount: d.refCount, size: d.size }));

  const stats: DeduplicationStats = {
    totalDefinitions,
    uniqueDefinitions: canonicalDefs.size,
    totalBytes,
    uniqueBytes,
    compressionRatio: totalBytes > 0 ? (1 - uniqueBytes / totalBytes) * 100 : 0,
    patternCount,
    topDefinitions,
  };

  return {
    canonicalDefs,
    idMapping,
    stats,
  };
}

/**
 * Resolve a use element's href to canonical form
 * Uses ONLY frame-local mapping
 */
function resolveUseElementHref(
  use: UseElement,
  frameMapping: Map<string, string>
): UseElement {
  const originalId = use.originalHref.replace(/^#/, "");
  const canonicalId = frameMapping.get(originalId);

  return match(canonicalId)
    .with(P.string, (id) => ({
      ...use,
      canonicalHref: `#${id}`,
    }))
    .otherwise(() => ({
      ...use,
      canonicalHref: use.originalHref,
    }));
}

/**
 * Process frames with deduplicated definitions
 */
export function processFrames(
  frames: ParsedFrame[],
  dedup: DeduplicationResult
): ProcessedSprite[] {
  const sprites: ProcessedSprite[] = [];
  const structureHashes = new Map<string, string>();

  for (const frame of frames) {
    const frameMapping =
      dedup.idMapping.get(frame.filename) ?? new Map<string, string>();

    // Map use elements to canonical hrefs
    const mappedUseElements = frame.useElements.map((use) =>
      resolveUseElementHref(use, frameMapping)
    );

    // Generate frame structure hash (for frame-level deduplication)
    const structureContent = JSON.stringify({
      mainTransform: frame.mainTransform,
      useElements: mappedUseElements.map((u) => ({
        href: u.canonicalHref,
        transform: u.transform,
        width: u.width,
        height: u.height,
      })),
    });
    const structureHash = shortHash(structureContent);

    const spriteId = frame.filename.replace(/\.svg$/i, "");

    const sprite: ProcessedSprite = {
      id: spriteId,
      animationName: frame.animationName,
      frameIndex: frame.frameIndex,
      viewBox: formatViewBox(frame.viewBox),
      mainTransform: frame.mainTransform,
      useElements: mappedUseElements,
      structureHash,
    };

    // Check for frame-level duplicates
    const existingFrame = structureHashes.get(structureHash);

    match(existingFrame)
      .with(P.string, (existing) => {
        sprite.duplicateOf = existing;
      })
      .otherwise(() => {
        structureHashes.set(structureHash, spriteId);
      });

    sprites.push(sprite);
  }

  return sprites;
}

/**
 * Check if a reference is resolved (either mapped to canonical or already canonical)
 */
function isResolvedRef(ref: string, mapping: Map<string, string>): boolean {
  // Match both long IDs (def_xxx) and short IDs (d0, d1, etc.)
  return ref.startsWith("def_") || /^d\d+$/.test(ref) || mapping.has(ref);
}

/**
 * Remove dead use elements (those with unresolved references)
 */
function removeDeadUseElements(
  content: string,
  mapping: Map<string, string>
): string {
  // Match <use ... xlink:href="#id" .../> or <use ... xlink:href="#id" ...></use>
  return content.replace(
    /<use\s+[^>]*xlink:href="#([^"]+)"[^>]*\/?>(?:<\/use>)?/g,
    (match, refId) => (isResolvedRef(refId, mapping) ? match : "")
  );
}

/**
 * Remove dead url() references in attributes (replace with 'none')
 */
function removeDeadUrlRefs(
  content: string,
  mapping: Map<string, string>
): string {
  return content.replace(/url\(#([^)]+)\)/g, (match, refId) =>
    isResolvedRef(refId, mapping) ? match : "none"
  );
}

/** Options for rebuilding definition content */
export interface RebuildOptions {
  /** Image file reference to replace base64 data with */
  imageFileRef?: string;
  /** Original base64 data URI to replace */
  base64DataUri?: string;
}

/**
 * Rebuild definition content with canonical IDs
 * Also strips all nested id attributes to prevent ID leaking
 * and removes dead elements with unresolved references
 */
export function rebuildDefinitionContent(
  originalContent: string,
  mapping: Map<string, string>,
  ownCanonicalId: string,
  options: RebuildOptions = {}
): string {
  // Step 1: Protect base64 data from modification (unless we're replacing it)
  const { content: safeContent, base64Map } =
    extractBase64Data(originalContent);

  // Step 2: Strip ALL id attributes from nested elements
  // This prevents IDs from leaking into the global namespace
  let content = safeContent.replace(/\s+id="[^"]*"/g, "");

  // Step 3: Remove dead use elements (those with unresolved references)
  content = removeDeadUseElements(content, mapping);

  // Step 4: Replace dead url() references with 'none'
  content = removeDeadUrlRefs(content, mapping);

  // Step 5: Replace all reference types using the shared utility
  content = replaceReferences(content, mapping);

  // Step 6: Add the canonical ID to the opening tag
  content = content.replace(/^<(\w+)(\s|>)/, `<$1 id="${ownCanonicalId}"$2`);

  // Step 7: Restore base64 data OR replace with file reference
  if (options.imageFileRef && options.base64DataUri) {
    // Replace base64 placeholders with file reference
    for (const [placeholder, originalBase64] of base64Map) {
      if (originalBase64 === options.base64DataUri) {
        content = content.replace(placeholder, options.imageFileRef);
      } else {
        content = content.replace(placeholder, originalBase64);
      }
    }
  } else {
    // Restore original base64 data
    content = restoreBase64Data(content, base64Map);
  }

  return content;
}

/**
 * Build canonical definitions with updated internal references
 * Processes each definition using its frame-local mapping for correctness
 *
 * @param svgOutputDir - Directory where the SVG will be written (for computing relative paths to images, optional if webBasePath is set)
 * @param imageRegistry - Optional registry containing exported images. If registry has webBasePath set, absolute URLs will be used instead of relative paths
 */
export function buildCanonicalDefinitions(
  frames: ParsedFrame[],
  dedup: DeduplicationResult,
  svgOutputDir?: string,
  imageRegistry?: ImageRegistry
): Map<string, string> {
  const rebuiltDefs = new Map<string, string>();
  const processedHashes = new Set<string>();

  for (const frame of frames) {
    const frameMapping =
      dedup.idMapping.get(frame.filename) ?? new Map<string, string>();

    // Sort definitions topologically so dependencies come first
    const sortedDefs = topologicallySortDefs(frame.definitions);

    for (const def of sortedDefs) {
      // Skip if we've already processed this hash
      if (processedHashes.has(def.contentHash)) {
        continue;
      }
      processedHashes.add(def.contentHash);

      const canonicalDef = dedup.canonicalDefs.get(def.contentHash);
      if (!canonicalDef) continue;

      // Compute image file reference if this definition has an exported image
      let rebuildOptions: RebuildOptions = {};
      if (
        imageRegistry &&
        canonicalDef.exportedImageHash &&
        canonicalDef.base64DataUri
      ) {
        const image = imageRegistry.images.get(canonicalDef.exportedImageHash);
        if (image) {
          // Use web base path if set, otherwise compute relative path
          let imageFileRef: string;
          if (imageRegistry.webBasePath) {
            // Use absolute web path
            const basePath = imageRegistry.webBasePath.endsWith("/")
              ? imageRegistry.webBasePath.slice(0, -1)
              : imageRegistry.webBasePath;
            imageFileRef = `${basePath}/${image.filename}`;
          } else if (svgOutputDir) {
            // Fallback to relative path from SVG directory to image
            const relativePath = path
              .relative(svgOutputDir, imageRegistry.outputDir)
              .replace(/\\/g, "/");
            imageFileRef = `${relativePath}/${image.filename}`;
          } else {
            // No path info available, just use filename
            imageFileRef = image.filename;
          }

          rebuildOptions = {
            imageFileRef,
            base64DataUri: canonicalDef.base64DataUri,
          };
        }
      }

      // Rebuild with canonical references using frame-local mapping
      const rebuiltContent = rebuildDefinitionContent(
        def.normalizedContent,
        frameMapping,
        canonicalDef.id,
        rebuildOptions
      );

      rebuiltDefs.set(canonicalDef.id, rebuiltContent);
    }
  }

  return rebuiltDefs;
}

/**
 * Sort definitions topologically based on their dependencies
 * This ensures definitions are ordered so dependencies come before dependents
 */
export function sortDefinitionsTopologically(
  canonicalDefs: Map<string, CanonicalDefinition>,
  rebuiltDefs: Map<string, string>
): string[] {
  // Build dependency graph
  const dependencies = new Map<string, Set<string>>();
  const allHashes = new Set(canonicalDefs.keys());

  // Map canonical ID to hash for reverse lookup
  const idToHash = new Map<string, string>();
  for (const [hash, def] of canonicalDefs) {
    idToHash.set(def.id, hash);
  }

  for (const [hash, def] of canonicalDefs) {
    const content = rebuiltDefs.get(def.id) ?? "";
    const deps = new Set<string>();

    // Find all href references to other definitions (both long and short IDs)
    const hrefMatches = content.matchAll(/href="#(def_[a-f0-9]+|d\d+)"/g);
    for (const hrefMatch of hrefMatches) {
      const refId = hrefMatch[1];
      const refHash = idToHash.get(refId);
      if (refHash && refHash !== hash) {
        deps.add(refHash);
      }
    }

    // Also check url() references (both long and short IDs)
    const urlMatches = content.matchAll(/url\(#(def_[a-f0-9]+|d\d+)\)/g);
    for (const urlMatch of urlMatches) {
      const refId = urlMatch[1];
      const refHash = idToHash.get(refId);
      if (refHash && refHash !== hash) {
        deps.add(refHash);
      }
    }

    dependencies.set(hash, deps);
  }

  // Topological sort using Kahn's algorithm
  const sorted: string[] = [];
  const inDegree = new Map<string, number>();

  // Initialize in-degrees
  for (const hash of allHashes) {
    inDegree.set(hash, 0);
  }

  // Calculate in-degrees (how many other nodes depend on this one)
  for (const deps of dependencies.values()) {
    for (const dep of deps) {
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
    }
  }

  // Start with nodes that have no dependents
  const queue: string[] = [];
  for (const [hash, degree] of inDegree) {
    if (degree === 0) {
      queue.push(hash);
    }
  }

  while (queue.length > 0) {
    const hash = queue.shift();
    if (!hash) break;

    sorted.push(hash);

    const deps = dependencies.get(hash) ?? new Set();
    for (const dep of deps) {
      const newDegree = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, newDegree);
      if (newDegree === 0) {
        queue.push(dep);
      }
    }
  }

  // Handle any remaining nodes (cycles - shouldn't happen with valid SVGs)
  for (const hash of allHashes) {
    if (!sorted.includes(hash)) {
      sorted.push(hash);
    }
  }

  // Reverse because we want dependencies first (nodes with most dependents last)
  return sorted.reverse();
}
