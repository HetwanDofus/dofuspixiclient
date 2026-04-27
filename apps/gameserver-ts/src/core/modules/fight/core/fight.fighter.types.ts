import type { PlayerRow, PlayerStatsRow } from "@shared/db/schema";

export type PlayerSnapshot = Pick<
  PlayerRow,
  "name" | "level" | "life" | "sex" | "gfx" | "direction"
> & {
  id: number;
  stats: Pick<
    PlayerStatsRow,
    "strength" | "vitality" | "wisdom" | "intelligence" | "chance" | "agility"
  >;
};
