/**
 * Imports the world's *content* — monsters, their per-level stats and drops,
 * items, item sets and NPCs — from a StarLoco `game.sql` dump plus the 1.29
 * lang bundles.
 *
 * Why this exists: `just import-maps` fills the world geometry, but
 * `monster_templates`, `item_templates` and `npc_templates` stay empty, and a
 * fresh database therefore has nothing *in* the world. `MapMonsterService`
 * parses a perfectly good pool out of `maps.monsters_raw`, resolves none of it
 * against `monster_templates`, and logs `spawned 0 monster groups` on every
 * map — so no fight can ever start and the whole combat runtime is untestable.
 *
 *   curl -LO https://raw.githubusercontent.com/StarLoco/StarLoco-Game/master/game.sql
 *   DATABASE_URL=... bun run scripts/import-starloco-content.ts game.sql
 *
 * Run it *after* `just import-maps`: NPC placements reference `maps.id`.
 *
 * ── Where each field comes from ────────────────────────────────────────────
 *
 * Same rule as the map importer: **the 1.29 lang bundles win wherever they
 * have an entry**, because StarLoco targets 1.39.8 while this project targets
 * 1.29, and the bundles are extracted from the retail 1.29 SWFs. The dump
 * fills in everything the client was never told.
 *
 *   monsters      names, gfx and grade levels + resistances from `monsters.json`;
 *                 life / AP / MP / initiative / stats / spells / XP / kamas
 *                 from the dump (the client is not told those).
 *   items         *entirely* from `items.json` + `itemstats.json` — the dump has
 *                 no gfx id at all, and its 1.39 `statsTemplate` has already
 *                 lost effects the 1.29 client still lists (item 40 keeps its
 *                 `+1 Force` in the bundle, not in the dump).
 *   item sets     names from `itemsets.json`, per-item-count bonuses from the
 *                 dump (the bundle carries no bonuses).
 *   NPCs          names from `npc.json`, look + dialog entry point from the
 *                 dump, placement from the dump's `npcs` table.
 *   drops         dump only.
 *
 * ── Two things worth knowing about the encodings ───────────────────────────
 *
 *  - **The bundle's flat arrays come out back-to-front.** A monster grade's
 *    `r` is `[neutral%, earth%, fire%, water%, air%, dodgeAPLost, dodgePMLost]`
 *    where `dofus.datacenter.Monster.resistances` reads it, but the extracted
 *    JSON lists it in the opposite order — `ActionInitArray` in
 *    `ExtractLangsCommand` unwinds the AVM1 stack the other way round. The
 *    dump needs no such treatment: StarLoco's `MonsterGrade` parses the
 *    `grades` resist list straight into `STATS_ADD_RP_NEU`, `_TER`, `_FEU`,
 *    `_EAU`, `_AIR`, `_ADODGE`, `_MDODGE`, i.e. already in client order. The
 *    two agree once the bundle's copy is reversed, on 1 212 of the 1 345
 *    monsters both describe (the rest is 1.39 rebalancing).
 *
 *    Note this does *not* hold for `spells.json`, whose level arrays really
 *    are in client index order — see migration 0039.
 *
 *  - **`maps.monsters_raw` holds levels, not grade indices.** `52,1` is
 *    "Arakne at level 1", not "Arakne grade 1"; the second number runs up to
 *    900 across the dump. That is why `monster_levels` is keyed by level and
 *    `MapMonsterService.buildMembers` can look a member up directly.
 *
 * ── What this importer deliberately drops ──────────────────────────────────
 *
 * These have no column to land in, and inventing one is a schema decision for
 * a feature that does not exist yet:
 *
 *  - weapon AP cost / range / critical rate (bundle `e`, dump `armesInfos`) —
 *    `item_templates` has no weapon-info column, so close-combat weapon stats
 *    are not stored;
 *  - an NPC's for-sale item list (dump `ventes`) — `npc_templates.sale_store_id`
 *    is a single id and StarLoco stores the list inline, so it stays 0;
 *  - `aggroDistance`, `isBoss`, `isArchmonster`, `capturable` — no columns on
 *    `monster_templates`;
 *  - per-grade drop rates: `monster_drops.rate` is one number per (monster,
 *    item), so grade 1's rate is stored (falling back to the first non-zero
 *    grade for the nine drops that only start at a higher grade).
 */
import { basename } from "node:path";

import { CamelCasePlugin, Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";

import {
  filterDialogGraph,
  type ImportedDialogAction,
  type ImportedDialogQuestion,
} from "./dialog-graph.ts";
import { insertRows, langBundlePath, toRecord } from "./starloco-dump.ts";

const dumpPath = process.argv[2];

if (!dumpPath) {
  console.error(
    "usage: bun run scripts/import-starloco-content.ts <path/to/game.sql>"
  );
  process.exit(1);
}

const connectionString =
  process.env.DATABASE_URL ?? "postgres://dofus:dofus@localhost:5432/dofus";

// biome-ignore lint/suspicious/noExplicitAny: this importer writes to tables named at runtime (`upsert(table, …)`), so it cannot be bound to the `DB` interface — a typed Kysely rejects `insertInto(string)` outright.
const db = new Kysely<any>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  plugins: [new CamelCasePlugin()],
});

