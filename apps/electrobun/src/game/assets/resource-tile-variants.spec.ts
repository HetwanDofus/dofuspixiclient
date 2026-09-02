import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Guards the published object tiles against the QA-144 failure mode: a family
 * of gathering resources published as a single visual because the extraction
 * never replayed the variant selection carried by the 1.29 SWF.
 *
 * The client picks a tile purely by gfx id (`objects_<gfxId>`, see
 * `LayerBuilder.tileKeyFor`), so two resources compiled to the same geometry
 * are indistinguishable in game no matter what the referential says.
 */

const ASSETS_ROOT = resolve(import.meta.dir, "../../../public/assets");
const OBJECT_TILES_DIR = join(ASSETS_ROOT, "spritesheets", "tiles", "objects");
const INTERACTIVE_OBJECTS = join(
  ASSETS_ROOT,
  "data",
  "interactive-objects.json"
);

/** `objectTypes` entry for harvestable resources (trees, ores, crops…). */
const GATHERING_TYPE = 1;

/** .dofasset section carrying the per-asset metadata, `spriteId` included. */
const EXTRAS_SECTION = 9;

const HEADER_SIZE = 20;
const DIRECTORY_ENTRY_SIZE = 10;

/**
 * Gathering gfx ids that still compile to the same geometry. All three pairs
 * are fishing spots, and they are correct: their clips carry no variant number
 * at all, so the 1.29 client draws the same ripple for the river and the sea
 * one. (7531/7532 draw the same thing too, but sit 1.5px apart, so a content
 * hash cannot see it — this guard catches shared geometry, not lookalikes.)
 *
 * The set is asserted exactly, so a new duplicate fails the test and so does a
 * group that changes — the list has to be updated rather than left to lie.
 */
const KNOWN_DUPLICATE_GROUPS: number[][] = [
  // Petit poisson de rivière / Perche
  [7529, 7544],
  // Gros poisson de rivière / de mer
  [7537, 7538],
  // Poisson géant de rivière / de mer
  [7539, 7540],
];

interface InteractiveObject {
  id: number;
  name: string;
  type: number;
}

interface InteractiveObjectsFile {
  interactiveObjects: Record<string, InteractiveObject>;
  gfxMapping: Record<string, number[]>;
}

interface GatheringGfx {
  gfxId: number;
  name: string;
}

function gatheringGfx(): GatheringGfx[] {
  const data = JSON.parse(
    readFileSync(INTERACTIVE_OBJECTS, "utf-8")
  ) as InteractiveObjectsFile;

  const out: GatheringGfx[] = [];
  for (const [objectId, gfxIds] of Object.entries(data.gfxMapping)) {
    const object = data.interactiveObjects[objectId];
    if (!object || object.type !== GATHERING_TYPE) {
      continue;
    }
    for (const gfxId of gfxIds) {
      out.push({ gfxId, name: object.name });
    }
  }
  return out.sort((a, b) => a.gfxId - b.gfxId);
}

/**
 * Hash of everything a tile actually draws — every .dofasset section but the
 * Extras one, which carries the id and would make two identical tiles look
 * different. `null` when nothing is published for that gfx id.
 */
function renderHash(gfxId: number): string | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(OBJECT_TILES_DIR, `${gfxId}.dofasset`));
  } catch {
    return null;
  }

  const sectionCount = bytes.readUInt16LE(12);
  const hash = createHash("sha1");

  for (let i = 0; i < sectionCount; i++) {
    const base = HEADER_SIZE + i * DIRECTORY_ENTRY_SIZE;
    const type = bytes.readUInt16LE(base);
    if (type === EXTRAS_SECTION) {
      continue;
    }
    const offset = bytes.readUInt32LE(base + 2);
    const length = bytes.readUInt32LE(base + 6);
    hash.update(new Uint8Array([type]));
    hash.update(bytes.subarray(offset, offset + length));
  }

  return hash.digest("hex");
}

function normalise(groups: number[][]): number[][] {
  return groups
    .map((group) => [...group].sort((a, b) => a - b))
    .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
}

describe("published gathering-resource tiles", () => {
  const resources = gatheringGfx();

  it("has art for every gathering gfx id in the referential", () => {
    expect(resources.length).toBeGreaterThan(0);

    const missing = resources
      .filter(({ gfxId }) => renderHash(gfxId) === null)
      .map(({ gfxId, name }) => `${gfxId} (${name})`);

    expect(missing).toEqual([]);
  });

  it("gives each resource its own rendering, bar the known exceptions", () => {
    const byHash = new Map<string, number[]>();
    for (const { gfxId } of resources) {
      const hash = renderHash(gfxId);
      if (hash === null) {
        continue;
      }
      const bucket = byHash.get(hash);
      if (bucket) {
        bucket.push(gfxId);
      } else {
        byHash.set(hash, [gfxId]);
      }
    }

    const duplicates = [...byHash.values()].filter((group) => group.length > 1);

    // Exact match, both ways: an unexpected group is a regression, and a group
    // that no longer matches means KNOWN_DUPLICATE_GROUPS is stale.
    expect(normalise(duplicates)).toEqual(normalise(KNOWN_DUPLICATE_GROUPS));
  });
});
