import { create } from "@bufbuild/protobuf";
import { AccountStatsSchema } from "@dofus/proto/account_pb";
import { InfoLifeRestoreTimerSchema } from "@dofus/proto/chat_pb";
import { AlignmentInfoSchema, StatEntrySchema } from "@dofus/proto/common_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { InventoryFramesService } from "@modules/inventory/inventory.frames.service";
import { InventoryRepository } from "@modules/inventory/inventory.repository";
import { parseItemEffects } from "@modules/inventory/item-effects";
import { ItemTemplateCacheService } from "@modules/inventory/item-template.cache";
import { currentPods, maxPods } from "@modules/inventory/pods";
import { REGEN_MS_PER_LIFE_STANDING } from "@modules/life-regen/life-regen";
import { LifeRegenService } from "@modules/life-regen/life-regen.service";
import { PlayersRepository } from "@modules/players/players.repository";
import {
  BASE_AP,
  BASE_MAX_SUMMONS,
  BASE_MP,
  ENERGY_MAX,
  maxLifePoints,
  prospection,
} from "@modules/stats/stats.constants";
import { Injectable } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

export interface ComputedStats {
  strength: number;
  vitality: number;
  wisdom: number;
  chance: number;
  agility: number;
  intelligence: number;
  ap: number;
  mp: number;
  range: number;
  summons: number;
  damageBonus: number;
  damagePct: number;
  healBonus: number;
  criticalHit: number;
  criticalFail: number;
  dodgeAp: number;
  dodgeMp: number;
  resistNeutral: number;
  resistNeutralPct: number;
  resistEarth: number;
  resistEarthPct: number;
  resistWater: number;
  resistWaterPct: number;
  resistAir: number;
  resistAirPct: number;
  resistFire: number;
  resistFirePct: number;
  /** Bonus carrying capacity from equipment (effect 158, minus 159). */
  pods: number;
}

function emptyComputedStats(): ComputedStats {
  return {
    strength: 0,
    vitality: 0,
    wisdom: 0,
    chance: 0,
    agility: 0,
    intelligence: 0,
    ap: 0,
    mp: 0,
    range: 0,
    summons: 0,
    damageBonus: 0,
    damagePct: 0,
    healBonus: 0,
    criticalHit: 0,
    criticalFail: 0,
    dodgeAp: 0,
    dodgeMp: 0,
    resistNeutral: 0,
    resistNeutralPct: 0,
    resistEarth: 0,
    resistEarthPct: 0,
    resistWater: 0,
    resistWaterPct: 0,
    resistAir: 0,
    resistAirPct: 0,
    resistFire: 0,
    resistFirePct: 0,
    pods: 0,
  };
}

function applyItemEffect(
  stats: ComputedStats,
  effectId: number,
  value: number
): void {
  const mapping: Record<number, keyof ComputedStats> = {
    118: "strength",
    126: "intelligence",
    119: "agility",
    123: "chance",
    124: "wisdom",
    125: "vitality",
    111: "ap",
    128: "mp",
    117: "range",
    182: "summons",
    112: "damageBonus",
    138: "damagePct",
    178: "healBonus",
    115: "criticalHit",
    122: "criticalFail",
    174: "dodgeAp",
    175: "dodgeMp",
    240: "resistNeutral",
    241: "resistNeutralPct",
    242: "resistEarth",
    243: "resistEarthPct",
    244: "resistWater",
    245: "resistWaterPct",
    246: "resistAir",
    247: "resistAirPct",
    248: "resistFire",
    249: "resistFirePct",
    158: "pods",
  };
  const field = mapping[effectId];
  if (field) {
    stats[field] += value;
    return;
  }
  // 159 ("Réduit le poids portable de …") is the one subtractive effect
  // this service handles — everything else here is additive-only, which
  // is a known gap for the SUB_* effect family in general.
  if (effectId === 159) {
    stats.pods -= value;
  }
}

