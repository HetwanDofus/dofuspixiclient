/**
 * Schemas for every Dofus 1.29 lang namespace not covered by the headline
 * files (items, spells, monsters, misc, ui-strings). Field meanings were
 * derived from:
 *
 *   - histogram of every key + type across the full corpus of entries
 *   - cross-reference with the AS2 decomp at /Users/.../extractedscripts129/
 *   - Dofus-retro emulation community knowledge (hetwan, Stump)
 *
 * Each namespace gets `Raw*` zod schemas for shape validation + a typed
 * normalized form + a `normalize*Bundle` function. Accessors live on
 * `DofusLang`.
 */

import { z } from "zod";

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

// ─────────────────────────────────────────────────────────────────────────────
// classes — G[id] = character class/breed definition (12 entries, 1..12)
// ─────────────────────────────────────────────────────────────────────────────

export const RawClassSchema = z.object({
  sn: z.string(),       // short name  (e.g. "Féca")
  ln: z.string(),       // long name   (e.g. "Le bouclier Féca")
  ep: z.number(),       // ??? (constant-ish; possibly "entry profile")
  d: z.string(),        // long description
  sd: z.string(),       // short description
  di: z.boolean(),      // disabled / hidden
  s: z.array(z.unknown()),   // starting spells (tuples)
  pt: z.string(),       // "power tags" — HTML block about strengths
  pd: z.string(),       // "power description"
  cc: z.array(z.unknown()),  // class-color zones metadata
}).passthrough();

export const RawClassesBundleSchema = z.object({
  G: z.record(z.string(), RawClassSchema),
}).passthrough();

export interface DofusClass {
  id: number;
  shortName: string;
  longName: string;
  description: string;
  shortDescription: string;
  disabled: boolean;
  entryProfile: number;
  startingSpells: unknown[];
  powerTags: string;
  powerDescription: string;
  classColorZones: unknown[];
}

export interface ClassesBundle {
  classes: Map<number, DofusClass>;
}

export function normalizeClassesBundle(data: unknown): ClassesBundle | null {
  const p = RawClassesBundleSchema.safeParse(data);
  if (!p.success) return null;
  const classes = new Map<number, DofusClass>();
  for (const [k, v] of Object.entries(p.data.G)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    classes.set(id, {
      id,
      shortName: v.sn,
      longName: v.ln,
      description: v.d,
      shortDescription: v.sd,
      disabled: v.di,
      entryProfile: v.ep,
      startingSpells: v.s,
      powerTags: v.pt,
      powerDescription: v.pd,
      classColorZones: v.cc,
    });
  }
  return { classes };
}

// ─────────────────────────────────────────────────────────────────────────────
// npc — N = { d: dialog → {name, actions[]}, a: actionLabels }
// ─────────────────────────────────────────────────────────────────────────────

export const RawNpcSchema = z.object({
  n: z.string(),
  /** Some NPCs (Percepteurs, decorative) have no menu actions. */
  a: z.array(z.number()).optional(),
}).passthrough();

export const RawNpcBundleSchema = z.object({
  N: z.object({
    d: z.record(z.string(), RawNpcSchema),
    a: z.record(z.string(), z.string()),
  }).passthrough(),
}).passthrough();

export interface Npc {
  id: number;
  name: string;
  /** IDs of the menu actions this NPC exposes (keyed into actionLabels). */
  actionIds: number[];
}

export interface NpcBundle {
  npcs: Map<number, Npc>;
  /** Generic action labels — "Acheter/Vendre", "Échanger", "Parler", … */
  actionLabels: Map<number, string>;
}

export function normalizeNpcBundle(data: unknown): NpcBundle | null {
  const p = RawNpcBundleSchema.safeParse(data);
  if (!p.success) return null;
  const npcs = new Map<number, Npc>();
  for (const [k, v] of Object.entries(p.data.N.d)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    npcs.set(id, { id, name: v.n, actionIds: v.a ?? [] });
  }
  return { npcs, actionLabels: toIdMap(p.data.N.a) };
}

// ─────────────────────────────────────────────────────────────────────────────
// dialog — D = { q: questions, a: answers }
// ─────────────────────────────────────────────────────────────────────────────

export const RawDialogBundleSchema = z.object({
  D: z.object({
    q: z.record(z.string(), z.string()),
    a: z.record(z.string(), z.string()),
  }).passthrough(),
}).passthrough();

export interface DialogBundle {
  questions: Map<number, string>;
  answers: Map<number, string>;
}

