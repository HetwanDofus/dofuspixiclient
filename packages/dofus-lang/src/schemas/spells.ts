/**
 * Schema for the `spells` lang namespace (spells_<locale>.swf).
 *
 *   S[id] → Spell  (2 091 entries in fr-v1254)
 *
 * Derived from a histogram of every spell field across the full corpus:
 *
 *   n:string   × 2091   — name
 *   d:string   × 2091   — description
 *   i:object   × 2091   — level-invariant info block
 *   p:boolean  × 2091   — isPassive / progression? (see RawSpellSchema note)
 *   g:boolean  × 2091   — isGlobal / grantsEffect?
 *   b:number   × 2091   — base value? (effect-magnitude anchor)
 *   t:number   × 2091   — category / school
 *   o:number   × 2091   — display order
 *   c:number   × 2091   — element? (air/earth/fire/water)
 *   l1:array   × 2091   — level 1 effects
 *   l2:array   × 2001   — level 2 effects (absent for a few spells)
 *   l3:array   × 1984   — …
 *   l4:array   × 1874
 *   l5:array   × 1874
 *   l6:array   × 808    — level 6 only exists for class spells
 */

import { z } from "zod";

/**
 * Per-level data is a packed mixed-type array that holds ~20 slots per level
 * (cooldown, range, crit chance, effect sub-arrays, …). We keep the raw
 * shape — decoding the slot positions is a follow-up job.
 */
const SpellLevelData = z.array(z.unknown());

export const RawSpellSchema = z
  .object({
    n: z.string(),
    d: z.string(),
    i: z.unknown(), // per-spell constant object; shape varies
    p: z.boolean(),
    g: z.boolean(),
    b: z.number(),
    t: z.number(),
    o: z.number(),
    c: z.number(),
    l1: SpellLevelData.optional(),
    l2: SpellLevelData.optional(),
    l3: SpellLevelData.optional(),
    l4: SpellLevelData.optional(),
    l5: SpellLevelData.optional(),
    l6: SpellLevelData.optional(),
  })
  .passthrough();
export type RawSpell = z.infer<typeof RawSpellSchema>;

export const RawSpellsBundleSchema = z
  .object({ S: z.record(z.string(), RawSpellSchema) })
  .passthrough();

export interface Spell {
  id: number;
  name: string;
  description: string;
  info: unknown;
  isPassive: boolean;
  isGlobal: boolean;
  baseValue: number;
  categoryId: number;
  displayOrder: number;
  elementId: number;
  /** Level-data table (packed mixed array per level). Missing levels are absent. */
  levels: Record<1 | 2 | 3 | 4 | 5 | 6, unknown[] | undefined>;
}

export interface SpellsBundle {
  spells: Map<number, Spell>;
}

function normalizeSpell(id: number, raw: RawSpell): Spell {
  return {
    id,
    name: raw.n,
    description: raw.d,
    info: raw.i,
    isPassive: raw.p,
    isGlobal: raw.g,
    baseValue: raw.b,
    categoryId: raw.t,
    displayOrder: raw.o,
    elementId: raw.c,
    levels: {
      1: raw.l1,
      2: raw.l2,
      3: raw.l3,
      4: raw.l4,
      5: raw.l5,
      6: raw.l6,
    },
  };
}

export function normalizeSpellsBundle(data: unknown): SpellsBundle | null {
  const parsed = RawSpellsBundleSchema.safeParse(data);
  if (!parsed.success) return null;
  const spells = new Map<number, Spell>();
  for (const [idStr, raw] of Object.entries(parsed.data.S)) {
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    spells.set(id, normalizeSpell(id, raw));
  }
  return { spells };
}
