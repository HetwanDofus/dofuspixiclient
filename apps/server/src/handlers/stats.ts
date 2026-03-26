import type { BoostStatPayload, CharacterStatsPayload } from "../protocol/types.ts";
import { db } from "../db/database.ts";
import { getCharacterById } from "../game/character.ts";
import { encodeServerMessage } from "../protocol/codec.ts";
import { ServerMessageType } from "../protocol/types.ts";
import type { ClientSession } from "../ws/client-session.ts";
import type { CharactersTable } from "../db/schema.ts";
import { createLogger } from "../utils/logger.ts";

const log = createLogger("Stats");

// Stat IDs
const STAT_VITALITY = 0;
const STAT_WISDOM = 1;
const STAT_STRENGTH = 2;
const STAT_CHANCE = 3;
const STAT_AGILITY = 4;
const STAT_INTELLIGENCE = 5;

// Boost cost tables per class.
// Each entry: [threshold, cost, increment]
// Meaning: below threshold, costs `cost` points per `increment` stat points.
// Dofus 1.29 classic costs — class ID is 1-indexed.
type BoostCostEntry = [number, number, number];

const BOOST_COSTS: Record<number, Record<number, BoostCostEntry[]>> = {
  // Feca (1)
  1: {
    [STAT_VITALITY]:     [[Infinity, 1, 1]],
    [STAT_WISDOM]:       [[Infinity, 3, 1]],
    [STAT_INTELLIGENCE]: [[100, 1, 1], [200, 2, 1], [300, 3, 1], [400, 4, 1], [Infinity, 5, 1]],
    [STAT_CHANCE]:       [[20, 1, 1], [40, 2, 1], [60, 3, 1], [80, 4, 1], [Infinity, 5, 1]],
    [STAT_STRENGTH]:     [[50, 2, 1], [150, 3, 1], [250, 4, 1], [Infinity, 5, 1]],
    [STAT_AGILITY]:      [[20, 2, 1], [40, 3, 1], [60, 4, 1], [Infinity, 5, 1]],
  },
  // Osamodas (2)
  2: {
    [STAT_VITALITY]:     [[Infinity, 1, 1]],
    [STAT_WISDOM]:       [[Infinity, 3, 1]],
    [STAT_INTELLIGENCE]: [[100, 1, 1], [200, 2, 1], [300, 3, 1], [400, 4, 1], [Infinity, 5, 1]],
    [STAT_CHANCE]:       [[100, 1, 1], [200, 2, 1], [300, 3, 1], [400, 4, 1], [Infinity, 5, 1]],
    [STAT_STRENGTH]:     [[50, 2, 1], [150, 3, 1], [250, 4, 1], [Infinity, 5, 1]],
    [STAT_AGILITY]:      [[50, 2, 1], [150, 3, 1], [250, 4, 1], [Infinity, 5, 1]],
  },
  // Enutrof (3)
  3: {
    [STAT_VITALITY]:     [[Infinity, 1, 1]],
    [STAT_WISDOM]:       [[Infinity, 3, 1]],
    [STAT_INTELLIGENCE]: [[20, 1, 1], [60, 2, 1], [100, 3, 1], [140, 4, 1], [Infinity, 5, 1]],
    [STAT_CHANCE]:       [[100, 1, 1], [150, 2, 1], [230, 3, 1], [330, 4, 1], [Infinity, 5, 1]],
    [STAT_STRENGTH]:     [[50, 1, 1], [150, 2, 1], [250, 3, 1], [350, 4, 1], [Infinity, 5, 1]],
    [STAT_AGILITY]:      [[20, 2, 1], [40, 3, 1], [60, 4, 1], [Infinity, 5, 1]],
  },
  // Sram (4)
  4: {
    [STAT_VITALITY]:     [[Infinity, 1, 1]],
    [STAT_WISDOM]:       [[Infinity, 3, 1]],
    [STAT_INTELLIGENCE]: [[50, 2, 1], [150, 3, 1], [250, 4, 1], [Infinity, 5, 1]],
    [STAT_CHANCE]:       [[20, 2, 1], [40, 3, 1], [60, 4, 1], [Infinity, 5, 1]],
    [STAT_STRENGTH]:     [[100, 1, 1], [200, 2, 1], [300, 3, 1], [400, 4, 1], [Infinity, 5, 1]],
    [STAT_AGILITY]:      [[100, 1, 1], [200, 2, 1], [300, 3, 1], [400, 4, 1], [Infinity, 5, 1]],
  },
  // Xelor (5)
  5: {
    [STAT_VITALITY]:     [[Infinity, 1, 1]],
    [STAT_WISDOM]:       [[Infinity, 3, 1]],
    [STAT_INTELLIGENCE]: [[100, 1, 1], [200, 2, 1], [300, 3, 1], [400, 4, 1], [Infinity, 5, 1]],
    [STAT_CHANCE]:       [[20, 2, 1], [40, 3, 1], [60, 4, 1], [Infinity, 5, 1]],
    [STAT_STRENGTH]:     [[50, 2, 1], [150, 3, 1], [250, 4, 1], [Infinity, 5, 1]],
    [STAT_AGILITY]:      [[20, 2, 1], [40, 3, 1], [60, 4, 1], [Infinity, 5, 1]],
  },
  // Ecaflip (6)
  6: {
    [STAT_VITALITY]:     [[Infinity, 1, 1]],
    [STAT_WISDOM]:       [[Infinity, 3, 1]],
    [STAT_INTELLIGENCE]: [[20, 2, 1], [40, 3, 1], [60, 4, 1], [Infinity, 5, 1]],
    [STAT_CHANCE]:       [[100, 1, 1], [200, 2, 1], [300, 3, 1], [400, 4, 1], [Infinity, 5, 1]],
    [STAT_STRENGTH]:     [[100, 1, 1], [200, 2, 1], [300, 3, 1], [400, 4, 1], [Infinity, 5, 1]],
    [STAT_AGILITY]:      [[20, 2, 1], [40, 3, 1], [60, 4, 1], [Infinity, 5, 1]],
  },
  // Eniripsa (7)
  7: {
    [STAT_VITALITY]:     [[Infinity, 1, 1]],
    [STAT_WISDOM]:       [[Infinity, 3, 1]],
    [STAT_INTELLIGENCE]: [[100, 1, 1], [200, 2, 1], [300, 3, 1], [400, 4, 1], [Infinity, 5, 1]],
    [STAT_CHANCE]:       [[20, 2, 1], [40, 3, 1], [60, 4, 1], [Infinity, 5, 1]],
    [STAT_STRENGTH]:     [[50, 2, 1], [150, 3, 1], [250, 4, 1], [Infinity, 5, 1]],
    [STAT_AGILITY]:      [[20, 2, 1], [40, 3, 1], [60, 4, 1], [Infinity, 5, 1]],
  },
  // Iop (8)
  8: {
    [STAT_VITALITY]:     [[Infinity, 1, 1]],
    [STAT_WISDOM]:       [[Infinity, 3, 1]],
    [STAT_INTELLIGENCE]: [[20, 2, 1], [40, 3, 1], [60, 4, 1], [Infinity, 5, 1]],
    [STAT_CHANCE]:       [[20, 2, 1], [40, 3, 1], [60, 4, 1], [Infinity, 5, 1]],
    [STAT_STRENGTH]:     [[100, 1, 1], [200, 2, 1], [300, 3, 1], [400, 4, 1], [Infinity, 5, 1]],
    [STAT_AGILITY]:      [[20, 2, 1], [40, 3, 1], [60, 4, 1], [Infinity, 5, 1]],
  },
  // Cra (9)
  9: {
    [STAT_VITALITY]:     [[Infinity, 1, 1]],
    [STAT_WISDOM]:       [[Infinity, 3, 1]],
    [STAT_INTELLIGENCE]: [[50, 2, 1], [150, 3, 1], [250, 4, 1], [Infinity, 5, 1]],
    [STAT_CHANCE]:       [[20, 2, 1], [40, 3, 1], [60, 4, 1], [Infinity, 5, 1]],
    [STAT_STRENGTH]:     [[50, 2, 1], [150, 3, 1], [250, 4, 1], [Infinity, 5, 1]],
    [STAT_AGILITY]:      [[100, 1, 1], [200, 2, 1], [300, 3, 1], [400, 4, 1], [Infinity, 5, 1]],
  },
  // Sadida (10)
  10: {
    [STAT_VITALITY]:     [[Infinity, 1, 1]],
    [STAT_WISDOM]:       [[Infinity, 3, 1]],
    [STAT_INTELLIGENCE]: [[100, 1, 1], [200, 2, 1], [300, 3, 1], [400, 4, 1], [Infinity, 5, 1]],
    [STAT_CHANCE]:       [[100, 1, 1], [200, 2, 1], [300, 3, 1], [400, 4, 1], [Infinity, 5, 1]],
    [STAT_STRENGTH]:     [[50, 2, 1], [150, 3, 1], [250, 4, 1], [Infinity, 5, 1]],
    [STAT_AGILITY]:      [[50, 2, 1], [150, 3, 1], [250, 4, 1], [Infinity, 5, 1]],
  },
  // Sacrieur (11)
  11: {
    [STAT_VITALITY]:     [[Infinity, 1, 1]],
    [STAT_WISDOM]:       [[Infinity, 3, 1]],
    [STAT_INTELLIGENCE]: [[100, 3, 1], [200, 4, 1], [Infinity, 5, 1]],
    [STAT_CHANCE]:       [[100, 3, 1], [200, 4, 1], [Infinity, 5, 1]],
    [STAT_STRENGTH]:     [[100, 3, 1], [200, 4, 1], [Infinity, 5, 1]],
    [STAT_AGILITY]:      [[100, 3, 1], [200, 4, 1], [Infinity, 5, 1]],
  },
  // Pandawa (12)
  12: {
    [STAT_VITALITY]:     [[Infinity, 1, 1]],
    [STAT_WISDOM]:       [[Infinity, 3, 1]],
    [STAT_INTELLIGENCE]: [[50, 1, 1], [200, 2, 1], [300, 3, 1], [400, 4, 1], [Infinity, 5, 1]],
    [STAT_CHANCE]:       [[50, 1, 1], [200, 2, 1], [300, 3, 1], [400, 4, 1], [Infinity, 5, 1]],
    [STAT_STRENGTH]:     [[50, 1, 1], [200, 2, 1], [300, 3, 1], [400, 4, 1], [Infinity, 5, 1]],
    [STAT_AGILITY]:      [[50, 1, 1], [200, 2, 1], [300, 3, 1], [400, 4, 1], [Infinity, 5, 1]],
  },
};

