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
    x: number;
    y: number;
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
