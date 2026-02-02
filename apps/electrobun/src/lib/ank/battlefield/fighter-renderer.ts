import { Container, Graphics, Text, TextStyle, Ticker } from "pixi.js";

import {
  CELL_HALF_HEIGHT,
  CELL_HALF_WIDTH,
  DEFAULT_GROUND_LEVEL,
  DEFAULT_MAP_WIDTH,
} from "@/constants/battlefield";
import { Direction, FighterTeam } from "@/ecs/components";

import { getCellPosition } from "./datacenter/cell";

/**
 * Fighter animation state.
 */
export const FighterAnimation = {
  IDLE: "idle",
  WALK: "walk",
  RUN: "run",
  ATTACK: "attack",
  HIT: "hit",
  DEATH: "death",
  CAST: "cast",
} as const;

export type FighterAnimationValue =
  (typeof FighterAnimation)[keyof typeof FighterAnimation];

/**
 * Fighter sprite data.
 */
export interface FighterSpriteData {
  id: number;
  name: string;
  team: number;
  cellId: number;
  direction: number;
  look: string;
  hp: number;
  maxHp: number;
  isPlayer: boolean;
}

/**
 * Active fighter sprite.
 */
interface ActiveFighter {
  id: number;
  container: Container;
  graphics: Graphics;
  nameText: Text;
  hpBar: Graphics;
  cellId: number;
  direction: number;
  team: number;
  hp: number;
  maxHp: number;
  animation: FighterAnimationValue;
  path: number[];
  pathProgress: number;
  moving: boolean;
  moveResolve?: () => void;
}

/**
 * Fighter renderer configuration.
 */
export interface FighterRendererConfig {
  mapWidth?: number;
  groundLevel?: number;
  moveSpeed?: number;
}

/**
 * Fighter renderer.
 * Manages fighter sprites on the battlefield.
 */
export class FighterRenderer {
  private container: Container;
  private fighters: Map<number, ActiveFighter> = new Map();
  private mapWidth: number;
  private groundLevel: number;
  private moveSpeed: number;
  private tickerCallback: () => void;

  constructor(parentContainer: Container, config: FighterRendererConfig = {}) {
    this.mapWidth = config.mapWidth ?? DEFAULT_MAP_WIDTH;
    this.groundLevel = config.groundLevel ?? DEFAULT_GROUND_LEVEL;
    this.moveSpeed = config.moveSpeed ?? 4; // Cells per second

    this.container = new Container();
    this.container.label = "fighter-renderer";
    this.container.sortableChildren = true;

    parentContainer.addChild(this.container);

    this.tickerCallback = () => this.update();
    Ticker.shared.add(this.tickerCallback);
  }

  /**
   * Add a fighter to the battlefield.
   */
  addFighter(data: FighterSpriteData): void {
    if (this.fighters.has(data.id)) {
      this.updateFighter(data.id, data);
      return;
    }

    const fighterContainer = new Container();
    fighterContainer.label = `fighter-${data.id}`;
    fighterContainer.sortableChildren = true;

    // Placeholder graphics (will be replaced with actual sprites)
    const graphics = new Graphics();
    this.drawFighterPlaceholder(graphics, data.team, data.direction);
    fighterContainer.addChild(graphics);

    // Name text
    const nameStyle = new TextStyle({
      fontFamily: "Arial",
      fontSize: 10,
      fontWeight: "bold",
      fill: data.team === FighterTeam.RED ? 0xff6666 : 0x6666ff,
      stroke: { color: 0x000000, width: 2 },
      align: "center",
    });

    const nameText = new Text({ text: data.name, style: nameStyle });
    nameText.anchor.set(0.5, 1);
    nameText.y = -35;
    fighterContainer.addChild(nameText);

    // HP bar
    const hpBar = new Graphics();
    this.drawHPBar(hpBar, data.hp, data.maxHp, data.team);
    hpBar.y = -40;
    fighterContainer.addChild(hpBar);

    // Position at cell
    const pos = getCellPosition(data.cellId, this.mapWidth, this.groundLevel);
    fighterContainer.x = pos.x + CELL_HALF_WIDTH;
    fighterContainer.y = pos.y + CELL_HALF_HEIGHT;
    fighterContainer.zIndex = this.calculateZIndex(data.cellId);

    this.container.addChild(fighterContainer);

    const fighter: ActiveFighter = {
      id: data.id,
      container: fighterContainer,
      graphics,
      nameText,
      hpBar,
      cellId: data.cellId,
      direction: data.direction,
      team: data.team,
      hp: data.hp,
      maxHp: data.maxHp,
      animation: FighterAnimation.IDLE,
      path: [],
      pathProgress: 0,
      moving: false,
    };

    this.fighters.set(data.id, fighter);
  }

