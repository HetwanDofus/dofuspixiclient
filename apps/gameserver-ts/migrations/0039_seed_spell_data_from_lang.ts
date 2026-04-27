import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decodeZones } from "@dofus/grid";
import { type Kysely, sql } from "kysely";

import { defaultTargetMaskForEffect } from "../src/core/modules/fight/effects/fight.target-defaults.ts";
import { parseTargetParam } from "../src/core/modules/fight/effects/fight.target-mask.ts";

/**
 * Seeds spell_templates + spell_levels from the canonical lang JSON
 * (assets/dist/langs/fr/spells.json), the same file the lang-pipeline
 * extracts from spells_fr_1254.swf. The previous combat-exporter dump
 * (tools/combat-exporter/output/spells.json) preserved the raw `zones`
 * string as-is and dropped target masks entirely, leaving every effect
 * with areaKind=None / size=0 — so AOEs collapsed to a single cell and
 * no target filtering ever ran.
 *
 * lN array layout (positional, 21 slots):
 *   [0]  animationId      [11] freeCell (bool)
 *   [1]  critFailureEnds  [12] lineOfSight (bool)
 *   [2]  minPlayerLevel   [13] lineOnly (bool)
 *   [3]  forbiddenStates  [14] criticalFailure
 *   [4]  requiredStates   [15] criticalChance
 *   [5]  zones (string)   [16] maxRange
 *   [6]  cooldown         [17] minRange
 *   [7]  maxPerTarget     [18] apCost
 *   [8]  maxPerTurn       [19] criticalEffects
 *   [9]  classId          [20] effects (normal)
 *   [10] modifiableRange (bool)
 *
 * Per-effect array (9-element form):
 *   [diceFormula, showInTooltip, param, duration, probability, special, max, min, effectId]
 * (8-element form omits the leading dice string)
 */
type LangEffect = unknown[];
type LangLevel = unknown[];
interface LangSpell {
  n?: string;
  [key: string]: unknown;
}

interface NormalizedEffect {
  id: number;
  min: number;
  max: number;
  special: number;
  duration: number;
  probability: number;
  areaKind: number;
  areaSize: number;
  targetMask: number;
  param: string;
}

const LANG_RELATIVE = "../../../assets/dist/langs/fr/spells.json";

function langPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, LANG_RELATIVE);
}

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return fallback;
}

function asBool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * Effects come in two shapes:
 *   9-elem: [dice, showInTooltip, param, duration, prob, special, max, min, effectId]
 *   8-elem: [showInTooltip, param, duration, prob, special, max, min, effectId]
 * Detect via typeof e[0]; the 9-elem variant always starts with a dice formula.
 */
function normalizeEffect(
  raw: LangEffect,
  zone: { kind: number; size: number }
): NormalizedEffect | null {
  if (!Array.isArray(raw)) return null;
  const hasFormula = typeof raw[0] === "string";
  const offset = hasFormula ? 1 : 0;
  const len = raw.length;
  if (len < offset + 8) return null;

  const param = asString(raw[offset + 1]);
  // Canonical 1.29 effect field order is
  //   [..., param, random, delay, special, max, min, effectId]
  // i.e. the random-gate (0-100 %) comes BEFORE the per-effect delay
  // (turns). Earlier revisions of this migration had these two swapped,
  // which made every glyph/buff effect look like a 2-4 % chance to
  // fire and every "delay" buff have a 0-turn duration. Read them in
  // canonical order so spell_levels.effects ships the right semantics.
  const probability = asNumber(raw[offset + 2]);
  const duration = asNumber(raw[offset + 3]);
  const special = asNumber(raw[offset + 4]);
  const maxRaw = raw[offset + 5];
  const minRaw = raw[offset + 6];
  const effectId = asNumber(raw[offset + 7]);

  const min = asNumber(minRaw, 0);
  // when max is null, it's a "fixed value" effect — collapse max to min
  const max = maxRaw === null || maxRaw === undefined ? min : asNumber(maxRaw, min);

  const targetMask =
    parseTargetParam(param) ?? defaultTargetMaskForEffect(effectId);

  return {
    id: effectId,
    min,
    max,
    special,
    duration,
    probability,
    areaKind: zone.kind,
    areaSize: zone.size,
    targetMask,
    param,
  };
}

function normalizeEffectList(
  raw: unknown,
  zonesString: string
): NormalizedEffect[] {
  if (!Array.isArray(raw)) return [];
  const zones = decodeZones(zonesString, raw.length);
  const out: NormalizedEffect[] = [];
  for (let i = 0; i < raw.length; i++) {
    const zone = zones[i] ?? { kind: 0, size: 0 };
    const norm = normalizeEffect(raw[i] as LangEffect, zone);
    if (norm) out.push(norm);
  }
  return out;
}

interface LevelRow {
  spellId: number;
  level: number;
  apCost: number;
  rangeMin: number;
  rangeMax: number;
  criticalRate: number;
  failureRate: number;
  lineOfSight: boolean;
  emptyCell: boolean;
  modifiableRange: boolean;
  castPerTurn: number;
  castPerTarget: number;
  cooldown: number;
  lineOnly: boolean;
  effects: NormalizedEffect[];
  criticalEffects: NormalizedEffect[];
}

