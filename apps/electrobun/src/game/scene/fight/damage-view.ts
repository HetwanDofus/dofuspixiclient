import type { Container } from "pixi.js";

import {
  DEFAULT_GROUND_LEVEL,
  DEFAULT_MAP_WIDTH,
} from "@/game/constants/battlefield";
import {
  type CellData,
  getCellPosition,
  getSlopeYOffset,
} from "@/game/datacenter/cell";
import type { Scene } from "@/game/scene/scene";
import {
  addDamagePoint,
  clearDamagePoints,
  damagePointsStore,
  removeDamagePoint,
} from "@/hud/fight/damage-points-store";
import {
  type AnchorResolver,
  damagePointsTracker,
} from "@/hud/fight/damage-points-tracker";

export const DamageType = {
  DAMAGE: "damage",
  HEAL: "heal",
  AP: "ap",
  MP: "mp",
  SHIELD: "shield",
} as const;

export type DamageTypeValue = (typeof DamageType)[keyof typeof DamageType];

export interface DamageDisplayConfig {
  value: number;
  type: DamageTypeValue;
  cellId: number;
  element?: number;
  critical?: boolean;
}

// Canonical Dofus 1.29 maps DamageType → CLIP_POINT_TYPE_*:
//   DAMAGE → 0   AP → 1   MP → 2   HEAL → 3   SHIELD/QUANTITY → 4
const TYPE_TO_CLIP_INDEX: Record<DamageTypeValue, number> = {
  [DamageType.DAMAGE]: 0,
  [DamageType.AP]: 1,
  [DamageType.MP]: 2,
  [DamageType.HEAL]: 3,
  [DamageType.SHIELD]: 4,
};

// Canonical playAllPointAnim ordering (FightPointAnimManager.as:96):
//   LIFE_POINT (damage / heal) → ACTION_POINT (AP) → MOVEMENT_POINT (MP)
// SHIELD is a custom QUANTITY clip placed last so it never preempts
// canonical types.
const TYPE_DISPLAY_ORDER: Record<DamageTypeValue, number> = {
  [DamageType.DAMAGE]: 0,
  [DamageType.HEAL]: 0,
  [DamageType.AP]: 1,
  [DamageType.MP]: 2,
  [DamageType.SHIELD]: 3,
};

// Style 1 = canonical critical / extended pop (50 frames, finishFrame
// at 37 → next queued point starts at f37 while fade-out plays).
// Style 0 = legacy compact variant (26 frames, runs to completion
// before the next can queue). All type variants within a style share
// the same timing — only the embedded text colour differs.
const DEFAULT_POINT_STYLE = 1;
const STYLE_TIMING: Record<number, { totalFrames: number; finishFrame: number }> = {
  0: { totalFrames: 26, finishFrame: 26 },
  1: { totalFrames: 50, finishFrame: 37 },
};

// Canonical Dofus 1.29 host runs the main timeline at 30 fps. The
// SWFs are authored at 60 fps but Flash plays them at the host fps,
// so a 50-frame critical takes 50/30 = 1.667s on screen.
const POINT_FPS = 30;

// `Constants._SafeStr_664 = 50` — see `__Packages/.../battlefield/
// %1E%1C%06.as:38`. The original `addSpritePoints` (battlefield
// %13%18.as:760) attaches the point clip at `(spriteX, spriteY - 50)`.
// We anchor at the cell position (= sprite feet) and add the same
// 50 px upward when projecting.
const POINTS_TOP_OFFSET = 50;

export interface DamageRendererConfig {
  mapWidth?: number;
  groundLevel?: number;
  /** Window (ms) within which simultaneous damage events on the same cell
   *  are coalesced into a single floating number. Mirrors canonical
   *  `RegroupDamage` option (~50ms). */
  groupDelay?: number;
  cellDataMap?: Map<number, CellData>;
}

let nextDamagePointId = 1;

