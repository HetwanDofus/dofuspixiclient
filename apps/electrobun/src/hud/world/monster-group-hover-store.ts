import { ExternalStore } from "@/game/stores/game-store";

export interface MonsterGroupMemberView {
  templateId: number;
  name: string;
  level: number;
  gfxId: number;
}

export interface MonsterGroupHoverState {
  /**
   * Active hovered group, or null when no monster group is under the cursor.
   * Coordinates are page-space (already translated out of PIXI-local space
   * by the picking handler) so the tooltip can be absolutely positioned.
   */
  group: {
    spriteId: string;
    members: MonsterGroupMemberView[];
    /**
     * Difficulty bonus mirroring `dofus.datacenter.MonsterGroup._nBonusValue`.
     * The hover panel splits this 0-1500 value across 5 stars (per
     * `TextWithTitleOverHead.getStarsColor` / `STARS_COLORS`). Zero means
     * the row of 5 stars is fully transparent.
     */
    bonusValue: number;
    x: number;
    y: number;
    /**
     * Anchor side. "right" places the panel to the right of (x, y);
     * "left" places it to the left. Set to "left" automatically when
     * the group sits near the right edge of the canvas to keep the
     * tooltip from clipping. Defaults to "right" for backwards compat.
     */
    side?: "left" | "right";
  } | null;
}

const initial: MonsterGroupHoverState = { group: null };

export const monsterGroupHoverStore = new ExternalStore<MonsterGroupHoverState>(
  initial
);

export function setMonsterGroupHover(
  group: MonsterGroupHoverState["group"]
): void {
  monsterGroupHoverStore.setState({ group });
}

export function clearMonsterGroupHover(): void {
  monsterGroupHoverStore.setState({ group: null });
}
