import type { DofusPathfinding } from "@dofus/grid";
import type { Sprite } from "pixi.js";
import { Container, Graphics, Ticker } from "pixi.js";

import type { CellData } from "@/game/datacenter/cell";
import type { PickingSystem } from "@/game/render/picking-system";
import type { Scene } from "@/game/scene/scene";
import {
  type CharacterSpriteLoader,
  getCharacterSpriteLoader,
} from "@/game/assets/character-sprite";
import {
  DEFAULT_GROUND_LEVEL,
  DEFAULT_MAP_WIDTH,
} from "@/game/constants/battlefield";
import { playerZIndex } from "@/game/constants/z-index";
import { PlayerActor } from "@/game/scene/player/actor";
import {
  getAnimationBaseFromType,
  getCellPositionWithSlope,
  initFrameState,
  initMovementState,
  PlayerAnimation,
  type PlayerAnimationValue,
} from "@/game/scene/player/animation";
import { drawHPBar, drawPlayerPlaceholder } from "@/game/scene/player/graphics";
import { PlayerMovement } from "@/game/scene/player/movement";
import { PlayerNameplate } from "@/game/scene/player/nameplate";
import { PlayerPerfMonitor } from "@/game/scene/player/perf";
import { PlayerSpriteController } from "@/game/scene/player/sprite-controller";
import {
  type ActivePlayer,
  type PlayerRendererConfig,
  type PlayerSpriteData,
  parseGfxId,
} from "@/game/scene/player/types";
import { createLogger } from "@/utils/logger";

const log = createLogger("PlayerRenderer");

const GHOST_VIEW_ALPHA = 0.8;

/**
 * Map-level coordinator that owns the player registry + the PIXI parent
 * container. Per-player concerns (sprite loading, animation, movement,
 * nameplate, mount layers, HP, perf) live in focused collaborators that
 * receive an ActivePlayer reference to read/mutate.
 */
export class PlayerRenderer {
  private container: Container;
  private players: Map<number, ActivePlayer> = new Map();
  private playerActors: Map<number, PlayerActor> = new Map();
  private mapWidth: number;
  private groundLevel: number;
  private cellDataMap: Map<number, CellData>;
  private pickingSystem: PickingSystem | null;
  private spriteLoader: CharacterSpriteLoader;
  private ghostView = false;
  private pathfinding: DofusPathfinding | null;
  private scene: Scene;
  private unsubPreTick: () => void;
  private unsubPostTick: () => void;

  private readonly sprites: PlayerSpriteController;
  private readonly movement: PlayerMovement;
  private readonly perf = new PlayerPerfMonitor();

  constructor(parentContainer: Container, config: PlayerRendererConfig) {
    this.mapWidth = config.mapWidth ?? DEFAULT_MAP_WIDTH;
    this.groundLevel = config.groundLevel ?? DEFAULT_GROUND_LEVEL;
    this.cellDataMap = config.cellDataMap ?? new Map();
    this.pickingSystem = config.pickingSystem ?? null;
    this.spriteLoader = config.spriteLoader ?? getCharacterSpriteLoader();
    this.pathfinding = config.pathfinding ?? null;
    this.scene = config.scene;
    this.container = parentContainer;

    this.sprites = new PlayerSpriteController(
      this.spriteLoader,
      (id) => this.players.has(id),
      () => this.players.size
    );

    this.movement = new PlayerMovement({
      mapWidth: () => this.mapWidth,
      groundLevel: () => this.groundLevel,
      cellDataMap: () => this.cellDataMap,
      pathfinding: () => this.pathfinding,
      pickingSystem: () => this.pickingSystem,
      players: () => this.players,
      spriteController: () => this.sprites,
      calculateZIndex: (cellId) => this.calculateZIndex(cellId),
    });

    this.unsubPreTick = this.scene.onPreTick(() => this.onPreTick());
    this.unsubPostTick = this.scene.onPostTick(() => this.onPostTick());
  }

  // ── Player lifecycle ───────────────────────────────────────────────

  addPlayer(data: PlayerSpriteData): Promise<void> {
    if (this.players.has(data.id)) {
      this.updatePlayer(data.id, data);
      return Promise.resolve();
    }

    const player = this.buildActivePlayer(data);
    this.players.set(data.id, player);
    this.registerPlayerActor(data.id, player);

    if (data.linkedChildren && data.linkedChildren.length > 0) {
      return this.loadWithLinkedChildren(data, player);
    }

    return this.sprites.boot(player, data.direction);
  }

  removePlayer(id: number): void {
    if (!this.players.has(id)) {
      return;
    }

    log.debug(`removePlayer ${id}`);

    const actor = this.playerActors.get(id);

    if (actor) {
      this.scene.remove(actor.id);
    } else {
      this.cleanupPlayer(id);
    }
  }

