/**
 * Deduplicator - Hash-based element deduplication
 *
 * Uses a multi-pass approach to correctly handle definitions with internal references:
 * 1. First pass: Hash base definitions (no internal refs) - these can be shared globally
 * 2. Second pass: Hash derived definitions with resolved canonical refs - animation-scoped
 */
import { createHash } from 'crypto';
import { match, P } from 'ts-pattern';
import type {
  ParsedFrame,
  DeduplicationResult,
  CanonicalDefinition,
  DeduplicationStats,
  ProcessedSprite,
  UseElement,
  Definition,
} from '../types.ts';
import { formatViewBox } from './parser.ts';
import { replaceReferences, extractBase64Data, restoreBase64Data } from './utils.ts';

/**
 * Generate MD5 hash of content
 */
function md5(content: string): string {
  return createHash('md5').update(content).digest('hex');
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
 * Check if a definition has internal references to other definitions
 */
function hasInternalRefs(def: Definition): boolean {
  return def.nestedRefs.length > 0 || extractAllRefs(def.normalizedContent).length > 0;
}

/**
 * Build dependency graph for definitions within a frame
 * Returns map of defId -> set of defIds it depends on
 */
function buildFrameDependencyGraph(
  definitions: Definition[]
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const definedIds = new Set(definitions.map(d => d.originalId));

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
  const defMap = new Map(definitions.map(d => [d.originalId, d]));

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

  return sorted.map(id => defMap.get(id)).filter((d): d is Definition => d !== undefined);
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
  const resolvedContent = resolveRefsForHashing(def.normalizedContent, resolvedMapping);
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
  result = result.replace(
    /xlink:href="#([^"]+)"/g,
    (original, id) => {
      const canonical = mapping.get(id);
      return canonical ? `xlink:href="#${canonical}"` : original;
    }
  );

  // Replace href="#..."
  result = result.replace(
    /(?<!xmlns:xlink=")href="#([^"]+)"/g,
    (original, id) => {
      const canonical = mapping.get(id);
      return canonical ? `href="#${canonical}"` : original;
    }
  );

  // Replace url(#...)
  result = result.replace(
    /url\(#([^)]+)\)/g,
    (original, id) => {
      const canonical = mapping.get(id);
      return canonical ? `url(#${canonical})` : original;
    }
  );

  return result;
}

/**
 * Deduplicate definitions across all frames using multi-pass approach
 *
 * Pass 1: Process base definitions (no internal refs) - can be shared globally for base64 patterns
 * Pass 2: Process derived definitions with resolved refs - animation-scoped
 */
export function deduplicateDefinitions(
  frames: ParsedFrame[],
  _precision: number = 2
): DeduplicationResult {
  const canonicalDefs = new Map<string, CanonicalDefinition>();
  const idMapping = new Map<string, Map<string, string>>();

  let totalDefinitions = 0;
  let totalBytes = 0;

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
          // New unique definition
          const canonicalId = `def_${hash}`;
          const canonical: CanonicalDefinition = {
            id: canonicalId,
            hash,
            content: def.normalizedContent,
            tagName: def.tagName,
            refCount: 1,
            size: def.size,
            isPattern: def.isPattern,
          };
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
  const originalId = use.originalHref.replace(/^#/, '');
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
    const frameMapping = dedup.idMapping.get(frame.filename) ?? new Map<string, string>();

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

    const spriteId = frame.filename.replace(/\.svg$/i, '');

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
  return ref.startsWith('def_') || mapping.has(ref);
}

/**
 * Remove dead use elements (those with unresolved references)
 */
function removeDeadUseElements(content: string, mapping: Map<string, string>): string {
  // Match <use ... xlink:href="#id" .../> or <use ... xlink:href="#id" ...></use>
  return content.replace(
    /<use\s+[^>]*xlink:href="#([^"]+)"[^>]*\/?>(?:<\/use>)?/g,
    (match, refId) => isResolvedRef(refId, mapping) ? match : ''
  );
}

/**
 * Remove dead url() references in attributes (replace with 'none')
 */
function removeDeadUrlRefs(content: string, mapping: Map<string, string>): string {
  return content.replace(
    /url\(#([^)]+)\)/g,
    (match, refId) => isResolvedRef(refId, mapping) ? match : 'none'
  );
}

/**
 * Rebuild definition content with canonical IDs
 * Also strips all nested id attributes to prevent ID leaking
 * and removes dead elements with unresolved references
 */
export function rebuildDefinitionContent(
  originalContent: string,
  mapping: Map<string, string>,
  ownCanonicalId: string
): string {
  // Step 1: Protect base64 data from modification
  const { content: safeContent, base64Map } = extractBase64Data(originalContent);

  // Step 2: Strip ALL id attributes from nested elements
  // This prevents IDs from leaking into the global namespace
  let content = safeContent.replace(/\s+id="[^"]*"/g, '');

  // Step 3: Remove dead use elements (those with unresolved references)
  content = removeDeadUseElements(content, mapping);

  // Step 4: Replace dead url() references with 'none'
  content = removeDeadUrlRefs(content, mapping);

  // Step 5: Replace all reference types using the shared utility
  content = replaceReferences(content, mapping);

  // Step 6: Add the canonical ID to the opening tag
  content = content.replace(
    /^<(\w+)(\s|>)/,
    `<$1 id="${ownCanonicalId}"$2`
  );

  // Step 7: Restore base64 data
  content = restoreBase64Data(content, base64Map);

  return content;
}

/**
 * Build canonical definitions with updated internal references
 * Processes each definition using its frame-local mapping for correctness
 */
export function buildCanonicalDefinitions(
  frames: ParsedFrame[],
  dedup: DeduplicationResult
): Map<string, string> {
  const rebuiltDefs = new Map<string, string>();
  const processedHashes = new Set<string>();

  for (const frame of frames) {
    const frameMapping = dedup.idMapping.get(frame.filename) ?? new Map<string, string>();

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

      // Rebuild with canonical references using frame-local mapping
      const rebuiltContent = rebuildDefinitionContent(
        def.normalizedContent,
        frameMapping,
        canonicalDef.id
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
    const content = rebuiltDefs.get(def.id) ?? '';
    const deps = new Set<string>();

    // Find all href references to other definitions
    const hrefMatches = content.matchAll(/href="#(def_[a-f0-9]+)"/g);
    for (const hrefMatch of hrefMatches) {
      const refId = hrefMatch[1];
      const refHash = idToHash.get(refId);
      if (refHash && refHash !== hash) {
        deps.add(refHash);
      }
    }

    // Also check url() references
    const urlMatches = content.matchAll(/url\(#(def_[a-f0-9]+)\)/g);
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