export function normalizeDialogBundle(data: unknown): DialogBundle | null {
  const p = RawDialogBundleSchema.safeParse(data);
  if (!p.success) return null;
  return {
    questions: toIdMap(p.data.D.q),
    answers: toIdMap(p.data.D.a),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// maps — MA = { m: maps[], sua: super-area names, a: areas, sa: sub-areas }
// ─────────────────────────────────────────────────────────────────────────────

export const RawMapEntrySchema = z.object({
  x: z.number(),
  y: z.number(),
  sa: z.number(),
  /** Packed cells data — absent on placeholder / unrevealed maps. */
  p1: z.string().optional(),
  p2: z.string().optional(),
  ep: z.number().optional(),
}).passthrough();

export const RawMapsBundleSchema = z.object({
  MA: z.object({
    m: z.record(z.string(), RawMapEntrySchema),
    sua: z.record(z.string(), z.string()),
    a: z.record(z.string(), z.unknown()).optional(),
    sa: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
}).passthrough();

export interface MapEntry {
  id: number;
  x: number;
  y: number;
  subAreaId: number;
  /** Packed cell data half 1 (base64 varint-alphabet, decoded by map-parser). */
  packedCells1?: string | undefined;
  /** Packed cell data half 2. */
  packedCells2?: string | undefined;
  environmentPreset?: number | undefined;
}

export interface MapsBundle {
  maps: Map<number, MapEntry>;
  /** Super-area names ("Continent Amaknien", "Zone de départ", …). */
  superAreaNames: Map<number, string>;
  /** Areas — shape varies; kept raw. */
  areas: Map<number, unknown>;
  /** Sub-areas — shape varies; kept raw. */
  subAreas: Map<number, unknown>;
}

export function normalizeMapsBundle(data: unknown): MapsBundle | null {
  const p = RawMapsBundleSchema.safeParse(data);
  if (!p.success) return null;
  const maps = new Map<number, MapEntry>();
  for (const [k, v] of Object.entries(p.data.MA.m)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    maps.set(id, {
      id,
      x: v.x,
      y: v.y,
      subAreaId: v.sa,
      packedCells1: v.p1,
      packedCells2: v.p2,
      environmentPreset: v.ep,
    });
  }
  return {
    maps,
    superAreaNames: toIdMap(p.data.MA.sua),
    areas: toIdMap(p.data.MA.a),
    subAreas: toIdMap(p.data.MA.sa),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// houses — H = { h: houses, m: mapId→houseId, d: ?, ids: ? }
// ─────────────────────────────────────────────────────────────────────────────

export const RawHouseSchema = z.object({
  n: z.string(),
  d: z.string(),
}).passthrough();

export const RawHousesBundleSchema = z.object({
  H: z.object({
    h: z.record(z.string(), RawHouseSchema),
    m: z.record(z.string(), z.number()),
    d: z.unknown().optional(),
    ids: z.array(z.number()).optional(),
  }).passthrough(),
}).passthrough();

export interface House {
  id: number;
  name: string;
  description: string;
}

export interface HousesBundle {
  houses: Map<number, House>;
  /** Map id → house id (which house occupies this map). */
  mapToHouse: Map<number, number>;
  houseIds: number[];
  extra?: unknown;
}

export function normalizeHousesBundle(data: unknown): HousesBundle | null {
  const p = RawHousesBundleSchema.safeParse(data);
  if (!p.success) return null;
  const houses = new Map<number, House>();
  for (const [k, v] of Object.entries(p.data.H.h)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    houses.set(id, { id, name: v.n, description: v.d });
  }
  return {
    houses,
    mapToHouse: toIdMap(p.data.H.m),
    houseIds: p.data.H.ids ?? [],
    extra: p.data.H.d,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// interactiveobjects — IO = { g: gfx-id-per-object-id, d: {id → {n, t, sk[]}} }
// ─────────────────────────────────────────────────────────────────────────────

export const RawInteractiveObjectDefSchema = z
  .object({
    n: z.string(),
    t: z.number(),
    /** Skill ids — stored as `[]` when populated, `{}` when empty (Dofus oddity). */
    sk: z
      .union([z.array(z.number()), z.record(z.string(), z.unknown())])
      .optional(),
  })
  .passthrough();

export const RawInteractiveObjectsBundleSchema = z
  .object({
    IO: z
      .object({
        g: z.record(z.string(), z.number()),
        d: z.record(z.string(), RawInteractiveObjectDefSchema),
      })
      .passthrough(),
  })
  .passthrough();

export interface InteractiveObjectDef {
  id: number;
  name: string;
  typeId: number;
  skillIds: number[];
}

export interface InteractiveObjectsBundle {
  /** Object id → gfx id (for map rendering). */
  gfxByObject: Map<number, number>;
  /** Object id → typed definition. */
  objects: Map<number, InteractiveObjectDef>;
}

export function normalizeInteractiveObjectsBundle(
  data: unknown
): InteractiveObjectsBundle | null {
  const p = RawInteractiveObjectsBundleSchema.safeParse(data);
  if (!p.success) return null;
  const objects = new Map<number, InteractiveObjectDef>();
  for (const [k, v] of Object.entries(p.data.IO.d)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    objects.set(id, {
      id,
      name: v.n,
      typeId: v.t,
      skillIds: Array.isArray(v.sk) ? v.sk : [],
    });
  }
  return {
    gfxByObject: toIdMap(p.data.IO.g),
    objects,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// quests — Q = { q: quests, s: steps, o: objectives, t: titles? }
// ─────────────────────────────────────────────────────────────────────────────

export const RawQuestSchema = z.object({
  n: z.string(),
  /** List of step ids — some quests have `{}` instead of `[]` when empty. */
  s: z.union([z.array(z.number()), z.record(z.string(), z.unknown())]),
}).passthrough();

export const RawQuestStepSchema = z.object({
  n: z.string(),
  d: z.string(),
  r: z.array(z.unknown()).optional(),
  rbl: z.unknown().optional(),
}).passthrough();

export const RawQuestsBundleSchema = z.object({
  Q: z.object({
    q: z.record(z.string(), RawQuestSchema),
    s: z.record(z.string(), RawQuestStepSchema),
    o: z.record(z.string(), z.unknown()).optional(),
    t: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
}).passthrough();

export interface Quest {
  id: number;
  name: string;
  stepIds: number[];
}

export interface QuestStep {
  id: number;
  name: string;
  description: string;
  rewards: unknown[] | undefined;
  rewardsByLevel: unknown;
}

export interface QuestsBundle {
  quests: Map<number, Quest>;
  steps: Map<number, QuestStep>;
  objectives: Map<number, unknown>;
  titles: Map<number, unknown>;
}

export function normalizeQuestsBundle(data: unknown): QuestsBundle | null {
  const p = RawQuestsBundleSchema.safeParse(data);
  if (!p.success) return null;
  const quests = new Map<number, Quest>();
  for (const [k, v] of Object.entries(p.data.Q.q)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    quests.set(id, {
      id,
      name: v.n,
      stepIds: Array.isArray(v.s) ? v.s : [],
    });
  }
  const steps = new Map<number, QuestStep>();
  for (const [k, v] of Object.entries(p.data.Q.s)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    steps.set(id, {
      id,
      name: v.n,
      description: v.d,
      rewards: v.r,
      rewardsByLevel: v.rbl,
    });
  }
  return {
    quests,
    steps,
    objectives: toIdMap(p.data.Q.o),
    titles: toIdMap(p.data.Q.t),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// dungeons — DU[id] = { n: name, m: rooms }
// ─────────────────────────────────────────────────────────────────────────────

export const RawDungeonRoomSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  n: z.string(),
  i: z.number().optional(),
}).passthrough();

export const RawDungeonSchema = z.object({
  n: z.string(),
  m: z.record(z.string(), RawDungeonRoomSchema),
}).passthrough();

export const RawDungeonsBundleSchema = z.object({
  DU: z.record(z.string(), RawDungeonSchema),
}).passthrough();

export interface DungeonRoom {
  mapId: number;
  x: number;
  y: number;
  z: number;
  name: string;
  /** Optional icon id for the minimap marker. */
  iconId?: number | undefined;
}

export interface Dungeon {
  id: number;
  name: string;
  rooms: Map<number, DungeonRoom>;
}

export interface DungeonsBundle {
  dungeons: Map<number, Dungeon>;
}

export function normalizeDungeonsBundle(data: unknown): DungeonsBundle | null {
  const p = RawDungeonsBundleSchema.safeParse(data);
  if (!p.success) return null;
  const dungeons = new Map<number, Dungeon>();
  for (const [k, v] of Object.entries(p.data.DU)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    const rooms = new Map<number, DungeonRoom>();
    for (const [mk, mv] of Object.entries(v.m)) {
      const mapId = Number(mk);
      if (!Number.isFinite(mapId)) continue;
      rooms.set(mapId, {
        mapId,
        x: mv.x,
        y: mv.y,
        z: mv.z,
        name: mv.n,
        iconId: mv.i,
      });
    }
    dungeons.set(id, { id, name: v.n, rooms });
  }
  return { dungeons };
}

// ─────────────────────────────────────────────────────────────────────────────
// rides — RI[id] = mount model, RIA[id] = mount ability
// ─────────────────────────────────────────────────────────────────────────────

export const RawRideSchema = z.object({
  n: z.string(),
  g: z.string(),    // gfxId as string (e.g. "7002")
  c1: z.string(),
  c2: z.string(),
  c3: z.string(),
}).passthrough();

export const RawRideAbilitySchema = z.object({
  n: z.string(),
  d: z.string(),
  e: z.string(),
}).passthrough();

export const RawRidesBundleSchema = z.object({
  RI: z.record(z.string(), RawRideSchema),
  RIA: z.record(z.string(), RawRideAbilitySchema).optional(),
}).passthrough();

export interface Ride {
  id: number;
  name: string;
  gfxId: number;
  color1: number;
  color2: number;
  color3: number;
}

export interface RideAbility {
  id: number;
  name: string;
  description: string;
  effect: string;
}

export interface RidesBundle {
  rides: Map<number, Ride>;
  abilities: Map<number, RideAbility>;
}

export function normalizeRidesBundle(data: unknown): RidesBundle | null {
  const p = RawRidesBundleSchema.safeParse(data);
  if (!p.success) return null;
  const rides = new Map<number, Ride>();
  for (const [k, v] of Object.entries(p.data.RI)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    rides.set(id, {
      id,
      name: v.n,
      gfxId: Number(v.g) || 0,
      color1: Number(v.c1),
      color2: Number(v.c2),
      color3: Number(v.c3),
    });
  }
  const abilities = new Map<number, RideAbility>();
  for (const [k, v] of Object.entries(p.data.RIA ?? {})) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    abilities.set(id, { id, name: v.n, description: v.d, effect: v.e });
  }
  return { rides, abilities };
}

// ─────────────────────────────────────────────────────────────────────────────
// skills — SK[id] = { d, j: jobId, io: interactive-object id, c: criteria, … }
// ─────────────────────────────────────────────────────────────────────────────

export const RawSkillSchema = z.object({
  d: z.string(),
  j: z.number(),
  io: z.number(),
  c: z.string().optional(),
  i: z.number().optional(),
  cl: z.array(z.unknown()).optional(),
  f: z.number().optional(),
}).passthrough();

export const RawSkillsBundleSchema = z.object({
  SK: z.record(z.string(), RawSkillSchema),
}).passthrough();

export interface Skill {
  id: number;
  description: string;
  jobId: number;
  interactiveObjectId: number;
  criteria?: string | undefined;
  /** Usage cost (gathered resources / kamas). */
  cost?: number | undefined;
  /** Additional typed list (crafting-slots or targets). */
  clientList?: unknown[] | undefined;
  /** Misc flag — craft result modifier. */
  flag?: number | undefined;
}

export interface SkillsBundle {
  skills: Map<number, Skill>;
}

export function normalizeSkillsBundle(data: unknown): SkillsBundle | null {
  const p = RawSkillsBundleSchema.safeParse(data);
  if (!p.success) return null;
  const skills = new Map<number, Skill>();
  for (const [k, v] of Object.entries(p.data.SK)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    skills.set(id, {
      id,
      description: v.d,
      jobId: v.j,
      interactiveObjectId: v.io,
      criteria: v.c,
      cost: v.i,
      clientList: v.cl,
      flag: v.f,
    });
  }
  return { skills };
}

// ─────────────────────────────────────────────────────────────────────────────
// speakingitems — SIM = messages, SIT = per-type message-id buckets
// ─────────────────────────────────────────────────────────────────────────────

export const RawSpeakingMessageSchema = z.object({
  m: z.string(),
  s: z.number(),
  l: z.number(),
  p: z.number(),
  r: z.string().optional(),
}).passthrough();

export const RawSpeakingItemsBundleSchema = z.object({
  SIM: z.record(z.string(), RawSpeakingMessageSchema),
  SIT: z.record(z.string(), z.record(z.string(), z.array(z.number()))).optional(),
}).passthrough();

export interface SpeakingMessage {
  id: number;
  message: string;
  /** Trigger state (-1 = neutral). */
  state: number;
  level: number;
  priority: number;
  /** Optional restriction / reply tag. */
  restriction?: string | undefined;
}

export interface SpeakingItemsBundle {
  messages: Map<number, SpeakingMessage>;
  /** Per-type message-id buckets (SIT[typeId][bucket] = number[]). */
  messagesByType: Map<number, Map<number, number[]>>;
}

export function normalizeSpeakingItemsBundle(
  data: unknown
): SpeakingItemsBundle | null {
  const p = RawSpeakingItemsBundleSchema.safeParse(data);
  if (!p.success) return null;
  const messages = new Map<number, SpeakingMessage>();
  for (const [k, v] of Object.entries(p.data.SIM)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    messages.set(id, {
      id,
      message: v.m,
      state: v.s,
      level: v.l,
      priority: v.p,
      restriction: v.r,
    });
  }
  const messagesByType = new Map<number, Map<number, number[]>>();
  for (const [typeK, buckets] of Object.entries(p.data.SIT ?? {})) {
    const typeId = Number(typeK);
    if (!Number.isFinite(typeId)) continue;
    const inner = new Map<number, number[]>();
    for (const [bk, bv] of Object.entries(buckets)) {
      inner.set(Number(bk), bv);
    }
    messagesByType.set(typeId, inner);
  }
  return { messages, messagesByType };
}

// ─────────────────────────────────────────────────────────────────────────────
// states — ST[id] = { n, p, d, s }
// ─────────────────────────────────────────────────────────────────────────────

export const RawStateSchema = z.object({
  n: z.string(),
  p: z.number(),
  d: z.boolean(),
  s: z.string(),
}).passthrough();

export const RawStatesBundleSchema = z.object({
  ST: z.record(z.string(), RawStateSchema),
}).passthrough();

export interface FightState {
  id: number;
  name: string;
  priority: number;
  dispellable: boolean;
  /** Symbolic state tag (empty string for most — e.g. "Neutre" has `s: ""`). */
  stateTag: string;
}

export interface StatesBundle {
  states: Map<number, FightState>;
}

export function normalizeStatesBundle(data: unknown): StatesBundle | null {
  const p = RawStatesBundleSchema.safeParse(data);
  if (!p.success) return null;
  const states = new Map<number, FightState>();
  for (const [k, v] of Object.entries(p.data.ST)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    states.set(id, {
      id,
      name: v.n,
      priority: v.p,
      dispellable: v.d,
      stateTag: v.s,
    });
  }
  return { states };
}

// ─────────────────────────────────────────────────────────────────────────────
// titles — PT[id] = { t: template, c: rgb color, pt: ? }
// ─────────────────────────────────────────────────────────────────────────────

export const RawTitleSchema = z.object({
  t: z.string(),     // label template — may contain "%1" for sex-agreement
  c: z.number(),     // RGB color (decimal)
  pt: z.number(),    // ??? (constant 0 on most)
}).passthrough();

export const RawTitlesBundleSchema = z.object({
  PT: z.record(z.string(), RawTitleSchema),
}).passthrough();

export interface PlayerTitle {
  id: number;
  label: string;
  rgb: number;
  extraTag: number;
}

export interface TitlesBundle {
  titles: Map<number, PlayerTitle>;
}

export function normalizeTitlesBundle(data: unknown): TitlesBundle | null {
  const p = RawTitlesBundleSchema.safeParse(data);
  if (!p.success) return null;
  const titles = new Map<number, PlayerTitle>();
  for (const [k, v] of Object.entries(p.data.PT)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    titles.set(id, { id, label: v.t, rgb: v.c, extraTag: v.pt });
  }
  return { titles };
}

// ─────────────────────────────────────────────────────────────────────────────
// alignment — A = { a: sides, o: orders, jo: jobs? / o-2, at: tiers, f: feats }
// ─────────────────────────────────────────────────────────────────────────────

export const RawAlignmentSideSchema = z.object({
  n: z.string(),
  c: z.boolean(),
}).passthrough();

export const RawAlignmentOrderSchema = z.object({
  n: z.string(),
  a: z.number(),   // alignment side id this order belongs to
}).passthrough();

export const RawAlignmentBundleSchema = z.object({
  A: z.object({
    a: z.record(z.string(), RawAlignmentSideSchema),
    o: z.record(z.string(), RawAlignmentOrderSchema),
    jo: z.record(z.string(), z.unknown()).optional(),
    at: z.record(z.string(), z.unknown()).optional(),
    f: z.record(z.string(), z.unknown()).optional(),
    r: z.record(z.string(), z.unknown()).optional(),
    g: z.record(z.string(), z.unknown()).optional(),
    gr: z.record(z.string(), z.unknown()).optional(),
    rt: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
}).passthrough();

export interface AlignmentSide {
  id: number;
  name: string;
  /** Whether alignment PvP is active for this side. */
  pvpActive: boolean;
}

export interface AlignmentOrder {
  id: number;
  name: string;
  sideId: number;
}

export interface AlignmentBundle {
  sides: Map<number, AlignmentSide>;
  orders: Map<number, AlignmentOrder>;
  /** Raw sub-maps kept unparsed — shape varies by release. */
  extra: {
    jo: Map<number, unknown>;
    at: Map<number, unknown>;
    f: Map<number, unknown>;
    r: Map<number, unknown>;
    g: Map<number, unknown>;
    gr: Map<number, unknown>;
    rt: Map<number, unknown>;
  };
}

export function normalizeAlignmentBundle(data: unknown): AlignmentBundle | null {
  const p = RawAlignmentBundleSchema.safeParse(data);
  if (!p.success) return null;
  const sides = new Map<number, AlignmentSide>();
  for (const [k, v] of Object.entries(p.data.A.a)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    sides.set(id, { id, name: v.n, pvpActive: v.c });
  }
  const orders = new Map<number, AlignmentOrder>();
  for (const [k, v] of Object.entries(p.data.A.o)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    orders.set(id, { id, name: v.n, sideId: v.a });
  }
  return {
    sides,
    orders,
    extra: {
      jo: toIdMap(p.data.A.jo),
      at: toIdMap(p.data.A.at),
      f: toIdMap(p.data.A.f),
      r: toIdMap(p.data.A.r),
      g: toIdMap(p.data.A.g),
      gr: toIdMap(p.data.A.gr),
      rt: toIdMap(p.data.A.rt),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// crafts — CR[jobId] = [[quantity, itemId], ...] recipes
// ─────────────────────────────────────────────────────────────────────────────

export const RawCraftsBundleSchema = z.object({
  CR: z.record(z.string(), z.array(z.array(z.number()))),
}).passthrough();

export interface CraftIngredient {
  quantity: number;
  itemId: number;
}

export interface CraftsBundle {
  /** Job (sometimes recipe) id → list of ingredient pairs. */
  recipes: Map<number, CraftIngredient[]>;
}

export function normalizeCraftsBundle(data: unknown): CraftsBundle | null {
  const p = RawCraftsBundleSchema.safeParse(data);
  if (!p.success) return null;
  const recipes = new Map<number, CraftIngredient[]>();
  for (const [k, v] of Object.entries(p.data.CR)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    recipes.set(
      id,
      v.map((pair) => ({
        quantity: pair[0] ?? 0,
        itemId: pair[1] ?? 0,
      }))
    );
  }
  return { recipes };
}

// ─────────────────────────────────────────────────────────────────────────────
// guilds — GU[tier] = guild-progression config
// ─────────────────────────────────────────────────────────────────────────────

export const RawGuildEntrySchema = z.object({
  w: z.array(z.array(z.number())),
  p: z.array(z.array(z.number())),
  c: z.array(z.array(z.number())),
  x: z.array(z.array(z.number())),
  s: z.array(z.array(z.number())),
  wm: z.number(),
  pm: z.number(),
  cm: z.number(),
  xm: z.number(),
  sm: z.number(),
}).passthrough();

export const RawGuildsBundleSchema = z.object({
  GU: z.record(z.string(), RawGuildEntrySchema),
}).passthrough();

export interface GuildTier {
  /** Tier key — Dofus uses short strings ("b", …). */
  key: string;
  wisdomTable: number[][];
  prospectionTable: number[][];
  charismaTable: number[][];
  xpTable: number[][];
  strengthTable: number[][];
  wisdomMax: number;
  prospectionMax: number;
  charismaMax: number;
  xpMax: number;
  strengthMax: number;
}

export interface GuildsBundle {
  tiers: Map<string, GuildTier>;
}

export function normalizeGuildsBundle(data: unknown): GuildsBundle | null {
  const p = RawGuildsBundleSchema.safeParse(data);
  if (!p.success) return null;
  const tiers = new Map<string, GuildTier>();
  for (const [k, v] of Object.entries(p.data.GU)) {
    tiers.set(k, {
      key: k,
      wisdomTable: v.w,
      prospectionTable: v.p,
      charismaTable: v.c,
      xpTable: v.x,
      strengthTable: v.s,
      wisdomMax: v.wm,
      prospectionMax: v.pm,
      charismaMax: v.cm,
      xpMax: v.xm,
      strengthMax: v.sm,
    });
  }
  return { tiers };
}

// ─────────────────────────────────────────────────────────────────────────────
// pvp — PP = { hp: tier-HP array, maxdp: max dishonor, grds: guards }
// ─────────────────────────────────────────────────────────────────────────────

export const RawPvpBundleSchema = z.object({
  PP: z.object({
    hp: z.array(z.number()),
    maxdp: z.number(),
    grds: z.array(z.unknown()),
  }).passthrough(),
}).passthrough();

export interface PvpBundle {
  /** HP values per alignment-honor tier. */
  honorTierHp: number[];
  maxDishonorPoints: number;
  /** Guard table — structure raw; consult game docs. */
  guards: unknown[];
}

export function normalizePvpBundle(data: unknown): PvpBundle | null {
  const p = RawPvpBundleSchema.safeParse(data);
  if (!p.success) return null;
  return {
    honorTierHp: p.data.PP.hp,
    maxDishonorPoints: p.data.PP.maxdp,
    guards: p.data.PP.grds,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// servers — SR/SRP/SRPW/SRC/SRVT/SRVC = server catalog + community tables
// ─────────────────────────────────────────────────────────────────────────────

export const RawServerSchema = z.object({
  n: z.string(),
  d: z.string(),
  l: z.string(),
  p: z.string(),
  t: z.number(),
  c: z.string(),
  date: z.string(),
  rlng: z.record(z.string(), z.string()).optional(),
}).passthrough();

export const RawServerCommunitySchema = z.object({
  n: z.string(),
  d: z.boolean(),
  i: z.number(),
  c: z.union([z.array(z.string()), z.object({}).passthrough()]).optional(),
}).passthrough();

export const RawServerVanityTitleSchema = z.object({
  l: z.string(),
  d: z.string(),
}).passthrough();

export const RawServersBundleSchema = z.object({
  SR: z.record(z.string(), RawServerSchema),
  SRP: z.record(z.string(), z.string()).optional(),
  SRPW: z.record(z.string(), z.number()).optional(),
  SRC: z.record(z.string(), RawServerCommunitySchema).optional(),
  SRVT: z.record(z.string(), RawServerVanityTitleSchema).optional(),
  SRVC: z.record(z.string(), z.string()).optional(),
}).passthrough();

export interface ServerInfo {
  id: number;
  name: string;
  description: string;
  language: string;
  population: string;
  type: number;
  community: string;
  date: string;
  langRestrictions: Map<string, string>;
}

export interface ServerCommunity {
  id: number;
  name: string;
  /** Whether a new character may default to this community. */
  defaultAllowed: boolean;
  iconId: number;
  countryCodes: string[];
}

export interface ServerVanityTitle {
  key: string;
  label: string;
  description: string;
}

export interface ServersBundle {
  servers: Map<number, ServerInfo>;
  /** SRP = server-provider map (e.g. 0 → "Ankama", 1 → "Steam"). */
  providers: Map<number, string>;
  /** SRPW = provider weight / ordering. */
  providerWeights: Map<number, number>;
  communities: Map<number, ServerCommunity>;
  vanityTitles: Map<number, ServerVanityTitle>;
  /** SRVC = vanity-class labels keyed by composite "a|b" strings; kept raw. */
  vanityClasses: Record<string, string>;
}

export function normalizeServersBundle(data: unknown): ServersBundle | null {
  const p = RawServersBundleSchema.safeParse(data);
  if (!p.success) return null;
  const servers = new Map<number, ServerInfo>();
  for (const [k, v] of Object.entries(p.data.SR)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    const langMap = new Map<string, string>();
    for (const [lk, lv] of Object.entries(v.rlng ?? {})) langMap.set(lk, lv);
    servers.set(id, {
      id,
      name: v.n,
      description: v.d,
      language: v.l,
      population: v.p,
      type: v.t,
      community: v.c,
      date: v.date,
      langRestrictions: langMap,
    });
  }
  const communities = new Map<number, ServerCommunity>();
  for (const [k, v] of Object.entries(p.data.SRC ?? {})) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    communities.set(id, {
      id,
      name: v.n,
      defaultAllowed: v.d,
      iconId: v.i,
      countryCodes: Array.isArray(v.c) ? v.c : [],
    });
  }
  const vanityTitles = new Map<number, ServerVanityTitle>();
  for (const [k, v] of Object.entries(p.data.SRVT ?? {})) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    vanityTitles.set(id, { key: k, label: v.l, description: v.d });
  }
  return {
    servers,
    providers: toIdMap(p.data.SRP),
    providerWeights: toIdMap(p.data.SRPW),
    communities,
    vanityTitles,
    vanityClasses: { ...(p.data.SRVC ?? {}) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// flat numeric-keyed string maps — itemstats, subtitles, scripts, names
// ─────────────────────────────────────────────────────────────────────────────

export interface StringTableBundle {
  entries: Map<number, string>;
}

function stringTableNormalizer(topLevelKey: string) {
  const Schema = z
    .object({ [topLevelKey]: z.record(z.string(), z.string()) })
    .passthrough();
  return (data: unknown): StringTableBundle | null => {
    const p = Schema.safeParse(data);
    if (!p.success) return null;
    const record = (p.data as Record<string, Record<string, string>>)[topLevelKey] ?? {};
    return { entries: toIdMap(record) };
  };
}

export const normalizeItemStatsBundle = stringTableNormalizer("ISTA");
export const normalizeScriptsBundle = stringTableNormalizer("SCR");

/**
 * Subtitles nest one level deeper — SUB[cinematicId][lineId] = "line". Each
 * cinematic has its own subtitle track.
 */
export const RawSubtitlesBundleSchema = z
  .object({ SUB: z.record(z.string(), z.record(z.string(), z.string())) })
  .passthrough();

export interface SubtitlesBundle {
  /** Cinematic id → (line id → subtitle line). */
  byCinematic: Map<number, Map<number, string>>;
}

export function normalizeSubtitlesBundle(data: unknown): SubtitlesBundle | null {
  const p = RawSubtitlesBundleSchema.safeParse(data);
  if (!p.success) return null;
  const byCinematic = new Map<number, Map<number, string>>();
  for (const [cinematicId, lines] of Object.entries(p.data.SUB)) {
    byCinematic.set(Number(cinematicId), toIdMap(lines));
  }
  return { byCinematic };
}

/**
 * names — NF has two sub-tables (probably male / female) → {id: firstName}.
 * We expose both raw; the gender key (n/m in the bundle) is kept so callers
 * can pick.
 */
export const RawNamesBundleSchema = z
  .object({ NF: z.record(z.string(), z.record(z.string(), z.string())) })
  .passthrough();

export interface NamesBundle {
  /** Gender code → Map<id, firstName>. */
  byGender: Map<string, Map<number, string>>;
}

export function normalizeNamesBundle(data: unknown): NamesBundle | null {
  const p = RawNamesBundleSchema.safeParse(data);
  if (!p.success) return null;
  const byGender = new Map<string, Map<number, string>>();
  for (const [g, table] of Object.entries(p.data.NF)) {
    byGender.set(g, toIdMap(table));
  }
  return { byGender };
}

// ─────────────────────────────────────────────────────────────────────────────
// timezones — T = { mspd, hpd, z: zones, tz: offsets, m: month labels }
// ─────────────────────────────────────────────────────────────────────────────

export const RawTimezonesBundleSchema = z
  .object({
    /**
     * Shape varies across releases: some have `T.z` as a number (total
     * zones), others as an object; `T.tz` and `T.m` may be arrays or
     * objects. Kept loose — expose raw values.
     */
    T: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export interface TimezonesBundle {
  millisecondsPerDay?: number | undefined;
  hoursPerDay?: number | undefined;
  /** Raw sub-values as emitted by the SWF — structure varies. */
  raw: Map<string, unknown>;
}

export function normalizeTimezonesBundle(
  data: unknown
): TimezonesBundle | null {
  const p = RawTimezonesBundleSchema.safeParse(data);
  if (!p.success) return null;
  const raw = new Map<string, unknown>();
  for (const [k, v] of Object.entries(p.data.T)) raw.set(k, v);
  return {
    millisecondsPerDay:
      typeof p.data.T.mspd === "number" ? p.data.T.mspd : undefined,
    hoursPerDay: typeof p.data.T.hpd === "number" ? p.data.T.hpd : undefined,
    raw,
  };
}