@Injectable()
export class StatsService {
  constructor(
    private readonly templateCache: ItemTemplateCacheService,
    private readonly inventory: InventoryRepository,
    private readonly players: PlayersRepository,
    private readonly frames: GatewayFrameService,
    private readonly lifeRegen: LifeRegenService,
    private readonly inventoryFrames: InventoryFramesService
  ) {}

  async computeEquipmentStats(playerId: string): Promise<ComputedStats> {
    const equipped = await this.inventory.findEquipped(playerId);
    const stats = emptyComputedStats();

    for (const item of equipped) {
      // Prefer the instance's own rolled effects. Items created since
      // QA-060 roll their jets once at creation (`rollItemEffects`) and
      // store the result on the row; the template is only a recipe, and
      // reading it back gives every player the same minimum roll. Items
      // seeded by hand straight into SQL have an empty `effects` array —
      // fall back to the template for those so nothing regresses.
      const rolled = parseItemEffects(item.effects);

      let effects = rolled;

      if (effects.length === 0) {
        const template = await this.templateCache.load(item.templateId);

        if (!template) {
          continue;
        }

        // The world import writes 1.29's own effect shape,
        // `{id, param1, param2, param3}`, where param1 is the minimum
        // roll — never `min` or `value`. Reading only the latter two
        // meant every equipment bonus resolved to 0 and was dropped,
        // so no worn item moved a single stat.
        effects = parseItemEffects(template.effects);
      }

      for (const effect of effects) {
        if (effect.param1 !== 0) {
          applyItemEffect(stats, effect.id, effect.param1);
        }
      }
    }

    return stats;
  }

