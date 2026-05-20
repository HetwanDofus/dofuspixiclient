import {
  ColorMatrixFilter,
  type Container,
  type FederatedPointerEvent,
} from "pixi.js";

import type { PickingSystem } from "@/game/render/picking-system";
import type { PickResult } from "@/game/types/picking";
import {
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  ZOOM_LEVELS,
} from "@/game/constants/battlefield";

export interface InteractionHandlerConfig {
  mapContainer: Container;
  pickingSystem: PickingSystem;
  canvas: HTMLCanvasElement;
  onZoomChange?: (zoom: number, index: number) => void;
  onPan?: (dx: number, dy: number) => void;
  onObjectClick?: (result: PickResult) => void;
  onObjectHover?: (result: PickResult | null) => void;
  onGroundClick?: (mapX: number, mapY: number) => void;
  onGroundHover?: (mapX: number, mapY: number) => void;
}

export class InteractionHandler {
  private mapContainer: Container;
  private pickingSystem: PickingSystem;
  private canvas: HTMLCanvasElement;

  private isDragging = false;
  private dragDistance = 0;
  private pointerDownPos = { x: 0, y: 0 };
  private lastPointerPos = { x: 0, y: 0 };

  private baseZoom = 1;
  private currentZoom = 1;
  private currentZoomIndex = 0;

  private hoveredObject: PickResult | null = null;
  private _enabled = true;
  private lastScreenX = -1;
  private lastScreenY = -1;
  private mouseInCanvas = false;

  /**
   * Shared hover-tint filter — allocated ONCE per InteractionHandler
   * instance and reused across every hover change. Critical: do NOT
   * `new ColorMatrixFilter()` per hover. Each `Filter` holds a GPU
   * shader module + uniform buffer + bind group; on this project's
   * patched wgpu28 build (per `feedback_pixi_wgpu_texture_lifetime`)
   * those resources don't release through JS GC. Allocating one per
   * pointermove (hover throttle is the cell, but cells switch fast
   * during gameplay) leaks dozens-to-hundreds of GPU pipelines per
   * minute → after 15 seconds of normal mouse movement the GPU has
   * accumulated enough pipeline objects to trip the macOS WindowServer
   * watchdog (observed crash signature 2026-05-06: HUD reported only
   * 3 instrumented Vello textures alive — the leak was entirely in
   * Pixi-side filter pipelines, not in tracked textures).
   *
   * Matrix is the canonical Dofus 1.29 hover tint: per-channel `0.6 *
   * input + 0.4` (`Color.setTransform({ra:60, rb:102, ...})`).
   */
  private readonly hoverTint: ColorMatrixFilter = (() => {
    const f = new ColorMatrixFilter();
    f.matrix = [
      0.6, 0, 0, 0, 0.4, 0, 0.6, 0, 0, 0.4, 0, 0, 0.6, 0, 0.4, 0, 0, 0, 1, 0,
    ];
    f.resolution = 1;
    return f;
  })();

  private onZoomChange?: (zoom: number, index: number) => void;
  private onPan?: (dx: number, dy: number) => void;
  private onObjectClick?: (result: PickResult) => void;
  private onObjectHover?: (result: PickResult | null) => void;
  private onGroundClick?: (mapX: number, mapY: number) => void;
  private onGroundHover?: (mapX: number, mapY: number) => void;

  /** Bound canvas-event handlers so `destroy()` can actually remove
   *  them. Inline arrow registrations cannot be paired with
   *  `removeEventListener` (different function identity per call), so
   *  the prior wheel-only cleanup was a no-op that leaked one
   *  handler-bound `InteractionHandler` closure per construction. */
  private readonly boundOnWheel = (e: WheelEvent): void => this.handleWheel(e);
  private readonly boundOnPointerEnter = (): void => {
    this.mouseInCanvas = true;
  };
  private readonly boundOnPointerLeave = (): void => {
    this.mouseInCanvas = false;
    this.updateHover(null);
  };

  /** Pixi stage-event bound handlers. Initialised lazily by
   *  `attachToStage` so the call site doesn't need to know the
   *  handler shapes. `detachFromStage` pairs cleanup. */
  private readonly boundOnStagePointerDown = (e: FederatedPointerEvent): void =>
    this.handlePointerDown(e);
  private readonly boundOnStagePointerMove = (e: FederatedPointerEvent): void =>
    this.handlePointerMove(e);
  private readonly boundOnStagePointerUp = (): void => this.handlePointerUp();
  private attachedStage: Container | null = null;

