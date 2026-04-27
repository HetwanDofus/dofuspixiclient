/**
 * Schemas for the smaller server-side namespaces that have simple shapes:
 * effects, itemsets, itemstats, jobs. For each we derived the field names
 * from the histogram of non-null values across the full bundle.
 */

import { z } from "zod";

// ── effects ───────────────────────────────────────────────────────────────

export const RawEffectSchema = z
  .object({
    d: z.string(), // description template with placeholders (#1, #2, etc.)
    c: z.number(), // category (0=characteristic, 1=damage, 2=heal, …)
    p: z.number(), // priority / order
    o: z.string(), // operator tag (+, -, =, ",")
    t: z.boolean().optional(), // targetable?
    j: z.boolean().optional(), // shown in item tooltip?
    e: z.string().optional(), // element suffix (air/fire/water/earth glyph)
  })
  .passthrough();

export const RawEffectsBundleSchema = z
  .object({
    E: z.record(z.string(), RawEffectSchema),
    EDMG: z.record(z.string(), z.unknown()).optional(),
    EHEL: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export interface Effect {
  id: number;
  descriptionTemplate: string;
  categoryId: number;
  priority: number;
  operator: string;
  targetable?: boolean | undefined;
  showInTooltip?: boolean | undefined;
  elementGlyph?: string | undefined;
}

export interface EffectsBundle {
  effects: Map<number, Effect>;
  damageLabels: Map<number, unknown>;
  healLabels: Map<number, unknown>;
}

export function normalizeEffectsBundle(data: unknown): EffectsBundle | null {
  const parsed = RawEffectsBundleSchema.safeParse(data);
  if (!parsed.success) return null;
  const effects = new Map<number, Effect>();
  for (const [idStr, raw] of Object.entries(parsed.data.E)) {
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    effects.set(id, {
      id,
      descriptionTemplate: raw.d,
      categoryId: raw.c,
      priority: raw.p,
      operator: raw.o,
      targetable: raw.t,
      showInTooltip: raw.j,
      elementGlyph: raw.e,
    });
  }
  return {
    effects,
    damageLabels: toIdMap(parsed.data.EDMG),
    healLabels: toIdMap(parsed.data.EHEL),
  };
}

// ── itemsets ──────────────────────────────────────────────────────────────

export const RawItemSetSchema = z
  .object({
    n: z.string(),
    i: z.array(z.number()),
  })
  .passthrough();

export const RawItemSetsBundleSchema = z
  .object({ IS: z.record(z.string(), RawItemSetSchema) })
  .passthrough();

export interface ItemSet {
  id: number;
  name: string;
  /** Item ids that make up the set. */
  itemIds: number[];
}

export interface ItemSetsBundle {
  sets: Map<number, ItemSet>;
}

export function normalizeItemSetsBundle(data: unknown): ItemSetsBundle | null {
  const parsed = RawItemSetsBundleSchema.safeParse(data);
  if (!parsed.success) return null;
  const sets = new Map<number, ItemSet>();
  for (const [idStr, raw] of Object.entries(parsed.data.IS)) {
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    sets.set(id, { id, name: raw.n, itemIds: raw.i });
  }
  return { sets };
}

// ── jobs ──────────────────────────────────────────────────────────────────

export const RawJobSchema = z
  .object({
    n: z.string(),
    s: z.number(), // super-category id
    g: z.number(), // gfx / icon id
  })
  .passthrough();

export const RawJobsBundleSchema = z
  .object({ J: z.record(z.string(), RawJobSchema) })
  .passthrough();

export interface Job {
  id: number;
  name: string;
  superCategoryId: number;
  gfxId: number;
}

export interface JobsBundle {
  jobs: Map<number, Job>;
}

export function normalizeJobsBundle(data: unknown): JobsBundle | null {
  const parsed = RawJobsBundleSchema.safeParse(data);
  if (!parsed.success) return null;
  const jobs = new Map<number, Job>();
  for (const [idStr, raw] of Object.entries(parsed.data.J)) {
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    jobs.set(id, { id, name: raw.n, superCategoryId: raw.s, gfxId: raw.g });
  }
  return { jobs };
}

// ── small helpers ─────────────────────────────────────────────────────────

function toIdMap<V>(record: Record<string, V> | undefined): Map<number, V> {
  const out = new Map<number, V>();
  if (!record) return out;
  for (const [k, v] of Object.entries(record)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    out.set(id, v);
  }
  return out;
}
