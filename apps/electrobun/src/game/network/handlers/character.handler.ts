import type { MessageHandler } from "@/game/network/message-handler";
import type {
  AccountCharacterSelected,
  AccountStats,
} from "@/game/network/protocol";
import type { CharacterStats } from "@/game/types/stats";
import { loginActor } from "@/game/machines/actors";
import { characterStore } from "@/game/stores";
import { createLogger } from "@/utils/logger";

const log = createLogger("CharacterHandler");

/**
 * Identity of the currently-selected character. Populated when the server
 * confirms `AccountCharacterSelected` (AS), used downstream by map/fight
 * handlers to match their own sprite among the broadcast SpriteMovementEntry
 * entries (sprite_id is the stringified character id).
 */
export interface CharacterInfo {
  id: number;
  spriteId: string;
  name: string;
  level: number;
  sex: number;
  gfxId: number;
  color1: number;
  color2: number;
  color3: number;
  itemsRaw: string;
  mapId: number | null;
  cellId: number | null;
}

export interface CharacterCallbacks {
  onCharacterSelected?: (character: CharacterInfo) => void;
}

export class CharacterHandler {
  private currentCharacter: CharacterInfo | null = null;
  private currentStats: CharacterStats | null = null;

  constructor(
    private readonly messageHandler: MessageHandler,
    private readonly callbacks: CharacterCallbacks = {}
  ) {
    this.register();
  }

  getCurrentCharacter(): CharacterInfo | null {
    return this.currentCharacter;
  }

  getCurrentStats(): CharacterStats | null {
    return this.currentStats;
  }

  setMapPosition(mapId: number, cellId: number): void {
    if (this.currentCharacter) {
      this.currentCharacter.mapId = mapId;
      this.currentCharacter.cellId = cellId;
    }
  }

  private register(): void {
    this.messageHandler.on(
      "accountCharacterSelected",
      (payload: AccountCharacterSelected) => {
        if (!payload.success) {
          log.warn("Character selection failed");
          return;
        }

        this.currentCharacter = {
          id: payload.characterId,
          spriteId: String(payload.characterId),
          name: payload.characterName,
          level: payload.level,
          sex: payload.sex,
          gfxId: payload.gfxId,
          color1: payload.color1,
          color2: payload.color2,
          color3: payload.color3,
          itemsRaw: payload.items,
          mapId: null,
          cellId: null,
        };

        log.info(
          `Character selected: ${payload.characterName} (id=${payload.characterId})`
        );

        characterStore.setState({
          name: payload.characterName,
          gfxId: payload.gfxId,
          color1: payload.color1,
          color2: payload.color2,
          color3: payload.color3,
          // 1.29 encodes the breed in the sprite id as `classId * 10 + sex`
          // (dev-seed: class 1, sex 0 → gfx 10). The selection frame has no
          // class field of its own, and the spell book's "Classe" filter
          // needs one — a hard-coded 0 matches no breed in the classes
          // bundle, which silently turns that filter into a no-op.
          classId: Math.floor(payload.gfxId / 10),
          level: payload.level,
        });

        loginActor.send({ type: "CHARACTER_LOADED" });
        this.callbacks.onCharacterSelected?.(this.currentCharacter);
      }
    );

    this.messageHandler.on("accountStats", (payload: AccountStats) => {
      const stats = accountStatsToCharacterStats(payload);
      this.currentStats = stats;
      characterStore.setState({
        stats,
        // `showedLevel` is what the server puts here; a frame that
        // somehow omits it must not knock the level back to 1 after
        // AccountCharacterSelected already told us the real one.
        ...(stats.level > 0 ? { level: stats.level } : {}),
        hp: { current: stats.hp, max: stats.maxHp },
        energy: { current: stats.energy, max: stats.maxEnergy },
        xp: { current: stats.xp, min: stats.xpLow, max: stats.xpHigh },
        kamas: stats.kama,
      });
    });

    this.messageHandler.on("accountNewLevel", (payload) => {
      if (this.currentCharacter) {
        this.currentCharacter.level = payload.newLevel;
      }
      characterStore.setState({ level: payload.newLevel });
    });
  }
}

/**
 * Proto AccountStats carries per-stat `StatEntry { base, items, debuffs, boosts, additional }`
 * plus direct numeric fields for hp/energy/initiative/etc. The renderer-facing
 * CharacterStats type flattens StatEntry to `{ base, items, boost }` and keeps
 * a limited set of fields — the rest of the proto data stays reachable via
 * `getCurrentStats()` when needed.
 */
function accountStatsToCharacterStats(s: AccountStats): CharacterStats {
  const flat = (e: AccountStats["strength"]) => ({
    base: e?.base ?? 0,
    items: e?.items ?? 0,
    boost: e?.boosts ?? 0,
  });

  return {
    vitality: flat(s.vitality),
    wisdom: flat(s.wisdom),
    strength: flat(s.strength),
    chance: flat(s.chance),
    agility: flat(s.agility),
    intelligence: flat(s.intelligence),
    hp: s.lp,
    maxHp: s.lpMax,
    ap: flat(s.ap),
    mp: flat(s.mp),
    energy: s.energy,
    maxEnergy: s.energyMax,
    bonusPoints: s.bonusPoints,
    bonusPointsSpell: s.bonusPointsSpell,
    xp: Number(s.xp),
    xpLow: Number(s.xpLow),
    xpHigh: Number(s.xpHigh),
    level: s.showedLevel,
    kama: Number(s.kama),
    initiative: s.initiative,
    discernment: s.discernment,
    range: flat(s.range),
    summonLimit: flat(s.maxSummons),
    successPoints: s.successPoints,
    criticalHit: flat(s.criticalHit).base + flat(s.criticalHit).items,
  };
}