function getBoostCost(classId: number, statId: number, currentValue: number): number {
  const classCosts = BOOST_COSTS[classId];
  if (!classCosts) return 5; // Default high cost for unknown class

  const entries = classCosts[statId];
  if (!entries) return 5;

  for (const [threshold, cost] of entries) {
    if (currentValue < threshold) {
      return cost;
    }
  }
  return 5;
}

const STAT_COLUMNS = {
  [STAT_VITALITY]: "vitality",
  [STAT_WISDOM]: "wisdom",
  [STAT_STRENGTH]: "strength",
  [STAT_CHANCE]: "chance",
  [STAT_AGILITY]: "agility",
  [STAT_INTELLIGENCE]: "intelligence",
} as const;

export function buildCharacterStatsPayload(character: CharactersTable): CharacterStatsPayload {
  return {
    vitality: { base: character.vitality ?? 0, items: 0, boost: 0 },
    wisdom: { base: character.wisdom ?? 0, items: 0, boost: 0 },
    strength: { base: character.strength ?? 0, items: 0, boost: 0 },
    chance: { base: character.chance ?? 0, items: 0, boost: 0 },
    agility: { base: character.agility ?? 0, items: 0, boost: 0 },
    intelligence: { base: character.intelligence ?? 0, items: 0, boost: 0 },
    hp: character.hp ?? 55,
    maxHp: character.max_hp ?? 55,
    ap: character.ap ?? 6,
    mp: character.mp ?? 3,
    energy: character.energy ?? 10000,
    maxEnergy: character.max_energy ?? 10000,
    bonusPoints: character.bonus_points ?? 0,
    bonusPointsSpell: character.bonus_points_spell ?? 0,
    xp: Number(character.xp ?? 0),
    xpLow: Number(character.xp_low ?? 0),
    xpHigh: Number(character.xp_high ?? 110),
    level: character.level ?? 1,
    kama: character.kama ?? 0,
    initiative: character.initiative ?? 100,
    discernment: character.discernment ?? 0,
    range: character.range ?? 0,
    summonLimit: character.summon_limit ?? 1,
  };
}

