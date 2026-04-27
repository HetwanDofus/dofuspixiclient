/**
 * Schema for the `items` lang namespace (items_<locale>.swf).
 *
 * Top-level Dofus AS2 tree lives under `I`:
 *
 *   I.u[id]  → Item               (11 415 entries in fr-v1260)
 *   I.t[id]  → ItemType           (   123 entries)
 *   I.st[id] → boolean            (    26 "stackable" flags)
 *   I.us[idx]→ string             (slot labels — "Amulette", "Arc", …)
 *   I.ss[idx]→ string             (super-slot labels)
 *
 * Short field names preserved verbatim (matches Dofus 1.29 emitter). The
 * normalized form below renames each to a readable identifier. Sources used
 * to derive meaning:
 *
 *  - observed field histogram across all 11 415 items (always-present vs
 *    optional, and the value types)
 *  - AS2 accessor patterns in extractedscripts129 (obfuscated methods on
 *    ItemWrapper return fields like `.tw == true`, `.et == true`,
 *    `.u != undefined`, `.ce`, and consumers compare `.ep > playerSet`,
 *    `.l <= playerLevel`, `.t` is used as a type table key)
 *  - matching Dofus 1.29 retro-server emulator schemas (hetwan, Stump)
 */

import { z } from "zod";

/**
 * Effects are a packed mixed-type tuple: Dofus stores them as a flat
 * `[typeId, param1, param2, param3, param4?, ...]` with numbers, booleans,
 * and the occasional string interleaved. We keep the raw shape and let
 * higher-level code (`@dofus/effects` — a follow-up package) decode per
 * effect typeId.
 */
const EffectValue = z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]));

/** Item as stored in the raw Dofus bundle (short keys). */
export const RawItemSchema = z
  .object({
    n: z.string(),
    nn: z.string(),
    t: z.number(),
    d: z.string(),
    ep: z.number(),
    g: z.number(),
    l: z.number(),
    wd: z.boolean(),
    fm: z.boolean(),
    w: z.number(),
    p: z.number(),
    c: z.string().optional(),
    e: EffectValue.optional(),
    an: z.number().optional(),
    et: z.boolean().optional(),
    u: z.boolean().optional(),
    s: z.number().optional(),
    m: z.boolean().optional(),
    tw: z.boolean().optional(),
    ut: z.boolean().optional(),
    ce: z.boolean().optional(),
    a: z.boolean().optional(),
  })
  .passthrough();
export type RawItem = z.infer<typeof RawItemSchema>;

export const RawItemTypeSchema = z
  .object({
    n: z.string(),
    t: z.number(),
    z: z.string().optional(),
  })
  .passthrough();
export type RawItemType = z.infer<typeof RawItemTypeSchema>;

export const RawItemsBundleSchema = z
  .object({
    I: z
      .object({
        u: z.record(z.string(), RawItemSchema),
        t: z.record(z.string(), RawItemTypeSchema),
        st: z.record(z.string(), z.boolean()).optional(),
        // `us` and `ss` are minor Dofus-internal maps: `us[0]` = "Arme éthérée"
        // label (single entry), `ss[typeId]` = array of related type ids
        // (ammunition / compatible slot lookup). Not all lang versions emit
        // them, and their value shapes vary — keep them raw.
        us: z.record(z.string(), z.unknown()).optional(),
        ss: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

/** Normalized, readable item. */
export interface Item {
  id: number;
  name: string;
  nameUpper: string;
  typeId: number;
  description: string;
  itemSetId: number;
  gfxId: number;
  level: number;
  weight: number;
  npcSellPrice: number;
  forgeMagicEnabled: boolean;
  tradable: boolean;
  /** Usage criteria string, e.g. "PO>0&INT>100" — omitted when unconditional. */
  criteria?: string | undefined;
  /** Flat effect tuple (see Dofus effect table). Omitted when no effects. */
  effects?: Array<string | number | boolean | null> | undefined;
  /** Weapon animation id — present on weapons. */
  weaponAnimationId?: number | undefined;
  /** Ethereal — item expires after N uses. */
  ethereal?: boolean | undefined;
  /** Usable — right-click-use item (consumables, keys, …). */
  usable?: boolean | undefined;
  /** Secret/hidden metadata value — Dofus-internal. */
  secretValue?: number | undefined;
  /** Mimibiote / mimisymbic compatible. */
  mimibioteCompatible?: boolean | undefined;
  /** Two-handed weapon — blocks shield slot. */
  twoHanded?: boolean | undefined;
  /** Targets another entity when used (consumable). */
  useTargeted?: boolean | undefined;
  /** Bound / cannot be traded. */
  bound?: boolean | undefined;
  /** Skin/appearance-only (no stats). */
  appearanceOnly?: boolean | undefined;
}

export interface ItemType {
  id: number;
  name: string;
  superTypeId: number;
  /** Zone code (e.g. "Pa" for "Paysan") — present on a handful of harvest types. */
  zoneCode?: string | undefined;
}

export interface ItemsBundle {
  items: Map<number, Item>;
  types: Map<number, ItemType>;
  stackableFlags: Map<number, boolean>;
  /** Misc aux maps (us, ss) — raw shape varies by release; kept for callers that need them. */
  aux: {
    us: Map<number, unknown>;
    ss: Map<number, unknown>;
  };
}

function normalizeItem(id: number, raw: RawItem): Item {
  return {
    id,
    name: raw.n,
    nameUpper: raw.nn,
    typeId: raw.t,
    description: raw.d,
    itemSetId: raw.ep,
    gfxId: raw.g,
    level: raw.l,
    weight: raw.w,
    npcSellPrice: raw.p,
    forgeMagicEnabled: raw.fm,
    tradable: raw.wd,
    criteria: raw.c,
    effects: raw.e,
    weaponAnimationId: raw.an,
    ethereal: raw.et,
    usable: raw.u,
    secretValue: raw.s,
    mimibioteCompatible: raw.m,
    twoHanded: raw.tw,
    useTargeted: raw.ut,
    bound: raw.ce,
    appearanceOnly: raw.a,
  };
}

function normalizeItemType(id: number, raw: RawItemType): ItemType {
  return {
    id,
    name: raw.n,
    superTypeId: raw.t,
    zoneCode: raw.z,
  };
}

export function normalizeItemsBundle(data: unknown): ItemsBundle | null {
  const parsed = RawItemsBundleSchema.safeParse(data);
  if (!parsed.success) return null;
  const I = parsed.data.I;
  const items = new Map<number, Item>();
  for (const [idStr, raw] of Object.entries(I.u)) {
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    items.set(id, normalizeItem(id, raw));
  }
  const types = new Map<number, ItemType>();
  for (const [idStr, raw] of Object.entries(I.t)) {
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    types.set(id, normalizeItemType(id, raw));
  }
  return {
    items,
    types,
    stackableFlags: mapFromRecord<boolean>(I.st),
    aux: {
      us: mapFromRecord<unknown>(I.us),
      ss: mapFromRecord<unknown>(I.ss),
    },
  };
}

function mapFromRecord<V>(record?: Record<string, V>): Map<number, V> {
  const out = new Map<number, V>();
  if (!record) return out;
  for (const [k, v] of Object.entries(record)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    out.set(id, v);
  }
  return out;
}