  updatePlayer(id: number, data: Partial<PlayerSpriteData>): void {
    const player = this.players.get(id);

    if (!player) {
      return;
    }

    if (
      data.cellId !== undefined &&
      data.cellId !== player.cellId &&
      !player.moving
    ) {
      this.teleportPlayer(id, data.cellId);
    }

    if (data.direction !== undefined && data.direction !== player.direction) {
      player.direction = data.direction;

      if (player.sprite) {
        const baseAnim = getAnimationBaseFromType(player.animation);
        this.sprites.switch(player, baseAnim, data.direction);
      } else if (player.placeholderGraphics) {
        drawPlayerPlaceholder(
          player.placeholderGraphics,
          player.team,
          player.direction
        );
      }
    }

    if (data.hp !== undefined || data.maxHp !== undefined) {
      player.hp = data.hp ?? player.hp;
      player.maxHp = data.maxHp ?? player.maxHp;

      if (player.hpBar.visible) {
        drawHPBar(player.hpBar, player.hp, player.maxHp, player.team);
      }
    }

    if (data.name !== undefined) {
      player.nameplate.setName(data.name);
    }
  }

  // ── Movement ────────────────────────────────────────────────────────

  movePlayer(id: number, path: number[]): Promise<void> {
    const player = this.players.get(id);

    if (!player) {
      return Promise.resolve();
    }

    return this.movement.start(player, path);
  }

  teleportPlayer(id: number, cellId: number): void {
    const player = this.players.get(id);

    if (player) {
      this.movement.teleport(player, cellId);
    }
  }

  setAnimation(id: number, animation: PlayerAnimationValue): void {
    const player = this.players.get(id);

    if (!player) {
      return;
    }

    player.animation = animation;
    const baseAnim = getAnimationBaseFromType(animation);
    this.sprites.switch(player, baseAnim, player.direction);
  }

  setDirection(id: number, direction: number): void {
    const player = this.players.get(id);

    if (!player) {
      return;
    }

    player.direction = direction;
    const baseAnim = getAnimationBaseFromType(player.animation);
    this.sprites.switch(player, baseAnim, direction);
  }

  // ── Accessors ───────────────────────────────────────────────────────

  getPlayerCell(id: number): number | undefined {
    return this.players.get(id)?.cellId;
  }

  getPlayerIds(): number[] {
    return Array.from(this.players.keys());
  }

  hasPlayer(id: number): boolean {
    return this.players.has(id);
  }

  getContainer(): Container {
    return this.container;
  }

  getPlayerName(id: number): string | null {
    return this.players.get(id)?.nameplate.getName() ?? null;
  }

  getPlayerPickingData(
    id: number
  ): { sprite: Sprite; container: Container } | null {
    const f = this.players.get(id);

    if (!f?.sprite) {
      return null;
    }

    return { sprite: f.sprite, container: f.container };
  }

  get lastUpdateMs(): number {
    return this.perf.lastUpdateMs;
  }

  // ── Nameplate ───────────────────────────────────────────────────────

  showName(id: number): void {
    const f = this.players.get(id);
    f?.nameplate.show(f.container);
  }

  hideName(id: number): void {
    const f = this.players.get(id);
    f?.nameplate.hide(f.container);
  }

  // ── Camera / map sync ───────────────────────────────────────────────

  setGhostView(enabled: boolean): void {
    this.ghostView = enabled;

    for (const player of this.players.values()) {
      player.container.zIndex = this.calculateZIndex(player.cellId);
      player.container.alpha = enabled ? GHOST_VIEW_ALPHA : 1;
    }
  }

  setMapDimensions(width: number, groundLevel?: number): void {
    this.mapWidth = width;

    if (groundLevel !== undefined) {
      this.groundLevel = groundLevel;
    }
  }

  setOffset(x: number, y: number): void {
    this.container.x = x;
    this.container.y = y;
  }

  setScale(scale: number): void {
    this.container.scale.set(scale);
  }