export async function sendCharacterStats(session: ClientSession): Promise<void> {
  if (!session.characterId) return;

  const character = await getCharacterById(session.characterId);
  if (!character) return;

  const stats = buildCharacterStatsPayload(character);
  session.ws.send(encodeServerMessage(ServerMessageType.CHARACTER_STATS, stats));
}

export async function handleDebugGiveCapital(
  session: ClientSession,
  payload: { amount: number }
): Promise<void> {
  if (!session.characterId) return;

  const character = await getCharacterById(session.characterId);
  if (!character) return;

  const amount = Math.max(0, Math.min(payload.amount ?? 0, 1000));
  await db
    .updateTable("characters")
    .set({ bonus_points: character.bonus_points + amount })
    .where("id", "=", session.characterId)
    .execute();

  log.info(`DEBUG: gave ${amount} capital to character ${session.characterId}`);
  await sendCharacterStats(session);
}

export async function handleBoostStat(
  session: ClientSession,
  payload: BoostStatPayload
): Promise<void> {
  if (!session.characterId) return;

  const { statId } = payload;
  if (!(statId in STAT_COLUMNS)) return;

  const character = await getCharacterById(session.characterId);
  if (!character) return;

  if (character.bonus_points < 1) return;

  const column = STAT_COLUMNS[statId as keyof typeof STAT_COLUMNS];
  const currentValue = character[column] as number;
  const cost = getBoostCost(character.class, statId, currentValue);

  if (character.bonus_points < cost) return;

  // Update stat and deduct points
  const updates: Record<string, number> = {
    [column]: currentValue + 1,
    bonus_points: character.bonus_points - cost,
  };

  // Vitality also increases max HP
  if (statId === STAT_VITALITY) {
    updates.max_hp = character.max_hp + 1;
    updates.hp = character.hp + 1;
  }

  await db
    .updateTable("characters")
    .set(updates)
    .where("id", "=", session.characterId)
    .execute();

  // Send updated stats
  await sendCharacterStats(session);
}