  constructor(config: InteractionHandlerConfig) {
    this.mapContainer = config.mapContainer;
    this.pickingSystem = config.pickingSystem;
    this.canvas = config.canvas;
    this.onZoomChange = config.onZoomChange;
    this.onPan = config.onPan;
    this.onObjectClick = config.onObjectClick;
    this.onObjectHover = config.onObjectHover;
    this.onGroundClick = config.onGroundClick;
    this.onGroundHover = config.onGroundHover;
  }

  init(): void {
    this.canvas.addEventListener("wheel", this.boundOnWheel);
    this.canvas.addEventListener("pointerenter", this.boundOnPointerEnter);
    this.canvas.addEventListener("pointerleave", this.boundOnPointerLeave);
  }

  /** Bind pointer-down/move/up to the Pixi stage. Symmetric with
   *  `detachFromStage` — both safe to call multiple times. */
  attachToStage(stage: Container): void {
    if (this.attachedStage === stage) return;
    if (this.attachedStage) this.detachFromStage();
    stage.on("pointerdown", this.boundOnStagePointerDown);
    stage.on("pointermove", this.boundOnStagePointerMove);
    stage.on("pointerup", this.boundOnStagePointerUp);
    stage.on("pointerupoutside", this.boundOnStagePointerUp);
    this.attachedStage = stage;
  }

  detachFromStage(): void {
    if (!this.attachedStage) return;
    const stage = this.attachedStage;
    stage.off("pointerdown", this.boundOnStagePointerDown);
    stage.off("pointermove", this.boundOnStagePointerMove);
    stage.off("pointerup", this.boundOnStagePointerUp);
    stage.off("pointerupoutside", this.boundOnStagePointerUp);
    this.attachedStage = null;
  }

  setBaseZoom(zoom: number): void {
    this.baseZoom = zoom;
    this.currentZoom = this.baseZoom * ZOOM_LEVELS[this.currentZoomIndex];
    this.mapContainer.scale.set(this.currentZoom);
    this.clampCameraToBounds();
  }

  getZoom(): number {
    return this.currentZoom;
  }

  getZoomIndex(): number {
    return this.currentZoomIndex;
  }

  getBaseZoom(): number {
    return this.baseZoom;
  }

  handlePointerDown(e: FederatedPointerEvent): void {
    const pickResult = this.pickingSystem.pick(
      e.global.x,
      e.global.y,
      this.mapContainer,
      true
    );

    if (pickResult) {
      this.onObjectClick?.(pickResult);
      return;
    }

    this.isDragging = true;
    this.dragDistance = 0;
    this.pointerDownPos = { x: e.global.x, y: e.global.y };
    this.lastPointerPos = { x: e.global.x, y: e.global.y };
  }

  handlePointerMove(e: FederatedPointerEvent): void {
    this.lastScreenX = e.global.x;
    this.lastScreenY = e.global.y;

    if (!this.isDragging) {
      const pickResult = this.pickingSystem.pick(
        e.global.x,
        e.global.y,
        this.mapContainer,
        false
      );
      this.updateHover(pickResult);
      // Always resolve the map-local point too; the hover preview
      // (movement path / AoE overlay) wants to know which cell the
      // cursor is on even when a sprite is the primary hover target.
      if (this.onGroundHover) {
        const zoom = this.mapContainer.scale.x || 1;
        const mapX = (e.global.x - this.mapContainer.x) / zoom;
        const mapY = (e.global.y - this.mapContainer.y) / zoom;
        this.onGroundHover(mapX, mapY);
      }
      return;
    }

    const dx = e.global.x - this.lastPointerPos.x;
    const dy = e.global.y - this.lastPointerPos.y;

    this.dragDistance += Math.abs(dx) + Math.abs(dy);

    this.mapContainer.x += dx;
    this.mapContainer.y += dy;

    this.lastPointerPos = { x: e.global.x, y: e.global.y };
    this.clampCameraToBounds();
    this.pickingSystem.markDirty();

    this.onPan?.(dx, dy);
  }

  handlePointerUp(): void {
    if (this.isDragging && this.dragDistance < 5) {
      // Click detected (not a drag) — convert to map-local coordinates
      const zoom = this.mapContainer.scale.x || 1;
      const mapX = (this.pointerDownPos.x - this.mapContainer.x) / zoom;
      const mapY = (this.pointerDownPos.y - this.mapContainer.y) / zoom;
      this.onGroundClick?.(mapX, mapY);
    }

    this.isDragging = false;
  }

  set enabled(value: boolean) {
    this._enabled = value;
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();

    if (!this._enabled) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const direction = e.deltaY < 0 ? 1 : -1;
    this.stepZoom(direction, mouseX, mouseY);
  }

