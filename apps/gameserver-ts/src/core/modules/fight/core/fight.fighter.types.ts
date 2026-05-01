import type { PlayerRow, PlayerStatsRow } from "@shared/db/schema";

export type PlayerSnapshot = Pick<
  PlayerRow,
  "name" | "level" | "life" | "sex" | "gfx" | "direction"
> & {
  id: number;
  /**
   * Computed max life — canonical Dofus 1.29 formula
   * `50 + 5 * level + totalVitality`. When omitted (e.g. test
   * fixtures), `Fighter.fromPlayer` falls back to `life` and the
   * fighter spawns at full HP. The production fight-start path always
   * provides this so the bar maxes out at the player's full cap
   * rather than whatever current LP the DB happened to store.
   */
  lifeMax?: number;
  /**
   * Per-zone player colors (RGB as 0xRRGGBB) sourced from
   * `player_colors`. `-1` means "keep palette default". The fight
   * SpriteMovementEntry forwards these as `CharacterColors` so the
   * client renders the StringCourse portrait + accessory-tinted sprite
   * with the same colors as in the roleplay map.
   */
  color1?: number;
  color2?: number;
  color3?: number;
  stats: Pick<
    PlayerStatsRow,
    "strength" | "vitality" | "wisdom" | "intelligence" | "chance" | "agility"
  >;
};