  onResize(event: { zoom: number }): void {
    // mapContainer is already scaled to the zoom level — don't scale this one.
    const res = Math.max(2, Math.ceil(event.zoom));

    for (const player of this.players.values()) {
      player.nameplate.setResolution(res);
    }

    this.spriteLoader.setZoom(event.zoom);
    this.sprites.reloadAll(this.players.values());
    this.pickingSystem?.markDirty();
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  clear(): void {
    log.debug(`clear() — removing ${this.players.size} players`);

    for (const actor of Array.from(this.playerActors.values())) {
      this.scene.remove(actor.id);
    }
  }

  destroy(): void {
    this.unsubPreTick();
    this.unsubPostTick();
    this.clear();
  }

  // ── Internals ───────────────────────────────────────────────────────

  private buildActivePlayer(data: PlayerSpriteData): ActivePlayer {
    const display = this.createPlayerContainer(data);
    const frame = initFrameState();
    const move = initMovementState();

    return {
      id: data.id,
      container: display.container,
      sprite: null,
      placeholderGraphics: display.placeholderGraphics,
      nameplate: display.nameplate,
      hpBar: display.hpBar,
      cellId: data.cellId,
      direction: data.direction,
      team: data.team,
      hp: data.hp,
      maxHp: data.maxHp,
      gfxId: parseGfxId(data.look),
      animation: PlayerAnimation.IDLE,
      currentAnimName: "",
      currentAnimData: null,
      frameIndex: frame.frameIndex,
      frameTimer: frame.frameTimer,
      path: move.path,
      pathIndex: move.pathIndex,
      moveDistance: move.moveDistance,
      moveCosRot: move.moveCosRot,
      moveSinRot: move.moveSinRot,
      movePixelSpeed: move.movePixelSpeed,
      useRun: move.useRun,
      isMounting: !!data.mount,
      moving: move.moving,
      spriteLoading: false,
      pendingAnim: null,
      look: data.look,
      linkedChildren: [],
      mount: data.mount,
      mountLayers: null,
    };
  }

  /** Build the PIXI container + its decorations; does not load sprite textures. */
  private createPlayerContainer(data: PlayerSpriteData): {
    container: Container;
    placeholderGraphics: Graphics;
    nameplate: PlayerNameplate;
    hpBar: Graphics;
  } {
    const container = new Container();
    container.label = `player-${data.id}`;
    container.sortableChildren = true;
    // Hide container until sprite loads to avoid placeholder flash.
    container.visible = false;

    const placeholderGraphics = new Graphics();
    drawPlayerPlaceholder(placeholderGraphics, data.team, data.direction);
    container.addChild(placeholderGraphics);

    const nameplate = new PlayerNameplate(data.name);

    // HP bar hidden for world actors in roleplay mode; shown by fight UI.
    const hpBar = new Graphics();
    hpBar.visible = false;

    const pos = getCellPositionWithSlope(
      data.cellId,
      this.mapWidth,
      this.groundLevel,
      this.cellDataMap
    );
    container.x = pos.x;
    container.y = pos.y;
    container.zIndex = this.calculateZIndex(data.cellId);

    this.container.addChild(container);

    return { container, placeholderGraphics, nameplate, hpBar };
  }

  private registerPlayerActor(
    playerId: number,
    player: ActivePlayer
  ): PlayerActor {
    const actor = new PlayerActor(
      playerId,
      player,
      (dt) => {
        const f = this.players.get(playerId);

        if (f) {
          this.sprites.tickFrame(f, dt / 1000);
          this.movement.advance(f, dt);
        }
      },
      () => this.cleanupPlayer(playerId)
    );

    this.playerActors.set(playerId, actor);
    this.scene.add(actor);

    return actor;
  }

  /** Load parent + each linked child, then wait on all of them. */
  private async loadWithLinkedChildren(
    data: PlayerSpriteData,
    player: ActivePlayer
  ): Promise<void> {
    const children = data.linkedChildren ?? [];
    const childPromises: Promise<void>[] = [];

    for (const child of children) {
      const childId = data.id * 1000 + child.childIndex;
      const childCellId = this.movement.aroundCell(
        data.cellId,
        data.direction,
        child.childIndex
      );

      childPromises.push(
        this.addPlayer({
          id: childId,
          name: "",
          team: data.team,
          cellId: childCellId,
          direction: data.direction,
          look: `${child.gfxId}`,
          hp: 100,
          maxHp: 100,
          isPlayer: false,
        })
      );

      const childFighter = this.players.get(childId);

      if (childFighter) {
        childFighter.linkedParentId = data.id;
        childFighter.childIndex = child.childIndex;
        player.linkedChildren.push(childId);
      }
    }

    const basePromise =
      player.gfxId > 0
        ? this.sprites.loadForParent(player, "static", data.direction)
        : Promise.resolve();

    await Promise.all([basePromise, ...childPromises]);
  }

  private cleanupPlayer(id: number): void {
    const player = this.players.get(id);

    if (!player) {
      return;
    }

    for (const childId of player.linkedChildren) {
      this.removePlayer(childId);
    }

    this.container.removeChild(player.container);
    player.container.destroy({ children: true });
    this.players.delete(id);
    this.playerActors.delete(id);
  }

  private calculateZIndex(cellId: number): number {
    return playerZIndex(cellId, this.ghostView);
  }

  private onPreTick(): void {
    this.perf.beginFrame();
    this.spriteLoader.getAtlas()?.tick();
  }

  private onPostTick(): void {
    this.perf.endAnim();

    const flushT0 = performance.now();
    this.spriteLoader.getAtlas()?.flush();
    this.perf.recordFlush(flushT0);

    this.perf.endFrame(
      Ticker.shared.deltaMS,
      this.players.size,
      this.spriteLoader.getAtlas()
    );
  }
}

export type {
  PlayerRendererConfig,
  PlayerSpriteData,
} from "@/game/scene/player/types";
export { PlayerAnimation };
export type { PlayerAnimationValue };
