import type { Graphics } from "pixi.js";

import { PlayerTeam } from "@/game/fight/types";

const PLACEHOLDER_BODY_COLOR_RED = 0xff4444;
const PLACEHOLDER_BODY_COLOR_BLUE = 0x4444ff;
const DIRECTION_ANGLES_DEG = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * Under-foot team ring drawn below every fighter sprite during combat.
 * Dimensions mirror the original circle.swf / circle_0.svg extracted
 * from the 1.29 client (37.1×18.9, centered on the sprite's feet).
 * Colors come straight from dofus.Constants.TEAMS_COLOR
 *   = [16711680, 255] → [0xFF0000, 0x0000FF]
 * so team 0 reads red, team 1 reads blue regardless of whose
 * perspective is viewing — matches the original's absolute coloring.
 */
const FIGHTER_CIRCLE_RADIUS_X = 18.55;
const FIGHTER_CIRCLE_RADIUS_Y = 9.45;

export function drawFighterGroundCircle(
  graphics: Graphics,
  team: number
): void {
  graphics.clear();
  const color = team === PlayerTeam.RED ? 0xff0000 : 0x0000ff;

  // Identical underfoot ring for every fighter — mirrors the original
  // `addSpriteExtraClip(..., CIRCLE_FILE, TEAMS_COLOR[Team])` in
  // GameIn.as:1298. The "active turn" indicator in 1.29 lives on the
  // sprite itself (Sprite.as:98 color transform), not on this ring,
  // so we don't vary it by turn state.
  graphics.ellipse(0, 0, FIGHTER_CIRCLE_RADIUS_X, FIGHTER_CIRCLE_RADIUS_Y);
  graphics.fill({ color, alpha: 0.18 });
  graphics.ellipse(0, 0, FIGHTER_CIRCLE_RADIUS_X, FIGHTER_CIRCLE_RADIUS_Y);
  graphics.stroke({ color, width: 2, alpha: 1 });
}

/**
 * Stand-in sprite shown while the real character atlas loads.
 * Colored by team with a direction indicator that prevents UI "blank" flicker.
 */
export function drawPlayerPlaceholder(
  graphics: Graphics,
  team: number,
  direction: number
): void {
  graphics.clear();

  const color =
    team === PlayerTeam.RED
      ? PLACEHOLDER_BODY_COLOR_RED
      : PLACEHOLDER_BODY_COLOR_BLUE;

  graphics.circle(0, -10, 12);
  graphics.fill({ color, alpha: 0.8 });
  graphics.stroke({ color: 0x000000, width: 2 });

  graphics.circle(0, -25, 8);
  graphics.fill({ color, alpha: 0.9 });
  graphics.stroke({ color: 0x000000, width: 2 });

  const angle = (DIRECTION_ANGLES_DEG[direction] * Math.PI) / 180;
  const indicatorX = Math.cos(angle) * 15;
  const indicatorY = Math.sin(angle) * 8 - 10;

  graphics.circle(indicatorX, indicatorY, 4);
  graphics.fill({ color: 0xffff00 });
}

const HP_BAR_WIDTH = 30;
const HP_BAR_HEIGHT = 4;
const HP_BAR_BG_COLOR = 0x333333;
const HP_BAR_RED = 0xff4444;
const HP_BAR_BLUE = 0x4444ff;

/** Flat team-colored HP fill with dark background + border. */
export function drawHPBar(
  graphics: Graphics,
  hp: number,
  maxHp: number,
  team: number
): void {
  graphics.clear();

  const ratio = Math.max(0, Math.min(1, hp / maxHp));

  graphics.rect(-HP_BAR_WIDTH / 2, 0, HP_BAR_WIDTH, HP_BAR_HEIGHT);
  graphics.fill({ color: HP_BAR_BG_COLOR });

  const hpColor = team === PlayerTeam.RED ? HP_BAR_RED : HP_BAR_BLUE;
  graphics.rect(-HP_BAR_WIDTH / 2, 0, HP_BAR_WIDTH * ratio, HP_BAR_HEIGHT);
  graphics.fill({ color: hpColor });

  graphics.rect(-HP_BAR_WIDTH / 2, 0, HP_BAR_WIDTH, HP_BAR_HEIGHT);
  graphics.stroke({ color: 0x000000, width: 1 });
}