const BATCH = 500;

/**
 * Parses a dump field, falling back when there is nothing to parse.
 *
 * The empty-string guard is what makes the fallbacks mean anything:
 * `Number("")` is 0, not `NaN`, so without it a monster whose `pdvs` list is
 * shorter than its grade list would be stored with 0 life rather than the
 * 50-HP default, and one with no `points` entry would get 0 AP and 0 MP and
 * never act in a fight.
 */
function num(v: unknown, fallback = 0): number {
  if (typeof v === "string" && v.trim() === "") {
    return fallback;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Ids of a `;`/`,`-separated list, in order, skipping anything non-numeric. */
function idList(v: unknown): number[] {
  const out: number[] = [];
  for (const part of String(v ?? "").split(/[;,]/)) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isFinite(n)) {
      out.push(n);
    }
  }
  return out;
}

/**
 * Non-empty entries of a `;`/`,`-separated list, kept as text. Dialog question
 * parameters are `#N` substitution values and are not all numeric — 16
 * questions use them and some hold placeholders like `[name]`.
 */
function textList(v: unknown): string[] {
  return String(v ?? "")
    .split(/[;,]/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/**
 * First id of a `;`/`,`-separated list, 0 when there is none. StarLoco stores
 * several id lists as free text where a single id is the common case.
 */
function firstId(v: unknown): number {
  for (const part of String(v ?? "").split(/[;,]/)) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return 0;
}

/**
 * `monsters.colors` is a `c1,c2,c3` triple of **hexadecimal** RGB strings —
 * the same encoding the canonical GM packet ships and that the 1.29 client
 * reads back with `Number("0x" + value)`
 * (`assets/sources/client-code/dofus/managers/CharactersManager.as:281-283`).
 * `-1` means "leave that colour zone with the artwork's own palette".
 *
 * Reading it with `num()` was the bug behind QA-096: `Number("f9f9a5")` is
 * `NaN` and fell back to -1, while a triple that happens to be all digits
 * (`448051`) was kept as decimal instead of `0x448051`. 61 of the 1 388
 * monsters carry a real colour and all 61 were destroyed — which is why five
 * of the six pious rendered in the base blue even though the roster panel
 * named them correctly. Their six sprites are the same drawing: the
 * `.dofasset` files 1212 and 9202..9206 differ only in the id byte of their
 * header, so the colour triple *is* the variant.
 *
 * NPCs are unaffected and must keep `num()`: `npc_template.color1/2/3` really
 * are decimal integers in the same dump.
 */
function hexColor(v: unknown): number {
  const raw = String(v ?? "").trim();
  if (raw === "" || raw === "-1") {
    return -1;
  }
  const n = Number.parseInt(raw, 16);
  return Number.isFinite(n) ? n : -1;
}

/** Splits `'a|b|c'` into its non-empty parts. */
function pipes(raw: string): string[] {
  return raw.split("|").filter((p) => p.length > 0);
}

/** Upserts in batches, replacing every column the importer owns. */
async function upsert(
  table: string,
  conflict: string[],
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const firstRow = rows[0];
  const firstConflict = conflict[0];
  if (!firstRow || !firstConflict) {
    throw new Error(`upsert ${table}: rows and conflict columns are required`);
  }
  const columns = Object.keys(firstRow).filter((c) => !conflict.includes(c));

  // biome-ignore lint/suspicious/noExplicitAny: builder callbacks inherit the untyped `Kysely<any>` above, so there is no narrower type to give them.
  const onConflict = (oc: any) =>
    (conflict.length === 1
      ? oc.column(firstConflict)
      : oc.columns(conflict)
    ).doUpdateSet((eb: { ref: (c: string) => unknown }) =>
      Object.fromEntries(columns.map((c) => [c, eb.ref(`excluded.${c}`)]))
    );

  for (let i = 0; i < rows.length; i += BATCH) {
    await db
      .insertInto(table)
      .values(rows.slice(i, i + BATCH))
      .onConflict(onConflict)
      .execute();
  }
}

// ── Lang bundles ────────────────────────────────────────────────────────────

interface LangMonsterGrade {
  /** Monster level at this grade. */
  l: number;
  /** Resistances — stored back-to-front, see the header. */
  r: number[];
}

interface LangMonster {
  n: string;
  /** Sprite id. */
  g: number;
  [grade: string]: unknown;
}

interface LangItem {
  n: string;
  /** Item type id — `superType` is a property of the *type*, not the item. */
  t: number;
  /** Sprite id. The dump has no equivalent. */
  g: number;
  l: number;
  /** Weight in pods. */
  w: number;
  /** Price an NPC sells it for. */
  p: number;
  /** Description text, shown in the item detail panel. */
  d?: string;
  /** Criteria expression, e.g. `CS>4`. */
  c?: string;
  /** Present (and `true`) on two-handed weapons. */
  tw?: boolean;
  /** Present when the item can be used. */
  u?: boolean;
  /** Present when using it asks for a target. */
  ut?: boolean;
  /** Item set id, absent when the item belongs to none. */
  s?: number;
}

/** One entry of `items.json`'s `I.t` — an item *type* (Amulette, Epée, …). */
interface LangItemType {
  n?: string;
  /** Super-type id (broad classification used for filtering/equip rules). */
  t?: number;
  /** Weapon "zone" code (`Pa`, `Tb`, `Xb`) — melee/ranged reach class. */
  z?: string;
}

async function bundle<T>(namespace: string): Promise<T> {
  const path = langBundlePath(namespace);
  const json = (await Bun.file(path).json()) as { data: T };
  return json.data;
}

const langMonsters = (
  await bundle<{ M: Record<string, LangMonster> }>("monsters")
).M;
const langNpcNames = (
  await bundle<{ N: { d: Record<string, { n: string }> } }>("npc")
).N.d;
const langItemsData = await bundle<{
  I: {
    u: Record<string, LangItem>;
    t: Record<string, LangItemType>;
    /** superType id → legal equipment positions (`{}` = not equippable). */
    ss: Record<string, number[] | Record<string, never>>;
  };
}>("items");
const langItems = langItemsData.I.u;
const langItemTypes = langItemsData.I.t;
const langItemSuperTypes = langItemsData.I.ss;
const langItemStats = (
  await bundle<{ ISTA: Record<string, string> }>("itemstats")
).ISTA;
const langItemSets = (
  await bundle<{ IS: Record<string, { n: string }> }>("itemsets")
).IS;
const langDialog = (
  await bundle<{
    D: { q: Record<string, string>; a: Record<string, string> };
  }>("dialog")
).D;

console.log(
  `lang bundles: ${Object.keys(langMonsters).length} monsters, ` +
    `${Object.keys(langItems).length} items ` +
    `(${Object.keys(langItemStats).length} with base effects), ` +
    `${Object.keys(langItemSets).length} item sets, ` +
    `${Object.keys(langNpcNames).length} NPC names`
);

// ── Read the dump ───────────────────────────────────────────────────────────

const dump = await Bun.file(dumpPath).text();
console.log(
  `read ${basename(dumpPath)} (${(dump.length / 1e6).toFixed(1)} MB)`
);

// ── Monsters ────────────────────────────────────────────────────────────────

/** Column order of StarLoco's `monsters` table. */
const MONSTER_COLUMNS = [
  "id",
  "name",
  "gfxID",
  "align",
  "grades",
  "colors",
  "stats",
  "statsInfos",
  "spells",
  "pdvs",
  "points",
  "inits",
  "minKamas",
  "maxKamas",
  "exps",
  "AI_Type",
  "capturable",
  "type",
  "aggroDistance",
  "isBoss",
  "isArchmonster",
] as const;

/**
 * `monsters.AI_Type` is StarLoco's behaviour selector. The five values its
 * schema comments are the ones canonical 1.29 has; everything above them is a
 * StarLoco-specific script. `monster_templates.ai_profile_id` is a foreign
 * key, so every value seen has to exist as a row — named ones get their name,
 * the rest get a placeholder so the reference resolves.
 */
const AI_PROFILE_NAMES: Record<number, string> = {
  0: "Poutch",
  1: "Aggressive",
  2: "Fleeing",
  3: "Support",
  4: "Special",
};

const ELEMENT_KEYS = [
  "neutral",
  "earth",
  "fire",
  "water",
  "air",
  "apLoss",
  "mpLoss",
] as const;

/**
 * Order of the five values in `monsters.stats`, per its column comment and
 * StarLoco's own `MonsterGrade` (`STATS_ADD_FORC` … `_AGIL`).
 */
const STAT_KEYS = [
  "strength",
  "wisdom",
  "intelligence",
  "chance",
  "agility",
] as const;

/**
 * `monsters.statsInfos` — `'dmg;%dmg;soins;créainv'` per its column comment,
 * read by `MonsterGrade` into `STATS_ADD_DOMA`, `_PERDOM`, `_SOIN` and
 * `STATS_SUMMON_COUNT`. It is one value per monster, not per grade, so every
 * grade carries the same four.
 */
const STAT_INFO_KEYS = [
  "damageBonus",
  "damagePercent",
  "healBonus",
  "maxSummons",
] as const;

function resistancesFrom(values: number[]): Record<string, number> {
  return Object.fromEntries(ELEMENT_KEYS.map((k, i) => [k, values[i] ?? 0]));
}

function statsFrom(raw: string, statsInfos: string): Record<string, number> {
  const parts = raw.split(",").map((v) => num(v));
  const infos = statsInfos.split(";").map((v) => num(v));
  return Object.fromEntries([
    ...STAT_KEYS.map((k, i) => [k, parts[i] ?? 0]),
    ...STAT_INFO_KEYS.map((k, i) => [k, infos[i] ?? 0]),
  ]);
}

/** `'212@1;213@1'` → the spell list `MapMonsterService.parseSpells` expects. */
function spellsFrom(raw: string): Array<{ spellId: number; level: number }> {
  const out: Array<{ spellId: number; level: number }> = [];
  for (const entry of raw.split(";").filter(Boolean)) {
    const [idPart, levelPart] = entry.split("@");
    const spellId = num(idPart);
    if (spellId > 0) {
      out.push({ spellId, level: Math.max(1, num(levelPart, 1)) });
    }
  }
  return out;
}

const aiProfileIds = new Set<number>();
const monsterTemplates: Record<string, unknown>[] = [];
const monsterLevels: Record<string, unknown>[] = [];
const monsterIds = new Set<number>();
let gradesWithoutLevel = 0;
let duplicateGradeLevels = 0;

for (const values of insertRows(dump, "monsters")) {
  const row = toRecord(MONSTER_COLUMNS, values);
  const id = num(row.id, -1);
  if (id <= 0) {
    continue;
  }

  const lang = langMonsters[String(id)];
  const [color1, color2, color3] = row.colors.split(",").map(hexColor);
  const aiProfileId = num(row.AI_Type);

  aiProfileIds.add(aiProfileId);
  monsterIds.add(id);

  monsterTemplates.push({
    id,
    name: (lang?.n ?? row.name).slice(0, 128),
    gfx: lang?.g ?? num(row.gfxID),
    aiProfileId,
    color1: color1 ?? -1,
    color2: color2 ?? -1,
    color3: color3 ?? -1,
  });

  // One `monster_levels` row per grade. Every per-grade column is a `|`-joined
  // list in grade order; a few monsters have shorter lists than they have
  // grades, so each lookup falls back rather than dropping the grade.
  const grades = pipes(row.grades);
  const lives = pipes(row.pdvs);
  const points = pipes(row.points);
  const inits = pipes(row.inits);
  const stats = pipes(row.stats);
  const spells = pipes(row.spells);
  const exps = pipes(row.exps);
  const seenLevels = new Set<number>();

  for (const [index, grade] of grades.entries()) {
    const [levelPart, resistPart] = grade.split("@");
    const langGrade = lang?.[`g${index + 1}`] as LangMonsterGrade | undefined;

    // 1.29 grade levels win: StarLoco flattened some of them (Wo Wabbit is
    // 35/37/39/41/43 in the bundle and 39 five times over in the dump), and
    // the flattened ones stop `maps.monsters_raw` from resolving at all.
    const level = langGrade?.l ?? num(levelPart);
    if (level <= 0) {
      gradesWithoutLevel++;
      continue;
    }

    // `monster_levels` is keyed by (monster, level), but a monster really can
    // have several grades at one level — Arakne is level 1 twice over, in the
    // bundle as well as the dump. Only the first is reachable through
    // `monsters_raw`, so keep it and count the rest.
    if (seenLevels.has(level)) {
      duplicateGradeLevels++;
      continue;
    }
    seenLevels.add(level);

    const resistances = langGrade
      ? // The bundle's array is back-to-front; the dump's is not — see the
        // header.
        resistancesFrom([...langGrade.r].reverse())
      : resistancesFrom((resistPart ?? "").split(";").map((v) => num(v)));

    const [ap, mp] = (points[index] ?? "").split(";");

    monsterLevels.push({
      monsterId: id,
      level,
      life: num(lives[index], 50),
      initiative: num(inits[index]),
      ap: num(ap, 6),
      mp: num(mp, 3),
      stats: JSON.stringify(statsFrom(stats[index] ?? "", row.statsInfos)),
      resistances: JSON.stringify(resistances),
      spells: JSON.stringify(spellsFrom(spells[index] ?? "")),
      xp: String(Math.max(0, Math.trunc(num(exps[index])))),
      kamasMin: num(row.minKamas),
      kamasMax: num(row.maxKamas),
    });
  }
}

await upsert(
  "monsterAiProfiles",
  ["id"],
  [...aiProfileIds]
    .sort((a, b) => a - b)
    .map((id) => ({
      id,
      name: (AI_PROFILE_NAMES[id] ?? `StarLoco AI ${id}`).slice(0, 64),
      config: JSON.stringify({}),
    }))
);
console.log(`upserted ${aiProfileIds.size} monster AI profiles`);

await upsert("monsterTemplates", ["id"], monsterTemplates);
console.log(`upserted ${monsterTemplates.length} monster templates`);

await upsert("monsterLevels", ["monsterId", "level"], monsterLevels);
console.log(
  `upserted ${monsterLevels.length} monster levels ` +
    `(${duplicateGradeLevels} grades share a level with an earlier grade, ` +
    `${gradesWithoutLevel} have no level at all)`
);

// ── Drops ───────────────────────────────────────────────────────────────────

/** Column order of StarLoco's `drops` table. */
const DROP_COLUMNS = [
  "monsterName",
  "monsterId",
  "objectName",
  "objectId",
  "percentGrade1",
  "percentGrade2",
  "percentGrade3",
  "percentGrade4",
  "percentGrade5",
  "ceil",
  "action",
  "level",
] as const;

const drops: Record<string, unknown>[] = [];
const seenDrops = new Set<string>();
let dropsWithoutMonster = 0;

for (const values of insertRows(dump, "drops")) {
  const row = toRecord(DROP_COLUMNS, values);
  const monsterId = num(row.monsterId, -1);
  const itemTemplateId = num(row.objectId, -1);
  if (itemTemplateId <= 0) {
    continue;
  }

  // `monster_drops.monster_id` is a foreign key. Rows at monster 0 are the
  // dump's "drops from anything" parchments, and there is nothing to hang
  // them off.
  if (!monsterIds.has(monsterId)) {
    dropsWithoutMonster++;
    continue;
  }

  const key = `${monsterId}:${itemTemplateId}`;
  if (seenDrops.has(key)) {
    continue;
  }
  seenDrops.add(key);

  const perGrade = [
    row.percentGrade1,
    row.percentGrade2,
    row.percentGrade3,
    row.percentGrade4,
    row.percentGrade5,
  ].map((v) => num(v));

  drops.push({
    monsterId,
    itemTemplateId,
    // One rate per (monster, item) — grade 1's, or the first grade that drops
    // it at all for the handful that only start higher up.
    rate: perGrade[0] || perGrade.find((r) => r > 0) || 0,
    minQuantity: 1,
    maxQuantity: 1,
  });
}

await upsert("monsterDrops", ["monsterId", "itemTemplateId"], drops);
console.log(
  `upserted ${drops.length} monster drops ` +
    `(${dropsWithoutMonster} skipped: no such monster)`
);

// ── Item sets ───────────────────────────────────────────────────────────────

/** Column order of StarLoco's `itemsets` table. */
const ITEMSET_COLUMNS = ["ID", "name", "items", "bonus"] as const;

/**
 * `'118:5,126:5;118:10,126:10'` → one entry per item count, starting at two
 * items worn (a one-item set bonus does not exist). Empty segments are real:
 * some sets grant nothing until the fourth piece.
 */
function setBonuses(
  raw: string
): Array<{ items: number; effects: Array<{ id: number; value: number }> }> {
  const out: Array<{
    items: number;
    effects: Array<{ id: number; value: number }>;
  }> = [];

  for (const [index, segment] of raw.split(";").entries()) {
    const effects = segment
      .split(",")
      .filter(Boolean)
      .flatMap((pair) => {
        const [id, value] = pair.split(":");
        const effectId = num(id, -1);
        return effectId > 0 ? [{ id: effectId, value: num(value) }] : [];
      });
    if (effects.length > 0) {
      out.push({ items: index + 2, effects });
    }
  }

  return out;
}

const dumpSetBonuses = new Map<number, string>();
for (const values of insertRows(dump, "itemsets")) {
  const row = toRecord(ITEMSET_COLUMNS, values);
  dumpSetBonuses.set(num(row.ID, -1), row.bonus);
}

const itemSets = Object.entries(langItemSets).map(([id, set]) => ({
  id: num(id),
  name: set.n.slice(0, 128),
  bonuses: JSON.stringify(setBonuses(dumpSetBonuses.get(num(id)) ?? "")),
}));

await upsert("itemSets", ["id"], itemSets);
console.log(
  `upserted ${itemSets.length} item sets ` +
    `(${dumpSetBonuses.size} carried bonuses in the dump)`
);

// ── Items ───────────────────────────────────────────────────────────────────

interface ItemEffect {
  id: number;
  param1: number;
  param2: number;
  /** Raw fourth field — a dice formula on weapons, a hex number elsewhere. */
  param3: string;
}

/**
 * Decodes one 1.29 base-effect string, e.g. `64#1#7#1d7+0,76#1##0d0+1`.
 *
 * This is `itemstats.json` — the very string the retail client reads, so the
 * decode is `dofus.datacenter.Item.getBaseItemEffects` verbatim: comma
 * separated effects of `type#param1#param2#param3`, every field hexadecimal
 * and every field optionally empty. The client's names are kept rather than
 * `min`/`max` because only the value-range effects use them that way — for
 * effect 100 (damage) param1/param2 really are the low and high roll, but for
 * effect 983 they are a duration and a flag.
 *
 * `param3` stays a string: on a weapon it is a dice formula (`1d7+0`) which
 * the client only ever hex-parses by accident, and narrowing it to a number
 * would throw the roll away.
 *
 * StarLoco's `statsTemplate` is the same shape with one extra field, but it is
 * 1.39 data and has already lost effects the 1.29 client still shows — item 40
 * keeps its `+1 Force` in the bundle and not in the dump.
 */
function itemEffects(raw: string): ItemEffect[] {
  const out: ItemEffect[] = [];

  for (const entry of raw.split(",").filter(Boolean)) {
    const [id, param1, param2, param3] = entry.split("#");
    const effectId = Number.parseInt(id ?? "", 16);
    if (!Number.isFinite(effectId)) {
      continue;
    }

    out.push({
      id: effectId,
      // The client maps 0 onto `undefined`; JSON has no such thing, and 0 is
      // what any consumer would coerce it back to anyway.
      param1: Number.parseInt(param1 ?? "", 16) || 0,
      param2: Number.parseInt(param2 ?? "", 16) || 0,
      param3: param3 ?? "",
    });
  }

  return out;
}

const itemTemplates = Object.entries(langItems).map(([id, item]) => ({
  id: num(id),
  name: item.n.slice(0, 128),
  type: item.t,
  level: item.l,
  weight: item.w,
  gfxId: item.g,
  effects: JSON.stringify(itemEffects(langItemStats[id] ?? "")),
  criteria: item.c ?? "",
  twoHanded: item.tw === true,
  itemSetId: item.s ?? 0,
  // The client's own test: `canUse`/`canTarget` are "is the field present",
  // not "is it true" (`dofus.datacenter.Item.canUse`).
  usable: item.u !== undefined,
  targetable: item.ut !== undefined,
  price: item.p,
  // A super-type is a property of the item *type*, not of the item —
  // `Item.superType` reads it off `getItemTypeText(type).t`.
  superType: langItemTypes[String(item.t)]?.t ?? 0,
  description: item.d ?? "",
}));

await upsert("itemTemplates", ["id"], itemTemplates);
console.log(
  `upserted ${itemTemplates.length} item templates ` +
    `(${itemTemplates.filter((i) => i.effects !== "[]").length} with effects)`
);

// ── Item types & super-types ────────────────────────────────────────────────
//
// The inventory window needs to name an item's type ("Amulette", "Epée") and
// know which equipment positions a superType may occupy — both come straight
// off `items.json`'s `I.t`/`I.ss` tables, not off the dump, which knows
// nothing about item presentation at all.

const itemTypes = Object.entries(langItemTypes).map(([id, type]) => ({
  id: num(id),
  name: (type.n ?? "").slice(0, 64),
  superType: type.t ?? 0,
  effectZone: type.z ?? null,
}));

await upsert("itemTypes", ["id"], itemTypes);
console.log(`upserted ${itemTypes.length} item types`);

// `{}` marks a superType with no legal equip position (resources, quest
// objects, …). For the equippable superTypes (amulet, weapon, ring, belt,
// boot, shield, hat, cape, pet, dofus, mount) the list is exactly the
// worn positions and matches `EquipmentPosition` in
// `packages/protocol/src/item-types.ts` one-for-one. A handful of
// non-equippable superTypes (e.g. 26 "Toniques") also carry a non-empty
// list here — those values sit outside 0..16 and never coincide with a
// real `EquipmentPosition`, so `canEquip()`'s position-range check makes
// them inert rather than something a caller needs to filter out here.
const itemSuperTypes = Object.entries(langItemSuperTypes).map(
  ([id, positions]) => ({
    id: num(id),
    positions: `{${(Array.isArray(positions) ? positions : []).join(",")}}`,
  })
);

await upsert("itemSuperTypes", ["id"], itemSuperTypes);
console.log(
  `upserted ${itemSuperTypes.length} item super-types ` +
    `(${itemSuperTypes.filter((s) => s.positions !== "{}").length} equippable)`
);

// ── NPCs ────────────────────────────────────────────────────────────────────

/** Column order of StarLoco's `npc_template` table. */
const NPC_TEMPLATE_COLUMNS = [
  "id",
  "bonusValue",
  "gfxID",
  "scaleX",
  "scaleY",
  "sex",
  "color1",
  "color2",
  "color3",
  "accessories",
  "extraClip",
  "customArtWork",
  "initQuestion",
  "ventes",
  "quests",
  "exchanges",
  "path",
  "informations",
] as const;

/** Column order of StarLoco's `npc_questions` table. */
const NPC_QUESTION_COLUMNS = [
  "ID",
  "responses",
  "params",
  "cond",
  "ifFalse",
  "description",
] as const;

/** Column order of StarLoco's `npc_reponses_actions` table. */
const NPC_RESPONSE_ACTION_COLUMNS = ["ID", "type", "args", "nom"] as const;

/** Column order of StarLoco's `npcs` (placement) table. */
const NPC_PLACEMENT_COLUMNS = [
  "mapid",
  "npcid",
  "cellid",
  "orientation",
  "isMovable",
] as const;

const npcTemplates: Record<string, unknown>[] = [];
const npcIds = new Set<number>();

for (const values of insertRows(dump, "npc_template")) {
  const row = toRecord(NPC_TEMPLATE_COLUMNS, values);
  const id = num(row.id, -1);
  if (id <= 0) {
    continue;
  }

  npcIds.add(id);
  npcTemplates.push({
    id,
    name: (langNpcNames[String(id)]?.n ?? "").slice(0, 64),
    gfx: num(row.gfxID),
    // Percentages, 100 = life size. The dump leaves them empty for most
    // NPCs; `num`'s fallback is what makes that mean "life size" rather
    // than a zero-sized sprite. Column added by migration 0051.
    scaleX: num(row.scaleX, 100) || 100,
    scaleY: num(row.scaleY, 100) || 100,
    sex: num(row.sex),
    color1: num(row.color1, -1),
    color2: num(row.color2, -1),
    color3: num(row.color3, -1),
    accessories: row.accessories,
    extraClip: num(row.extraClip, -1),
    customArtwork: num(row.customArtWork),
    // `initQuestion` is a text column: a single id, `-1` when the NPC has no
    // dialog at all, and for 17 templates a `;`/`,` list of candidate roots
    // (the dump's own conditional entry points). `num()` renders `NaN` on
    // those, so take the first id instead — the canonical fallback, and the
    // one branch that is always reachable.
    initialQuestion: firstId(row.initQuestion),
    // Patrol route, replayed only for placements flagged movable.
    path: String(row.path ?? ""),
    // The dump lists an NPC's stock inline in `ventes`; there is no store id
    // to point at. See the header.
    saleStoreId: 0,
  });
}

await upsert("npcTemplates", ["id"], npcTemplates);
const namedNpcs = npcTemplates.filter((n) => n.name !== "").length;
console.log(
  `upserted ${npcTemplates.length} NPC templates ` +
    `(${namedNpcs} named by the 1.29 bundle)`
);

// `scripted_npcs` has a surrogate primary key and no natural unique
// constraint, so an upsert has nothing to conflict on. The importer owns every
// placement of a template it knows about: clear those, then re-insert. Rows
// for templates the dump does not describe are left alone.
const knownMapIds = new Set<number>(
  (await db.selectFrom("maps").select("id").execute()).map(
    (r: { id: number }) => r.id
  )
);

const placements: Record<string, unknown>[] = [];
let placementsOffWorld = 0;

for (const values of insertRows(dump, "npcs")) {
  const row = toRecord(NPC_PLACEMENT_COLUMNS, values);
  const mapId = num(row.mapid, -1);
  const templateId = num(row.npcid, -1);
  if (!npcIds.has(templateId)) {
    continue;
  }

  // `scripted_npcs.map_id` is a foreign key, and the dump knows maps this
  // project skipped (unusable cell payload) or has not imported yet.
  if (!knownMapIds.has(mapId)) {
    placementsOffWorld++;
    continue;
  }

  placements.push({
    mapId,
    cellId: num(row.cellid),
    templateId,
    direction: num(row.orientation, 3),
    isMovable: num(row.isMovable) === 1,
  });
}

if (npcIds.size > 0) {
  await sql`
    DELETE FROM scripted_npcs
    WHERE template_id = ANY(${sql.val([...npcIds])}::int[])
  `.execute(db);
}

for (let i = 0; i < placements.length; i += BATCH) {
  await db
    .insertInto("scriptedNpcs")
    .values(placements.slice(i, i + BATCH))
    .execute();
}

console.log(
  `inserted ${placements.length} NPC placements ` +
    `(${placementsOffWorld} skipped: map not imported)`
);

// ── NPC dialog graph ────────────────────────────────────────────────────────

// Questions and the actions their answers fire. The displayed text is not in
// here — it is in the `dialog` lang bundle, keyed by these same ids
// (`D.q[questionId]`, `D.a[responseId]`), which is why `description` and `nom`
// are read and dropped: they are the dump's authoring notes, not what 1.29
// shows. See `dofus/datacenter/Question.as:24-40`.

const dialogQuestions: ImportedDialogQuestion[] = [];

for (const values of insertRows(dump, "npc_questions")) {
  const row = toRecord(NPC_QUESTION_COLUMNS, values);
  const id = num(row.ID, -1);
  if (id <= 0) {
    continue;
  }

  dialogQuestions.push({
    id,
    // The dump separates answer ids with `;` in every row that has more than
    // one, but a handful use `,`; splitting on both costs nothing and the
    // order is display order.
    responseIds: idList(row.responses),
    parameters: textList(row.params),
    cond: String(row.cond ?? ""),
    ifFalse: num(row.ifFalse),
  });
}

const dialogActions: ImportedDialogAction[] = [];
const seenActions = new Set<string>();

for (const values of insertRows(dump, "npc_reponses_actions")) {
  const row = toRecord(NPC_RESPONSE_ACTION_COLUMNS, values);
  const responseId = num(row.ID, -1);
  if (responseId <= 0) {
    continue;
  }

  const type = num(row.type, -1);
  // `(ID, type)` is the dump's own primary key, so a repeat would be a
  // corrupt dump rather than data — but the batched insert would fail the
  // whole run on it, so drop the duplicate and keep the first.
  const key = `${responseId}:${type}`;
  if (seenActions.has(key)) {
    continue;
  }
  seenActions.add(key);

  dialogActions.push({ responseId, type, args: String(row.args ?? "") });
}

function appendResponse(
  questions: ImportedDialogQuestion[],
  questionId: number,
  responseId: number
): void {
  const question = questions.find((entry) => entry.id === questionId);
  if (question && !question.responseIds.includes(responseId)) {
    question.responseIds.push(responseId);
  }
}

// StarLoco 1.39 orphaned two 1.29 learning actions. Incarnam's own NPCs are
// stable, reachable roots and the response labels already exist in the retail
// 1.29 bundle, so attach the two missing professions there rather than invent
// dialog text. Contremaitre Ikul teaches Alchimiste; Pecheur d'Incarnam,
// Pecheur. A missing success/failure branch means the dialog simply closes.
appendResponse(dialogQuestions, 3596, 10217);
dialogActions.push({ responseId: 10217, type: 6, args: "26" });
appendResponse(dialogQuestions, 3745, 10219);
dialogActions.push({ responseId: 10219, type: 6, args: "36" });

const filteredDialog = filterDialogGraph({
  questions: dialogQuestions,
  actions: dialogActions,
  questionTexts: langDialog.q,
  responseTexts: langDialog.a,
});

// Upsert alone would leave rows rejected by a later, stricter import in the
// database. These two tables are wholly importer-owned static content.
await db.deleteFrom("npcDialogResponseActions").execute();
await db.deleteFrom("npcDialogQuestions").execute();

await upsert(
  "npcDialogQuestions",
  ["id"],
  filteredDialog.questions.map((question) => ({
    ...question,
    responseIds: JSON.stringify(question.responseIds),
    parameters: JSON.stringify(question.parameters),
  }))
);
await upsert(
  "npcDialogResponseActions",
  ["responseId", "type"],
  filteredDialog.actions
);

const branching = filteredDialog.actions.filter(
  (a) => a.type === 1 && String(a.args).trim() !== "DV"
).length;

console.log(
  `upserted ${filteredDialog.questions.length} dialog questions and ` +
    `${filteredDialog.actions.length} answer actions ` +
    `(${branching} branch to another question, the rest end the dialog ` +
    `or fire an effect); rejected ${filteredDialog.rejectedQuestions} ` +
    `questions without 1.29 text, ${filteredDialog.rejectedResponses} ` +
    `unrenderable answers (${filteredDialog.rejectedDeadBranches} dead branches)`
);

// ── Auction houses ──────────────────────────────────────────────────────────

// An auction house is keyed by the **map** it occupies, not by the vendor NPC
// standing in it: that is how `hdvs` is keyed, and the 56 NPCs that advertise
// actions 5 and 6 in the `npc` lang bundle are only the way in. See QA-108.

/** Column order of StarLoco's `hdvs` table. */
const HDV_COLUMNS = [
  "id",
  "map",
  "categories",
  "sellTaxe",
  "lvlMax",
  "accountItem",
  "sellTime",
] as const;

const hdvs: Record<string, unknown>[] = [];
let hdvsOffWorld = 0;

for (const values of insertRows(dump, "hdvs")) {
  const row = toRecord(HDV_COLUMNS, values);
  const mapId = num(row.map, -1);

  // Same guard the NPC placements use: the dump knows maps this project
  // skipped or has not imported yet, and `hdv_templates.map_id` is what the
  // server resolves an open request against.
  if (!knownMapIds.has(mapId)) {
    hdvsOffWorld++;
    continue;
  }

  hdvs.push({
    id: num(row.id),
    mapId,
    // A comma-separated list of `item_types.id`. Kept as the dump's own
    // string: it is read once when a hall opens and parsed there, and
    // splitting it into a table would be a join for a dozen integers.
    categories: String(row.categories ?? ""),
    sellTax: Number(row.sellTaxe) || 0,
    levelMax: num(row.lvlMax, 2000),
    accountItems: num(row.accountItem, 20),
    // `sellTime` is 1500 on every row. As days that is four years; as hours
    // it is 62 days, which is the retail order of magnitude — migration 0056
    // renames the column to say so.
    sellTimeHours: num(row.sellTime, 1500),
  });
}

await upsert("hdvTemplates", ["id"], hdvs);
console.log(
  `upserted ${hdvs.length} auction houses ` +
    `(${hdvsOffWorld} skipped: map not imported)`
);

// ── Report ──────────────────────────────────────────────────────────────────

/**
 * The number that decides whether combat is testable: how much of what
 * `maps.monsters_raw` asks for actually resolves now.
 *
 * `MapMonsterService` needs the template to place a member at all — that is
 * the count that was zero and made every map log `spawned 0 monster groups`.
 * It needs the matching `monster_levels` row for the member's life / AP / MP /
 * spells; without one the member still spawns, on a 50 HP fallback with no
 * spells.
 */
const pools = await sql<{
  entries: number;
  withTemplate: number;
  withLevel: number;
  maps: number;
  spawnableMaps: number;
}>`
  WITH refs AS (
    SELECT
      m.id AS map_id,
      split_part(entry, ',', 1)::int AS monster_id,
      split_part(entry, ',', 2)::int AS level
    FROM maps m,
         LATERAL unnest(string_to_array(m.monsters_raw, '|')) AS entry
    WHERE m.monsters_raw <> '' AND entry ~ '^[0-9]+,[0-9]+$'
  )
  SELECT
    count(*)::int                            AS "entries",
    count(t.id)::int                         AS "withTemplate",
    count(l.monster_id)::int                 AS "withLevel",
    count(DISTINCT r.map_id)::int            AS "maps",
    count(DISTINCT CASE WHEN t.id IS NOT NULL THEN r.map_id END)::int
                                             AS "spawnableMaps"
  FROM refs r
  LEFT JOIN monster_templates t ON t.id = r.monster_id
  LEFT JOIN monster_levels l
    ON l.monster_id = r.monster_id AND l.level = r.level
`
  .execute(db)
  .then((r) => r.rows[0]);

const counts = await sql<Record<string, number>>`
  SELECT
    (SELECT count(*)::int FROM monster_templates) AS "monsterTemplates",
    (SELECT count(*)::int FROM monster_levels)    AS "monsterLevels",
    (SELECT count(*)::int FROM monster_drops)     AS "monsterDrops",
    (SELECT count(*)::int FROM item_templates)    AS "itemTemplates",
    (SELECT count(*)::int FROM item_sets)         AS "itemSets",
    (SELECT count(*)::int FROM npc_templates)     AS "npcTemplates",
    (SELECT count(*)::int FROM scripted_npcs)     AS "scriptedNpcs"
`
  .execute(db)
  .then((r) => r.rows[0]);

console.log(
  `done — ${Object.entries(counts ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" ")}`
);

if (pools) {
  console.log(
    `monster pools: ${pools.withTemplate}/${pools.entries} entries resolve to ` +
      `a template (${pools.withLevel} also to a level), across ` +
      `${pools.spawnableMaps} of ${pools.maps} maps that carry a pool`
  );
}

await db.destroy();