/**
 * Damage / AP / MP / heal renderer. The on-screen visuals are pure
 * CSS — see `apps/electrobun/src/hud/fight/points.css` (static layout
 * + `@property` declarations) and `points.generated.css` (per-clip
 * `@keyframes` compiled from the SWF manifests by the asset pipeline).
 *
 * This class is the producer side: it batches incoming damage events
 * through a 50ms regroup window, serialises stacked points per cell
 * via the canonical `_aPointsList[sID]` queue, and pushes spawn
 * entries to the React store. The React component mounts a `<div>`
 * with the right className to select the right keyframe trio. The
 * `DamagePointsTracker` keeps the per-instance CSS variables
 * (`--ax / --ay / --cs`) in sync with the camera every pre-tick by
 * writing directly to the DOM — no React reconciliation per frame.
 *
 * The constructor takes a Pixi `Container` (the parent transform we
 * project anchors through via `toGlobal`) and a `Scene` for tick
 * registration. The Pixi container is otherwise unused — points
 * never enter the canvas tree.
 */
export class DamageRenderer {
  private mapWidth: number;
  private groundLevel: number;
  private groupDelay: number;
  private cellDataMap: Map<number, CellData>;

  private readonly pendingDamage = new Map<number, DamageDisplayConfig[]>();
  private lastFlush = 0;
  private readonly cellQueues = new Map<number, DamageDisplayConfig[]>();
  /** Live point ids — drained on `clear` so the store can release them. */
  private readonly liveIds = new Set<number>();

  private readonly parentContainer: Container | null;
  private readonly unsubPreTick: () => void;

  constructor(
    parentContainer: Container | null,
    scene: Scene,
    config: DamageRendererConfig = {}
  ) {
    this.mapWidth = config.mapWidth ?? DEFAULT_MAP_WIDTH;
    this.groundLevel = config.groundLevel ?? DEFAULT_GROUND_LEVEL;
    this.groupDelay = config.groupDelay ?? 50;
    this.cellDataMap = config.cellDataMap ?? new Map();
    this.parentContainer = parentContainer;

    // Per pre-tick: drain the regroup window into per-cell queues
    // and push fresh anchors onto every live point's DOM node.
    const resolver = this.makeResolver();
    this.unsubPreTick = scene.onPreTick(() => {
      this.flushIfDue();
      damagePointsTracker.flush(resolver);
    });
  }

  /** Build the closure the tracker invokes to get a cell's live
   *  canvas-relative anchor + camera scale. */
  private makeResolver(): AnchorResolver {
    return (cellId) => {
      const worldPos = this.getCellPos(cellId);
      const localY = worldPos.y - POINTS_TOP_OFFSET;
      const parent = this.parentContainer;
      if (!parent) {
        return { x: worldPos.x, y: localY, cs: 1 };
      }
      const global = parent.toGlobal({ x: worldPos.x, y: localY });
      // `worldTransform.a` is the cumulative X scale through every
      // ancestor (mapContainer × fightContainer × ...). Same value
      // canonical Flash would use to rasterise the embedded text
      // after parent zoom propagation.
      return { x: global.x, y: global.y, cs: parent.worldTransform.a || 1 };
    };
  }

  showDamage(config: DamageDisplayConfig): void {
    let pending = this.pendingDamage.get(config.cellId);
    if (!pending) {
      pending = [];
      this.pendingDamage.set(config.cellId, pending);
    }
    pending.push(config);

    if (performance.now() - this.lastFlush > this.groupDelay) {
      this.flushPending();
    }
  }

  private flushIfDue(): void {
    if (
      this.pendingDamage.size > 0 &&
      performance.now() - this.lastFlush > this.groupDelay
    ) {
      this.flushPending();
    }
  }

  private flushPending(): void {
    this.lastFlush = performance.now();

    for (const [cellId, damages] of this.pendingDamage) {
      const combined = this.combineDamages(damages);
      combined.sort(
        (a, b) => TYPE_DISPLAY_ORDER[a.type] - TYPE_DISPLAY_ORDER[b.type]
      );
      const queue = this.getOrCreateQueue(cellId);
      const wasIdle = queue.length === 0;
      for (const damage of combined) {
        queue.push(damage);
      }
      // Canonical: `if(_aPointsList[sID].length == 1) loadPointClip`
      // — only the head plays; subsequent items wait for finishFrame.
      if (wasIdle && queue.length > 0) {
        this.spawnHead(cellId);
      }
    }

    this.pendingDamage.clear();
  }