  private stepZoom(
    direction: number,
    anchorX?: number,
    anchorY?: number
  ): void {
    const newIndex = Math.max(
      0,
      Math.min(ZOOM_LEVELS.length - 1, this.currentZoomIndex + direction)
    );

    if (newIndex === this.currentZoomIndex) {
      return;
    }

    this.currentZoomIndex = newIndex;
    this.pickingSystem.markDirty();

    const newMultiplier = ZOOM_LEVELS[newIndex];
    this.setZoom(newMultiplier, anchorX, anchorY);

    this.onZoomChange?.(this.currentZoom, this.currentZoomIndex);
  }

  setZoom(multiplier: number, anchorX?: number, anchorY?: number): void {
    const targetZoom = this.baseZoom * multiplier;

    if (targetZoom === this.currentZoom) {
      return;
    }

    const oldZoom = this.currentZoom || this.baseZoom;
    const hasAnchor = anchorX !== undefined && anchorY !== undefined;

    let localX = 0;
    let localY = 0;
    let screenX = 0;
    let screenY = 0;

    if (anchorX !== undefined && anchorY !== undefined) {
      screenX = anchorX;
      screenY = anchorY;
      localX = (screenX - this.mapContainer.x) / oldZoom;
      localY = (screenY - this.mapContainer.y) / oldZoom;
    }

    this.currentZoom = targetZoom;
    this.mapContainer.scale.set(this.currentZoom);

    if (hasAnchor) {
      this.mapContainer.x = screenX - localX * this.currentZoom;
      this.mapContainer.y = screenY - localY * this.currentZoom;
    }

    this.clampCameraToBounds();
  }

  setZoomIndex(index: number): void {
    if (index < 0 || index >= ZOOM_LEVELS.length) {
      return;
    }

    this.currentZoomIndex = index;
    this.currentZoom = this.baseZoom * ZOOM_LEVELS[this.currentZoomIndex];
    this.mapContainer.scale.set(this.currentZoom);
    this.clampCameraToBounds();
  }

  setMapContainer(container: Container): void {
    this.mapContainer = container;
    this.mapContainer.scale.set(this.currentZoom);
  }

  private clampCameraToBounds(): void {
    const viewportWidth = this.canvas.clientWidth;
    const viewportHeight = this.canvas.clientHeight;
    const zoom = this.mapContainer.scale.x || 1;

    const mapWidth = DISPLAY_WIDTH * zoom;
    const mapHeight = DISPLAY_HEIGHT * zoom;

    let x = this.mapContainer.x;
    let y = this.mapContainer.y;

    const minX = Math.min(0, viewportWidth - mapWidth);
    const maxX = 0;

    if (x < minX) {
      x = minX;
    } else if (x > maxX) {
      x = maxX;
    }

    const minY = Math.min(0, viewportHeight - mapHeight);
    const maxY = 0;

    if (y < minY) {
      y = minY;
    } else if (y > maxY) {
      y = maxY;
    }

    this.mapContainer.x = x;
    this.mapContainer.y = y;
  }

  /**
   * Called every frame to re-evaluate hover at the last mouse position.
   * Detects actors passing under a static mouse without requiring mouse movement.
   */
  tick(): void {
    if (!this.mouseInCanvas || this.isDragging || this.lastScreenX < 0) {
      return;
    }

    const pickResult = this.pickingSystem.pick(
      this.lastScreenX,
      this.lastScreenY,
      this.mapContainer,
      false
    );
    this.updateHover(pickResult);
  }

  private updateHover(pickResult: PickResult | null): void {
    const prevHovered = this.hoveredObject;
    this.hoveredObject = pickResult;

    if (prevHovered?.object.id !== pickResult?.object.id) {
      if (prevHovered) {
        prevHovered.object.sprite.filters = null;
      }

      if (pickResult) {
        // Reuse the singleton hover filter (see `hoverTint` field
        // declaration). Allocating per-hover leaks GPU pipelines on
        // this project's wgpu28 build — that was the leak that killed
        // the host after 15-30 seconds of normal mouse movement, even
        // though the watchdog HUD reported clean Vello-texture state.
        pickResult.object.sprite.filters = [this.hoverTint];
      }

      this.canvas.style.cursor = pickResult ? "pointer" : "default";
      this.onObjectHover?.(pickResult);
    }
  }

  getHoveredObject(): PickResult | null {
    return this.hoveredObject;
  }

  destroy(): void {
    this.canvas.removeEventListener("wheel", this.boundOnWheel);
    this.canvas.removeEventListener("pointerenter", this.boundOnPointerEnter);
    this.canvas.removeEventListener("pointerleave", this.boundOnPointerLeave);
    this.detachFromStage();
  }
}