  async sendStats(sessionId: string, characterId: string): Promise<void> {
    const player = await this.players.findById(characterId);
    if (!player) {
      return;
    }

    const baseStats = await this.players.findStats(characterId);
    const equipStats = await this.computeEquipmentStats(characterId);

    const baseStr = baseStats?.strength ?? 0;
    const baseVit = baseStats?.vitality ?? 0;
    const baseWis = baseStats?.wisdom ?? 0;
    const baseCha = baseStats?.chance ?? 0;
    const baseAgi = baseStats?.agility ?? 0;
    const baseInt = baseStats?.intelligence ?? 0;

    const totalVit = baseVit + equipStats.vitality;
    const maxHp = maxLifePoints(player.level, totalVit);

    // Every call site of `sendStats` is also a moment the carrying
    // capacity could have changed (new gear, a new stat point, a level
    // up), so — same reasoning as life regen above — this is resolved
    // here once rather than at each of the five call sites.
    await this.sendWeight(
      sessionId,
      characterId,
      baseStr + equipStats.strength,
      equipStats.pods
    );

    // Resolve regeneration here rather than at each of the five call
    // sites: this is the only frame that ever carries life to a client,
    // so every one of them — character select, entering the game,
    // moving an item, spending a stat point, upgrading a spell —
    // gets an up-to-date value for free.
    const life = await this.lifeRegen.resolve(player, maxHp);

    const xpForLevel = player.level * player.level * 10;
    const xpForNext = (player.level + 1) * (player.level + 1) * 10;

    const makeStat = (base: number, itemBonus: number, debuff = 0, boost = 0) =>
      create(StatEntrySchema, {
        base,
        items: itemBonus,
        debuffs: debuff,
        boosts: boost,
      });

    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "accountStats",
          value: create(AccountStatsSchema, {
            xp: BigInt(player.experience),
            xpLow: BigInt(xpForLevel),
            xpHigh: BigInt(xpForNext),
            kama: BigInt(player.kamas),
            bonusPoints: player.statsPoints,
            bonusPointsSpell: player.spellPoints,
            lp: life,
            lpMax: maxHp,
            energy: player.energy,
            energyMax: ENERGY_MAX,
            initiative:
              baseStr +
              baseInt +
              baseCha +
              baseAgi +
              equipStats.strength +
              equipStats.intelligence +
              equipStats.chance +
              equipStats.agility +
              player.level,
            discernment: prospection(baseCha, equipStats.chance),
            ap: makeStat(BASE_AP, equipStats.ap),
            mp: makeStat(BASE_MP, equipStats.mp),
            strength: makeStat(baseStr, equipStats.strength),
            vitality: makeStat(baseVit, equipStats.vitality),
            wisdom: makeStat(baseWis, equipStats.wisdom),
            chance: makeStat(baseCha, equipStats.chance),
            agility: makeStat(baseAgi, equipStats.agility),
            intelligence: makeStat(baseInt, equipStats.intelligence),
            range: makeStat(0, equipStats.range),
            maxSummons: makeStat(BASE_MAX_SUMMONS, equipStats.summons),
            damagePhysical: makeStat(0, equipStats.damageBonus),
            damagePercent: makeStat(0, equipStats.damagePct),
            heals: makeStat(0, equipStats.healBonus),
            criticalHit: makeStat(0, equipStats.criticalHit),
            dodgeAp: makeStat(0, equipStats.dodgeAp),
            dodgeMp: makeStat(0, equipStats.dodgeMp),
            alignment: create(AlignmentInfoSchema, {
              alignment: player.alignment,
              grade: player.alignmentGrade,
              rankValue: player.alignmentValue,
              enabled: player.pvpEnabled,
            }),
            // The characteristics window reads its "Niveau" from here.
            // Leaving it at 0 made the client fall back to 1 and clobber
            // the level it had already learned from AccountCharacterSelected.
            showedLevel: player.level,
            // No achievement system yet — see the field's comment in
            // account.proto.
            successPoints: 0,
          }),
        },
      })
    );

    this.sendLifeRestoreTimer(sessionId, life, maxHp);
  }

  /**
   * `IL` — hand the client the regeneration clock so the heart fills in
   * real time.
   *
   * Life is resolved from a timestamp and only ever recomputed when
   * something asks for stats (QA-063), so without this frame a player
   * standing still watches a frozen number and concludes nothing
   * regenerates. This is the canonical 1.29 answer: the server states
   * the rate once, the client counts the points locally, and the next
   * `As` frame re-synchronises whatever drifted.
   *
   * `ILF` (started = false) is just as important as `ILS`: it is what
   * stops a client that has reached its cap — or been healed to it —
   * from carrying on past it.
   */
  private sendLifeRestoreTimer(
    sessionId: string,
    life: number,
    maxLife: number
  ): void {
    const restoring = life < maxLife;

    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "infoLifeRestoreTimer",
          value: create(InfoLifeRestoreTimerSchema, {
            started: restoring,
            rate: restoring ? REGEN_MS_PER_LIFE_STANDING : 0,
            delta: 0,
          }),
        },
      })
    );
  }

  /**
   * Resolves and broadcasts the `ItemWeight` (`Ow`) frame.
   *
   * Weight sums the *whole* inventory — bag and equipped alike, per 1.29 —
   * so this reads every row via `InventoryRepository.findByPlayer` rather
   * than reusing `computeEquipmentStats`'s equipped-only fetch.
   */
  private async sendWeight(
    sessionId: string,
    characterId: string,
    totalStrength: number,
    podsBonus: number
  ): Promise<void> {
    const items = await this.inventory.findByPlayer(characterId);
    const templateIds = [...new Set(items.map((item) => item.templateId))];
    const templates = await Promise.all(
      templateIds.map((id) => this.templateCache.load(id))
    );

    const weightByTemplate = new Map<number, number>();
    templateIds.forEach((id, i) => {
      const template = templates[i];
      if (template) {
        weightByTemplate.set(id, template.weight);
      }
    });

    this.inventoryFrames.sendWeight(
      sessionId,
      currentPods(items, weightByTemplate),
      maxPods(totalStrength, podsBonus)
    );
  }
}