function buildLevel(
  spellId: number,
  level: number,
  l: LangLevel
): LevelRow | null {
  if (!Array.isArray(l) || l.length < 21) return null;
  const zonesString = asString(l[5]);
  const cooldown = asNumber(l[6]);
  const maxPerTarget = asNumber(l[7]);
  const maxPerTurn = asNumber(l[8]);
  const modifiableRange = asBool(l[10]);
  const freeCell = asBool(l[11]);
  const lineOfSight = asBool(l[12]);
  const lineOnly = asBool(l[13]);
  const failureRate = asNumber(l[14]);
  const criticalRate = asNumber(l[15]);
  const maxRange = asNumber(l[16]);
  const minRange = asNumber(l[17]);
  const apCost = asNumber(l[18]);
  // Lang has critical at [19], normal at [20] — opposite of how some
  // emulator dumps label them. Verified by cross-referencing dice
  // formulas with known Dofus values (Coup de Poing crit = 1d5+4).
  const criticalEffects = normalizeEffectList(l[19], zonesString);
  const effects = normalizeEffectList(l[20], zonesString);

  return {
    spellId,
    level,
    apCost,
    rangeMin: minRange,
    rangeMax: maxRange,
    criticalRate,
    failureRate,
    lineOfSight,
    emptyCell: freeCell,
    modifiableRange,
    castPerTurn: maxPerTurn,
    castPerTarget: maxPerTarget,
    cooldown,
    lineOnly,
    effects,
    criticalEffects,
  };
}

export async function up(db: Kysely<never>): Promise<void> {
  const raw = await readFile(langPath(), "utf8");
  const parsed = JSON.parse(raw) as { data?: { S?: Record<string, LangSpell> } };
  const spells = parsed.data?.S ?? {};

  const templateRows: { id: number; name: string; sprite: number }[] = [];
  const levelRows: LevelRow[] = [];
  let skipped = 0;

  for (const [idStr, spell] of Object.entries(spells)) {
    const id = Number.parseInt(idStr, 10);
    if (!Number.isFinite(id)) continue;
    const name = asString(spell.n, `Spell ${id}`);
    templateRows.push({ id, name, sprite: 0 });

    let levelIdx = 1;
    while (true) {
      const key = `l${levelIdx}`;
      if (!(key in spell)) break;
      const level = buildLevel(id, levelIdx, spell[key] as LangLevel);
      if (level) {
        levelRows.push(level);
      } else {
        skipped++;
      }
      levelIdx++;
      if (levelIdx > 6) break;
    }
  }

  if (skipped > 0) {
    console.warn(
      `[0039] skipped ${skipped} malformed level rows (level array <21 slots)`
    );
  }

  // Templates: idempotent upsert.
  if (templateRows.length > 0) {
    const chunkSize = 500;
    for (let i = 0; i < templateRows.length; i += chunkSize) {
      const chunk = templateRows.slice(i, i + chunkSize);
      await db
        .insertInto("spell_templates" as never)
        .values(chunk as never)
        .onConflict((oc) =>
          oc.column("id").doUpdateSet({
            name: sql.ref("excluded.name"),
            sprite: sql.ref("excluded.sprite"),
          } as never)
        )
        .execute();
    }
  }

  // Levels: idempotent upsert keyed on (spell_id, level).
  if (levelRows.length > 0) {
    const chunkSize = 500;
    for (let i = 0; i < levelRows.length; i += chunkSize) {
      const chunk = levelRows.slice(i, i + chunkSize).map((row) => ({
        spell_id: row.spellId,
        level: row.level,
        ap_cost: row.apCost,
        range_min: row.rangeMin,
        range_max: row.rangeMax,
        critical_rate: row.criticalRate,
        failure_rate: row.failureRate,
        line_of_sight: row.lineOfSight,
        empty_cell: row.emptyCell,
        modifiable_range: row.modifiableRange,
        cast_per_turn: row.castPerTurn,
        cast_per_target: row.castPerTarget,
        cooldown: row.cooldown,
        line_only: row.lineOnly,
        effects: JSON.stringify(row.effects),
        critical_effects: JSON.stringify(row.criticalEffects),
      }));
      await db
        .insertInto("spell_levels" as never)
        .values(chunk as never)
        .onConflict((oc) =>
          oc.columns(["spell_id", "level"]).doUpdateSet({
            ap_cost: sql.ref("excluded.ap_cost"),
            range_min: sql.ref("excluded.range_min"),
            range_max: sql.ref("excluded.range_max"),
            critical_rate: sql.ref("excluded.critical_rate"),
            failure_rate: sql.ref("excluded.failure_rate"),
            line_of_sight: sql.ref("excluded.line_of_sight"),
            empty_cell: sql.ref("excluded.empty_cell"),
            modifiable_range: sql.ref("excluded.modifiable_range"),
            cast_per_turn: sql.ref("excluded.cast_per_turn"),
            cast_per_target: sql.ref("excluded.cast_per_target"),
            cooldown: sql.ref("excluded.cooldown"),
            line_only: sql.ref("excluded.line_only"),
            effects: sql.ref("excluded.effects"),
            critical_effects: sql.ref("excluded.critical_effects"),
          } as never)
        )
        .execute();
    }
  }

  console.log(
    `[0039] seeded ${templateRows.length} spells / ${levelRows.length} levels from lang JSON`
  );
}

export async function down(_db: Kysely<never>): Promise<void> {
  // Data-only seed; rollback is a no-op (the schema migrations own the tables).
}
