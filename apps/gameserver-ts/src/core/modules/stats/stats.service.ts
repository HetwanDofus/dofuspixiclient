import { create } from "@bufbuild/protobuf";
import { AccountStatsSchema } from "@dofus/proto/account_pb";
import { AlignmentInfoSchema, StatEntrySchema } from "@dofus/proto/common_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { InventoryRepository } from "@modules/inventory/inventory.repository";
import { ItemTemplateCacheService } from "@modules/inventory/item-template.cache";
import { PlayersRepository } from "@modules/players/players.repository";
import {
  BASE_AP,
  BASE_DISCERNMENT,
  BASE_MAX_SUMMONS,
  BASE_MP,
  ENERGY_MAX,
  maxLifePoints,
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
  };
  const field = mapping[effectId];
  if (field) {
    stats[field] += value;
  }
}

@Injectable()
export class StatsService {
  constructor(
    private readonly templateCache: ItemTemplateCacheService,
    private readonly inventory: InventoryRepository,
    private readonly players: PlayersRepository,
    private readonly frames: GatewayFrameService
  ) {}

  async computeEquipmentStats(playerId: string): Promise<ComputedStats> {
    const equipped = await this.inventory.findEquipped(playerId);
    const stats = emptyComputedStats();

    for (const item of equipped) {
      const template = await this.templateCache.load(item.templateId);
      if (!template) {
        continue;
      }

      const effects = Array.isArray(template.effects) ? template.effects : [];
      for (const effect of effects) {
        if (typeof effect !== "object" || effect === null) {
          continue;
        }
        const e = effect as Record<string, unknown>;
        const id = Number(e.id ?? e.effectId ?? 0);
        // The world import writes 1.29's own effect shape,
        // `{id, param1, param2, param3}`, where param1 is the minimum
        // roll — never `min` or `value`. Reading only the latter two
        // meant every equipment bonus resolved to 0 and was dropped,
        // so no worn item moved a single stat.
        const value = Number(e.min ?? e.value ?? e.param1 ?? 0);
        if (id > 0 && value !== 0) {
          applyItemEffect(stats, id, value);
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
            lp: Math.min(player.life, maxHp),
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
            discernment:
              BASE_DISCERNMENT + Math.floor((baseCha + equipStats.chance) / 10),
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
  }
}