  private getOrCreateQueue(cellId: number): DamageDisplayConfig[] {
    let q = this.cellQueues.get(cellId);
    if (!q) {
      q = [];
      this.cellQueues.set(cellId, q);
    }
    return q;
  }

  private spawnHead(cellId: number): void {
    const head = this.cellQueues.get(cellId)?.[0];
    if (!head) return;
    this.spawnPoint(head);
  }

  private advanceQueue(cellId: number): void {
    const queue = this.cellQueues.get(cellId);
    if (!queue) return;
    queue.shift();
    if (queue.length === 0) {
      this.cellQueues.delete(cellId);
      return;
    }
    this.spawnHead(cellId);
  }

  private combineDamages(
    damages: DamageDisplayConfig[]
  ): DamageDisplayConfig[] {
    const byType = new Map<string, DamageDisplayConfig>();
    for (const damage of damages) {
      const key = `${damage.type}-${damage.element ?? 0}`;
      const existing = byType.get(key);
      if (existing) {
        existing.value += damage.value;
        existing.critical = existing.critical || damage.critical;
      } else {
        byType.set(key, { ...damage });
      }
    }
    return Array.from(byType.values());
  }

  private getCellPos(cellId: number): { x: number; y: number } {
    const cell = this.cellDataMap.get(cellId);
    const level = cell?.groundLevel ?? this.groundLevel;
    const slope = cell?.groundSlope ?? 1;
    const pos = getCellPosition(cellId, this.mapWidth, level);
    return { x: pos.x, y: pos.y + getSlopeYOffset(slope) };
  }

  private spawnPoint(config: DamageDisplayConfig): void {
    const styleIdx = DEFAULT_POINT_STYLE;
    const typeIdx = TYPE_TO_CLIP_INDEX[config.type];
    const timing = STYLE_TIMING[styleIdx];
    if (!timing) {
      this.advanceQueue(config.cellId);
      return;
    }

    // Canonical sign formatting from `FightPointAnimManager.as:32-34`:
    //   var _loc7_ = (!_loc5_ ? " " : "+") + String(nValue);
    // Positives prefixed with "+", negatives prefixed with " " (a
    // literal SPACE — the minus sign is already in `String(nValue)`,
    // and the leading space exists so positive and negative widths
    // align in the centred autoSize textfield).
    let signed: number;
    if (config.type === DamageType.DAMAGE) {
      signed = -Math.abs(config.value);
    } else if (config.type === DamageType.HEAL) {
      signed = Math.abs(config.value);
    } else {
      // AP / MP / SHIELD respect the sign the caller passed.
      signed = config.value;
    }
    const text =
      signed > 0 ? `+${signed}` : signed < 0 ? ` ${signed}` : "0";

    const id = nextDamagePointId++;
    this.liveIds.add(id);

    addDamagePoint({
      id,
      cellId: config.cellId,
      text,
      styleIdx,
      typeIdx,
      totalFrames: timing.totalFrames,
      finishFrame: timing.finishFrame,
      fps: POINT_FPS,
      onFinishFrame: () => this.advanceQueue(config.cellId),
      onComplete: () => {
        this.liveIds.delete(id);
      },
    });
  }

  setMapDimensions(width: number, groundLevel?: number): void {
    this.mapWidth = width;
    if (groundLevel !== undefined) {
      this.groundLevel = groundLevel;
    }
  }

  /** Legacy hook — kept for `fight-ui.updateFightOffset` API compat.
   *  The DOM-rendered points track the camera by walking the parent
   *  Pixi container's worldTransform per tick, so explicit offset /
   *  scale setters are no-ops. */
  setOffset(_x: number, _y: number): void {}
  setScale(_scale: number): void {}
  onResize(_event: { zoom: number }): void {}

  /** Returns null under the DOM renderer — kept for API compat. */
  getContainer(): Container | null {
    return null;
  }

  clear(): void {
    for (const id of this.liveIds) {
      removeDamagePoint(id);
    }
    this.liveIds.clear();
    this.cellQueues.clear();
    this.pendingDamage.clear();
    clearDamagePoints();
    damagePointsTracker.clear();
  }

  destroy(): void {
    this.unsubPreTick();
    this.clear();
  }
}

/** Re-exported for tests / dev tools that want to peek at the store
 *  without importing the hud module directly. */
export { damagePointsStore };
