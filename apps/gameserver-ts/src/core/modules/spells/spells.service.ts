import type { SpellData } from "@dofus/proto/common_pb";
import type { SpellDetails, SpellEffectData } from "@dofus/proto/spells_pb";
import type { SpellPort } from "@modules/fight/cast/fight.cast.types";
import type {
  SpellEffect,
  SpellLevel,
} from "@modules/fight/cast/fight.spell.types";
import type { AreaKind } from "@modules/fight/fight.types";
import { create } from "@bufbuild/protobuf";
import { SpellDataSchema } from "@dofus/proto/common_pb";
import {
  SpellDetailsSchema,
  SpellEffectDataSchema,
  SpellLevelDetailSchema,
} from "@dofus/proto/spells_pb";
import { LangsService } from "@modules/langs/langs.service";
import { SpellsRepository } from "@modules/spells/spells.repository";
import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class SpellsService implements SpellPort {
  private readonly logger = new Logger(SpellsService.name);

  constructor(
    private readonly repo: SpellsRepository,
    private readonly langs: LangsService
  ) {}

  async spellLevel(
    spellId: number,
    level: number
  ): Promise<SpellLevel | undefined> {
    const row = await this.repo.findLevel(spellId, level);
    if (!row) {
      return undefined;
    }
    return {
      ...row,
      effects: parseEffects(row.effects),
      criticalEffects: parseEffects(row.criticalEffects),
      // Coalesce NULL → spellId so downstream code (cast handler,
      // FrameEmitter, client) never has to branch. Pre-StarLoco-import
      // every spell uses spellId as its gfx; once the canonical sorts
      // dump is imported the column carries the real value.
      visualGfxId: row.visualGfxId ?? row.spellId,
    };
  }

  async playerHasSpell(playerId: string, spellId: number): Promise<boolean> {
    return this.repo.playerHasSpell(playerId, spellId);
  }

  /**
   * Build the full SpellList payload for a player — one SpellData per
   * known spell, hydrated with the level row so the client has
   * everything needed to render + gate the spell-cast UI locally
   * (AP/MP costs, range, LoS, cast limits, AoE shape of primary effect).
   *
   * One JOIN query instead of 1 + N. A level-200 spellbook has ~25 spells,
   * so the old N+1 added ~25 round-trips to enter-game and showed up as a
   * multi-second stall before the character appeared on the map.
   */
  async buildSpellList(playerId: string): Promise<SpellData[]> {
    const t0 = performance.now();
    const rows = await this.repo.findPlayerSpellsWithLevels(playerId);
    const tQuery = performance.now();
    // Synchronous lookup against the pre-warmed normalized spells bundle.
    // The old `Promise.all(rows.map(getSpell))` path suffered a stampede —
    // 2036 concurrent async calls all stampeded the normalize step before
    // the cache latched, re-allocating a 2091-entry Map each time for a
    // total of ~23 s. Now it's one Map.get per row, ~O(1) each.
    const tLang = performance.now();
    const out = rows.map((row) => {
      const effects = parseEffects(row.effects);
      const primary = effects[0];
      const lang = this.langs.getSpellSync(row.spellId);
      return create(SpellDataSchema, {
        spellId: row.spellId,
        level: row.level,
        position: row.position,
        apCost: row.apCost,
        rangeMin: row.rangeMin,
        rangeMax: row.rangeMax,
        lineOfSight: row.lineOfSight,
        modifiableRange: row.modifiableRange,
        emptyCell: row.emptyCell,
        lineOnly: row.lineOnly,
        castPerTurn: row.castPerTurn,
        castPerTarget: row.castPerTarget,
        cooldown: row.cooldown,
        criticalRate: row.criticalRate,
        failureRate: row.failureRate,
        // Primary-effect shape. When there is no effect (rare), the
        // proto default (AREA_KIND_NONE = 0, size 0) is correct.
        areaKind: (primary?.areaKind ?? 0) as AreaKind,
        areaSize: primary?.areaSize ?? 0,
        targetMask: primary?.targetMask ?? 0,
        // Glyph (401) / Trap (400) / Summon (185) primary effects
        // describe their spawned entity's trigger zone, NOT a
        // cast-time AOE — the client uses this flag to render only
        // the placement cell on hover instead of expanding the area.
        singleTargetSpawn:
          primary !== undefined &&
          (primary.id === 400 || primary.id === 401 || primary.id === 185),
        name: lang?.name ?? row.templateName,
        description: lang?.description ?? "",
        // The hotbar icon is now a per-spell_id dofasset composed at build
        // time (`/assets/dofassets/spells/icons/<spellId>.dofasset`) with
        // the 3-layer tinted icon already baked in. Nothing icon-related
        // needs to travel on the wire anymore.
      });
    });
    const tEnd = performance.now();
    this.logger.log(
      `buildSpellList player=${playerId} spells=${rows.length} ` +
        `query=${(tQuery - t0).toFixed(0)}ms lang=${(tLang - tQuery).toFixed(0)}ms ` +
        `build=${(tEnd - tLang).toFixed(0)}ms total=${(tEnd - t0).toFixed(0)}ms`
    );
    return out;
  }

  /**
   * Every level of one spell, for the spell book's detail panel.
   *
   * The panel lets the player page through levels 1..6 including ones
   * they have not bought, so this ignores `player_spells.level` for the
   * payload and reports it separately as `playerLevel` — the panel uses
   * it to mark the owned level and to price the next one.
   *
   * Sent on demand (one spell at a time) rather than folded into
   * SpellList: six levels of effects per spell is roughly fifty times
   * the SpellList payload for data the HUD shows one spell at a time.
   */
  async buildSpellDetails(
    playerId: string,
    spellId: number
  ): Promise<SpellDetails | undefined> {
    const rows = await this.repo.findAllLevels(spellId);
    if (rows.length === 0) {
      return undefined;
    }
    const owned = await this.repo.findPlayerSpell(playerId, spellId);
    const lang = this.langs.getSpellSync(spellId);
    const template = lang ? undefined : await this.repo.findTemplate(spellId);

    return create(SpellDetailsSchema, {
      spellId,
      name: lang?.name ?? template?.name ?? `Spell ${spellId}`,
      description: lang?.description ?? "",
      playerLevel: owned?.level ?? 0,
      levels: rows.map((row) =>
        create(SpellLevelDetailSchema, {
          level: row.level,
          apCost: row.apCost,
          rangeMin: row.rangeMin,
          rangeMax: row.rangeMax,
          criticalRate: row.criticalRate,
          failureRate: row.failureRate,
          lineOfSight: row.lineOfSight,
          emptyCell: row.emptyCell,
          modifiableRange: row.modifiableRange,
          lineOnly: row.lineOnly,
          castPerTurn: row.castPerTurn,
          castPerTarget: row.castPerTarget,
          cooldown: row.cooldown,
          minPlayerLevel: row.minPlayerLevel,
          critFailureEndsTurn: row.critFailureEndsTurn,
          effects: toEffectData(parseEffects(row.effects)),
          criticalEffects: toEffectData(parseEffects(row.criticalEffects)),
        })
      ),
    });
  }
}

