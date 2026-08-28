import { createHash } from "node:crypto";

import { z } from "zod";

export const NAVIGATION_SCHEMA_VERSION = 1;
export const BORDER_TRANSITION_PRIORITY = 10;
export const SCRIPTED_TRANSITION_PRIORITY = 100;

const mapSchema = z
  .object({
    id: z.number().int().nonnegative(),
    x: z.number().int(),
    y: z.number().int(),
    subareaId: z.number().int().nonnegative(),
    superareaId: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    outdoor: z.boolean().optional(),
  })
  .strict();

const borderTransitionSchema = z
  .object({
    type: z.literal("border"),
    priority: z.literal(BORDER_TRANSITION_PRIORITY),
    sourceMapId: z.number().int().nonnegative(),
    direction: z.number().int().min(0).max(7),
    targetMapId: z.number().int().nonnegative(),
  })
  .strict();

const scriptedTransitionSchema = z
  .object({
    type: z.literal("scripted"),
    priority: z.literal(SCRIPTED_TRANSITION_PRIORITY),
    sourceMapId: z.number().int().nonnegative(),
    sourceCellId: z.number().int().nonnegative(),
    targetMapId: z.number().int().nonnegative(),
    targetCellId: z.number().int().nonnegative(),
  })
  .strict();

export const navigationManifestSchema = z
  .object({
    schemaVersion: z.literal(NAVIGATION_SCHEMA_VERSION),
    worldRevision: z.string().regex(/^[0-9a-f]{64}$/),
    maps: z.array(mapSchema),
    transitions: z
      .object({
        border: z.array(borderTransitionSchema),
        scripted: z.array(scriptedTransitionSchema),
      })
      .strict(),
  })
  .strict();

export type NavigationMap = z.infer<typeof mapSchema>;
export type BorderTransition = z.infer<typeof borderTransitionSchema>;
export type ScriptedTransition = z.infer<typeof scriptedTransitionSchema>;
export type NavigationManifest = z.infer<typeof navigationManifestSchema>;

export interface NavigationManifestInput {
  maps: ReadonlyArray<NavigationMap>;
  borderTransitions: ReadonlyArray<Omit<BorderTransition, "type" | "priority">>;
  scriptedTransitions: ReadonlyArray<
    Omit<ScriptedTransition, "type" | "priority">
  >;
}

export const navigationManifestJsonSchema = z.toJSONSchema(
  navigationManifestSchema,
  {
    target: "draft-7",
  }
);

function compareNumbers(
  ...values: ReadonlyArray<readonly [number, number]>
): number {
  for (const [a, b] of values) {
    if (a !== b) {
      return a - b;
    }
  }
  return 0;
}

function totalCells(map: NavigationMap): number {
  return map.height * map.width + (map.height - 1) * (map.width - 1);
}

function assertUnique(
  seen: Set<string>,
  key: string,
  description: string
): void {
  if (seen.has(key)) {
    throw new Error(`ambiguous navigation transition: ${description}`);
  }
  seen.add(key);
}

/**
 * JSON with recursively sorted object keys. Arrays retain their already
 * canonical domain order.
 */
export function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      // Compare Unicode code units directly: unlike localeCompare(), this is
      // independent of the runner locale and therefore safe for a hash input.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    return `{${entries
      .map(
        ([key, entry]) => `${JSON.stringify(key)}:${canonicalStringify(entry)}`
      )
      .join(",")}}`;
  }

  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error(`cannot canonically serialize ${String(value)}`);
  }
  return encoded;
}

export function buildNavigationManifest(
  input: NavigationManifestInput
): NavigationManifest {
  const maps = [...input.maps].sort((a, b) => a.id - b.id);
  const mapsById = new Map<number, NavigationMap>();

  for (const map of maps) {
    const parsed = mapSchema.parse(map);
    if (mapsById.has(parsed.id)) {
      throw new Error(`duplicate map id ${parsed.id}`);
    }
    mapsById.set(parsed.id, parsed);
  }

  if (maps.length === 0) {
    throw new Error("cannot export an empty navigation world");
  }

  const borderSeen = new Set<string>();
  const border = input.borderTransitions
    .map(
      (transition): BorderTransition => ({
        type: "border",
        priority: BORDER_TRANSITION_PRIORITY,
        ...transition,
      })
    )
    .sort((a, b) =>
      compareNumbers(
        [a.sourceMapId, b.sourceMapId],
        [a.direction, b.direction],
        [a.targetMapId, b.targetMapId]
      )
    );

  for (const transition of border) {
    borderTransitionSchema.parse(transition);
    assertUnique(
      borderSeen,
      `${transition.sourceMapId}:${transition.direction}`,
      `map ${transition.sourceMapId}, direction ${transition.direction}`
    );
    assertMapExists(mapsById, transition.sourceMapId, "border source");
    assertMapExists(mapsById, transition.targetMapId, "border target");
  }

  const scriptedSeen = new Set<string>();
  const scripted = input.scriptedTransitions
    .map(
      (transition): ScriptedTransition => ({
        type: "scripted",
        priority: SCRIPTED_TRANSITION_PRIORITY,
        ...transition,
      })
    )
    .sort((a, b) =>
      compareNumbers(
        [a.sourceMapId, b.sourceMapId],
        [a.sourceCellId, b.sourceCellId],
        [a.targetMapId, b.targetMapId],
        [a.targetCellId, b.targetCellId]
      )
    );

  for (const transition of scripted) {
    scriptedTransitionSchema.parse(transition);
    assertUnique(
      scriptedSeen,
      `${transition.sourceMapId}:${transition.sourceCellId}`,
      `map ${transition.sourceMapId}, cell ${transition.sourceCellId}`
    );
    const source = assertMapExists(
      mapsById,
      transition.sourceMapId,
      "scripted source"
    );
    const target = assertMapExists(
      mapsById,
      transition.targetMapId,
      "scripted target"
    );
    assertCellExists(source, transition.sourceCellId, "scripted source");
    assertCellExists(target, transition.targetCellId, "scripted target");
  }

  const payload = {
    schemaVersion: NAVIGATION_SCHEMA_VERSION,
    maps,
    transitions: { border, scripted },
  };
  const worldRevision = createHash("sha256")
    .update(canonicalStringify(payload))
    .digest("hex");

  return navigationManifestSchema.parse({ ...payload, worldRevision });
}

export function serializeNavigationManifest(
  manifest: NavigationManifest
): string {
  return `${canonicalStringify(navigationManifestSchema.parse(manifest))}\n`;
}

export function serializeNavigationManifestSchema(): string {
  return `${canonicalStringify(navigationManifestJsonSchema)}\n`;
}

function assertMapExists(
  mapsById: ReadonlyMap<number, NavigationMap>,
  mapId: number,
  role: string
): NavigationMap {
  const map = mapsById.get(mapId);
  if (!map) {
    throw new Error(`${role} map ${mapId} does not exist`);
  }
  return map;
}

function assertCellExists(
  map: NavigationMap,
  cellId: number,
  role: string
): void {
  const count = totalCells(map);
  if (cellId >= count) {
    throw new Error(
      `${role} cell ${cellId} is outside map ${map.id} (cell count ${count})`
    );
  }
}