  /**
   * Remove a fighter from the battlefield.
   */
  removeFighter(id: number): void {
    const fighter = this.fighters.get(id);

    if (!fighter) {
      return;
    }

    this.container.removeChild(fighter.container);
    fighter.container.destroy({ children: true });
    this.fighters.delete(id);
  }

  /**
   * Update fighter data.
   */
  updateFighter(id: number, data: Partial<FighterSpriteData>): void {
    const fighter = this.fighters.get(id);

    if (!fighter) {
      return;
    }

    if (
      data.cellId !== undefined &&
      data.cellId !== fighter.cellId &&
      !fighter.moving
    ) {
      this.teleportFighter(id, data.cellId);
    }

    if (data.direction !== undefined && data.direction !== fighter.direction) {
      fighter.direction = data.direction;
      this.drawFighterPlaceholder(
        fighter.graphics,
        fighter.team,
        fighter.direction
      );
    }

    if (data.hp !== undefined || data.maxHp !== undefined) {
      fighter.hp = data.hp ?? fighter.hp;
      fighter.maxHp = data.maxHp ?? fighter.maxHp;
      this.drawHPBar(fighter.hpBar, fighter.hp, fighter.maxHp, fighter.team);
    }

    if (data.name !== undefined) {
      fighter.nameText.text = data.name;
    }
  }

  /**
   * Move fighter along a path.
   */
  moveFighter(id: number, path: number[]): Promise<void> {
    return new Promise((resolve) => {
      const fighter = this.fighters.get(id);

      if (!fighter || path.length === 0) {
        resolve();
        return;
      }

      fighter.path = path;
      fighter.pathProgress = 0;
      fighter.moving = true;
      fighter.animation = FighterAnimation.WALK;

      fighter.moveResolve = resolve;
    });
  }

  /**
   * Teleport fighter to a cell instantly.
   */
  teleportFighter(id: number, cellId: number): void {
    const fighter = this.fighters.get(id);

    if (!fighter) {
      return;
    }

    fighter.cellId = cellId;
    const pos = getCellPosition(cellId, this.mapWidth, this.groundLevel);
    fighter.container.x = pos.x + CELL_HALF_WIDTH;
    fighter.container.y = pos.y + CELL_HALF_HEIGHT;
    fighter.container.zIndex = this.calculateZIndex(cellId);
  }

  /**
   * Set fighter animation.
   */
  setAnimation(id: number, animation: FighterAnimationValue): void {
    const fighter = this.fighters.get(id);

    if (!fighter) {
      return;
    }

    fighter.animation = animation;
    // TODO: Play actual animation when sprites are loaded
  }

  /**
   * Set fighter direction.
   */
  setDirection(id: number, direction: number): void {
    const fighter = this.fighters.get(id);

    if (!fighter) {
      return;
    }

    fighter.direction = direction;
    this.drawFighterPlaceholder(fighter.graphics, fighter.team, direction);
  }

  /**
   * Get fighter cell position.
   */
  getFighterCell(id: number): number | undefined {
    return this.fighters.get(id)?.cellId;
  }

  /**
   * Get all fighter IDs.
   */
  getFighterIds(): number[] {
    return Array.from(this.fighters.keys());
  }

  /**
   * Check if fighter exists.
   */
  hasFighter(id: number): boolean {
    return this.fighters.has(id);
  }

  /**
   * Update animation tick.
   */
  private update(): void {
    const delta = Ticker.shared.deltaMS / 1000;

    for (const fighter of this.fighters.values()) {
      if (!fighter.moving || fighter.path.length === 0) {
        continue;
      }

      fighter.pathProgress += delta * this.moveSpeed;

      const currentStep = Math.floor(fighter.pathProgress);

      if (currentStep >= fighter.path.length - 1) {
        // Movement complete
        const finalCell = fighter.path[fighter.path.length - 1];
        fighter.cellId = finalCell;
        const pos = getCellPosition(finalCell, this.mapWidth, this.groundLevel);
        fighter.container.x = pos.x + CELL_HALF_WIDTH;
        fighter.container.y = pos.y + CELL_HALF_HEIGHT;
        fighter.container.zIndex = this.calculateZIndex(finalCell);
        fighter.path = [];
        fighter.pathProgress = 0;
        fighter.moving = false;
        fighter.animation = FighterAnimation.IDLE;

        // Resolve move promise
        if (fighter.moveResolve) {
          const resolve = fighter.moveResolve;
          fighter.moveResolve = undefined;
          resolve();
        }

        continue;
      }

      // Interpolate between cells
      const fromCell = fighter.path[currentStep];
      const toCell = fighter.path[currentStep + 1];
      const t = fighter.pathProgress - currentStep;

      const fromPos = getCellPosition(
        fromCell,
        this.mapWidth,
        this.groundLevel
      );
      const toPos = getCellPosition(toCell, this.mapWidth, this.groundLevel);

      fighter.container.x =
        fromPos.x + CELL_HALF_WIDTH + (toPos.x - fromPos.x) * t;
      fighter.container.y =
        fromPos.y + CELL_HALF_HEIGHT + (toPos.y - fromPos.y) * t;
      fighter.cellId = fromCell;
      fighter.container.zIndex = this.calculateZIndex(fromCell);

      // Update direction based on movement
      const newDirection = this.calculateDirection(fromCell, toCell);

      if (newDirection !== fighter.direction) {
        fighter.direction = newDirection;
        this.drawFighterPlaceholder(
          fighter.graphics,
          fighter.team,
          fighter.direction
        );
      }
    }
  }

