/**
 * Schema for the `monsters` lang namespace (monsters_<locale>.swf).
 *
 *   MSR[id] → MonsterSuperRace   (20 entries)
 *   MR[id]  → MonsterRace        (89 entries)
 *   M[id]   → Monster            (1 450 entries with `g1`..`g10` per-grade
 *                                  stat blocks; g1 always present, g6+ only
 *                                  for archmonsters/boss tiers)
 */

import { z } from "zod";

const GradeStats = z
  .object({
    // Observed shape varies per monster; capture keys flexibly.
  })
  .passthrough();

export const RawMonsterSchema = z
  .object({
    n: z.string(),
    nn: z.string(),
    g: z.number(),
    b: z.number(),
    a: z.number(),
    k: z.boolean(),
    d: z.boolean(),
    s: z.boolean(),
    g1: GradeStats.optional(),
    g2: GradeStats.optional(),
    g3: GradeStats.optional(),
    g4: GradeStats.optional(),
    g5: GradeStats.optional(),
    g6: GradeStats.optional(),
    g7: GradeStats.optional(),
    g8: GradeStats.optional(),
    g9: GradeStats.optional(),
    g10: GradeStats.optional(),
  })
  .passthrough();
export type RawMonster = z.infer<typeof RawMonsterSchema>;

export const RawMonsterRaceSchema = z
  .object({ n: z.string(), s: z.string() })
  .passthrough();
export type RawMonsterRace = z.infer<typeof RawMonsterRaceSchema>;

export const RawMonstersBundleSchema = z
  .object({
    MSR: z.record(z.string(), RawMonsterRaceSchema).optional(),
    MR: z.record(z.string(), RawMonsterRaceSchema).optional(),
    M: z.record(z.string(), RawMonsterSchema),
  })
  .passthrough();

export interface Monster {
  id: number;
  name: string;
  nameUpper: string;
  gfxId: number;
  baseColor: number;
  alignmentBonus: number;
  isBoss: boolean;
  droppable: boolean;
  stackSoulstones: boolean;
  /** Per-grade stat blocks (grade 1 → g1). Missing grades have no entry. */
  gradeStats: Record<number, Record<string, unknown>>;
}

export interface MonsterRace {
  id: number;
  name: string;
  superRaceCode: string;
}

export interface MonstersBundle {
  monsters: Map<number, Monster>;
  races: Map<number, MonsterRace>;
  superRaces: Map<number, MonsterRace>;
}

function normalizeMonster(id: number, raw: RawMonster): Monster {
  const grades: Record<number, Record<string, unknown>> = {};
  for (let g = 1; g <= 10; g++) {
    const entry = raw[`g${g}` as keyof RawMonster];
    if (entry && typeof entry === "object") {
      grades[g] = entry as Record<string, unknown>;
    }
  }
  return {
    id,
    name: raw.n,
    nameUpper: raw.nn,
    gfxId: raw.g,
    baseColor: raw.b,
    alignmentBonus: raw.a,
    isBoss: raw.k,
    droppable: raw.d,
    stackSoulstones: raw.s,
    gradeStats: grades,
  };
}

function normalizeRace(id: number, raw: RawMonsterRace): MonsterRace {
  return { id, name: raw.n, superRaceCode: raw.s };
}

export function normalizeMonstersBundle(data: unknown): MonstersBundle | null {
  const parsed = RawMonstersBundleSchema.safeParse(data);
  if (!parsed.success) return null;
  const monsters = new Map<number, Monster>();
  for (const [idStr, raw] of Object.entries(parsed.data.M)) {
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    monsters.set(id, normalizeMonster(id, raw));
  }
  return {
    monsters,
    races: idKeyedMap(parsed.data.MR, normalizeRace),
    superRaces: idKeyedMap(parsed.data.MSR, normalizeRace),
  };
}

function idKeyedMap<Raw, Out>(
  record: Record<string, Raw> | undefined,
  fn: (id: number, raw: Raw) => Out
): Map<number, Out> {
  const out = new Map<number, Out>();
  if (!record) return out;
  for (const [k, v] of Object.entries(record)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    out.set(id, fn(id, v));
  }
  return out;
}