function toEffectData(effects: readonly SpellEffect[]): SpellEffectData[] {
  return effects.map((e) =>
    create(SpellEffectDataSchema, {
      effectId: e.id,
      min: e.min,
      max: e.max,
      special: e.special,
      duration: e.duration,
      probability: e.probability,
      areaKind: e.areaKind,
      areaSize: e.areaSize,
      param: e.param ?? "",
    })
  );
}

function parseEffects(raw: unknown): SpellEffect[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  // Migration 0039's `normalizeEffect` swapped `duration` and
  // `probability` when seeding from the canonical lang JSON: position
  // [offset+2] in the Ankama format is the random-gate percentage and
  // position [offset+3] is the per-effect duration in turns, but the
  // parser stored them in the opposite columns. The data evidence is
  // unambiguous — random `duration` values like 25/50/75/100 only make
  // sense as percentages, and `probability` values like 2/3/4 only
  // make sense as turn counts (4-turn buffs, 2-turn glyphs, etc.).
  // Swap on read so handlers see the field names with their canonical
  // 1.29 semantics (effect.duration = turns, effect.probability =
  // random gate 0-100). Re-running the migration will eventually do
  // this at the source.
  return raw.map((e) => ({
    param: typeof e?.param === "string" ? e.param : "",
    id: Number(e?.id ?? 0),
    min: Number(e?.min ?? 0),
    max: Number(e?.max ?? 0),
    special: Number(e?.special ?? 0),
    duration: Number(e?.probability ?? 0),
    probability: Number(e?.duration ?? 0),
    areaKind: Number(e?.areaKind ?? 0) as AreaKind,
    areaSize: Number(e?.areaSize ?? 0),
    targetMask: Number(e?.targetMask ?? 0),
  }));
}