  /**
   * Calculate direction between two cells.
   */
  private calculateDirection(fromCell: number, toCell: number): number {
    const fromPos = getCellPosition(fromCell, this.mapWidth, this.groundLevel);
    const toPos = getCellPosition(toCell, this.mapWidth, this.groundLevel);

    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;

    // 8-direction based on vector
    if (dx > 0 && dy === 0) {
      return Direction.EAST;
    }

    if (dx > 0 && dy > 0) {
      return Direction.SOUTH_EAST;
    }

    if (dx === 0 && dy > 0) {
      return Direction.SOUTH;
    }

    if (dx < 0 && dy > 0) {
      return Direction.SOUTH_WEST;
    }

    if (dx < 0 && dy === 0) {
      return Direction.WEST;
    }

    if (dx < 0 && dy < 0) {
      return Direction.NORTH_WEST;
    }

    if (dx === 0 && dy < 0) {
      return Direction.NORTH;
    }

    return Direction.NORTH_EAST;
  }

  /**
   * Calculate z-index from cell position.
   */
  private calculateZIndex(cellId: number): number {
    const pos = getCellPosition(cellId, this.mapWidth, this.groundLevel);
    return Math.floor(pos.y * 100 + pos.x);
  }

  /**
   * Draw placeholder fighter graphic.
   */
  private drawFighterPlaceholder(
    graphics: Graphics,
    team: number,
    direction: number
  ): void {
    graphics.clear();

    const color = team === FighterTeam.RED ? 0xff4444 : 0x4444ff;

    // Body circle
    graphics.circle(0, -10, 12);
    graphics.fill({ color, alpha: 0.8 });
    graphics.stroke({ color: 0x000000, width: 2 });

    // Head circle
    graphics.circle(0, -25, 8);
    graphics.fill({ color, alpha: 0.9 });
    graphics.stroke({ color: 0x000000, width: 2 });

    // Direction indicator
    const angles = [0, 45, 90, 135, 180, 225, 270, 315];
    const angle = (angles[direction] * Math.PI) / 180;
    const indicatorX = Math.cos(angle) * 15;
    const indicatorY = Math.sin(angle) * 8 - 10;

    graphics.circle(indicatorX, indicatorY, 4);
    graphics.fill({ color: 0xffff00 });
  }

  /**
   * Draw HP bar.
   */
  private drawHPBar(
    graphics: Graphics,
    hp: number,
    maxHp: number,
    team: number
  ): void {
    graphics.clear();

    const width = 30;
    const height = 4;
    const ratio = Math.max(0, Math.min(1, hp / maxHp));

    // Background
    graphics.rect(-width / 2, 0, width, height);
    graphics.fill({ color: 0x333333 });

    // HP fill
    const hpColor = team === FighterTeam.RED ? 0xff4444 : 0x4444ff;
    graphics.rect(-width / 2, 0, width * ratio, height);
    graphics.fill({ color: hpColor });

    // Border
    graphics.rect(-width / 2, 0, width, height);
    graphics.stroke({ color: 0x000000, width: 1 });
  }

  /**
   * Set map dimensions.
   */
  setMapDimensions(width: number, groundLevel?: number): void {
    this.mapWidth = width;

    if (groundLevel !== undefined) {
      this.groundLevel = groundLevel;
    }
  }

  /**
   * Update container position.
   */
  setOffset(x: number, y: number): void {
    this.container.x = x;
    this.container.y = y;
  }

  /**
   * Set container scale.
   */
  setScale(scale: number): void {
    this.container.scale.set(scale);
  }

  /**
   * Clear all fighters.
   */
  clear(): void {
    for (const fighter of this.fighters.values()) {
      fighter.container.destroy({ children: true });
    }

    this.fighters.clear();
    this.container.removeChildren();
  }

  /**
   * Destroy the renderer.
   */
  destroy(): void {
    Ticker.shared.remove(this.tickerCallback);
    this.clear();
    this.container.destroy();
  }
}
