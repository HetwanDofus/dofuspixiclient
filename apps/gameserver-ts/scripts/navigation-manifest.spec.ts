import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildNavigationManifest,
  navigationManifestSchema,
  serializeNavigationManifest,
  serializeNavigationManifestSchema,
} from "./navigation-manifest";

const input = {
  maps: [
    {
      id: 3,
      x: 2,
      y: 0,
      subareaId: 10,
      superareaId: 1,
      width: 2,
      height: 2,
      outdoor: false,
    },
    {
      id: 1,
      x: 0,
      y: 0,
      subareaId: 10,
      superareaId: 1,
      width: 2,
      height: 2,
      outdoor: true,
    },
    {
      id: 2,
      x: 1,
      y: 0,
      subareaId: 10,
      superareaId: 1,
      width: 2,
      height: 2,
      outdoor: true,
    },
  ],
  borderTransitions: [{ sourceMapId: 1, direction: 0, targetMapId: 2 }],
  scriptedTransitions: [
    { sourceMapId: 2, sourceCellId: 1, targetMapId: 3, targetCellId: 2 },
  ],
} as const;

describe("navigation manifest", () => {
  test("builds a schema-valid global route with explicit priorities", () => {
    const manifest = buildNavigationManifest(input);

    expect(() => navigationManifestSchema.parse(manifest)).not.toThrow();
    expect(manifest.maps.map((map) => map.id)).toEqual([1, 2, 3]);
    expect(manifest.transitions.border[0]).toMatchObject({
      type: "border",
      priority: 10,
    });
    expect(manifest.transitions.scripted[0]).toMatchObject({
      type: "scripted",
      priority: 100,
    });

    // A consumer can route 1 -> 2 -> 3 from this manifest, while detailed
    // cell geometry remains a separate per-current-map concern.
    expect(manifest.maps[0]).not.toHaveProperty("cells");
    expect(manifest.transitions.border[0]?.targetMapId).toBe(2);
    expect(manifest.transitions.scripted[0]?.targetMapId).toBe(3);
  });

  test("rejects a transition whose target map is absent", () => {
    expect(() =>
      buildNavigationManifest({
        ...input,
        borderTransitions: [{ sourceMapId: 1, direction: 0, targetMapId: 404 }],
      })
    ).toThrow("border target map 404 does not exist");
  });

  test("rejects ambiguous transitions after priorities are applied", () => {
    expect(() =>
      buildNavigationManifest({
        ...input,
        borderTransitions: [
          { sourceMapId: 1, direction: 0, targetMapId: 2 },
          { sourceMapId: 1, direction: 0, targetMapId: 3 },
        ],
      })
    ).toThrow("ambiguous navigation transition");
  });

  test("is byte-for-byte deterministic", () => {
    const first = serializeNavigationManifest(buildNavigationManifest(input));
    const second = serializeNavigationManifest(
      buildNavigationManifest({
        ...input,
        maps: [...input.maps].reverse(),
      })
    );

    expect(second).toBe(first);
    expect(createHash("sha256").update(second).digest("hex")).toBe(
      createHash("sha256").update(first).digest("hex")
    );
  });

  test("the published manifest and JSON Schema match the canonical exporter", () => {
    const manifestPath = resolve(
      import.meta.dir,
      "../../electrobun/public/assets/data/navigation-manifest.json",
    );
    const schemaPath = manifestPath.replace(/\.json$/, ".schema.json");
    const serialized = readFileSync(manifestPath, "utf8");
    const published = navigationManifestSchema.parse(JSON.parse(serialized));

    const rebuilt = buildNavigationManifest({
      maps: published.maps,
      borderTransitions: published.transitions.border.map(
        ({ sourceMapId, direction, targetMapId }) => ({
          sourceMapId,
          direction,
          targetMapId,
        }),
      ),
      scriptedTransitions: published.transitions.scripted.map(
        ({ sourceMapId, sourceCellId, targetMapId, targetCellId }) => ({
          sourceMapId,
          sourceCellId,
          targetMapId,
          targetCellId,
        }),
      ),
    });

    expect(serializeNavigationManifest(rebuilt)).toBe(serialized);
    expect(readFileSync(schemaPath, "utf8")).toBe(
      serializeNavigationManifestSchema(),
    );
  });
});
