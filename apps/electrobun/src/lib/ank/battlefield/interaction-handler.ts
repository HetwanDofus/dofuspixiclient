import { Container, ColorMatrixFilter } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { DISPLAY_WIDTH, DISPLAY_HEIGHT, ZOOM_LEVELS } from '@/constants/battlefield';
import type { PickingSystem } from '@/render/picking-system';
import type { PickResult } from '@/types/picking';

export interface InteractionHandlerConfig {
  mapContainer: Container;
  pickingSystem: PickingSystem;
  canvas: HTMLCanvasElement;
  onZoomChange?: (zoom: number, index: number) => void;
  onPan?: (dx: number, dy: number) => void;
  onObjectClick?: (result: PickResult) => void;
  onObjectHover?: (result: PickResult | null) => void;
}

export class InteractionHandler {
  private mapContainer: Container;
  private pickingSystem: PickingSystem;
  private canvas: HTMLCanvasElement;

  private isDragging = false;
  private lastPointerPos = { x: 0, y: 0 };

  private baseZoom = 1;
  private currentZoom = 1;
  private currentZoomIndex = 0;

  private hoveredObject: PickResult | null = null;

  private onZoomChange?: (zoom: number, index: number) => void;
  private onPan?: (dx: number, dy: number) => void;
  private onObjectClick?: (result: PickResult) => void;
  private onObjectHover?: (result: PickResult | null) => void;

  constructor(config: InteractionHandlerConfig) {
    this.mapContainer = config.mapContainer;
    this.pickingSystem = config.pickingSystem;
    this.canvas = config.canvas;
    this.onZoomChange = config.onZoomChange;
    this.onPan = config.onPan;
    this.onObjectClick = config.onObjectClick;
    this.onObjectHover = config.onObjectHover;
  }

  init(): void {
    this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
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
    this.lastPointerPos = { x: e.global.x, y: e.global.y };
  }

  handlePointerMove(e: FederatedPointerEvent): void {
    if (!this.isDragging) {
      const pickResult = this.pickingSystem.pick(
        e.global.x,
        e.global.y,
        this.mapContainer,
        false
      );

      const prevHovered = this.hoveredObject;
      this.hoveredObject = pickResult;

      if (prevHovered?.object.id !== pickResult?.object.id) {
        if (prevHovered) {
          prevHovered.object.sprite.filters = null;
        }

        if (pickResult) {
          const sprite = pickResult.object.sprite;

          // Apply ColorMatrixFilter exactly like the old MapRendererEngine
          const colorMatrix = new ColorMatrixFilter();
          colorMatrix.matrix = [
            0.6, 0, 0, 0, 0.3,
            0, 0.6, 0, 0, 0.3,
            0, 0, 0.6, 0, 0.3,
            0, 0, 0, 1, 0
          ];
          colorMatrix.resolution = window.devicePixelRatio;
          sprite.filters = [colorMatrix];
        }

        this.canvas.style.cursor = pickResult ? 'pointer' : 'default';
        this.onObjectHover?.(pickResult);
      }
      return;
    }

    const dx = e.global.x - this.lastPointerPos.x;
    const dy = e.global.y - this.lastPointerPos.y;

    this.mapContainer.x += dx;
    this.mapContainer.y += dy;

    this.lastPointerPos = { x: e.global.x, y: e.global.y };
    this.clampCameraToBounds();
    this.pickingSystem.markDirty();

    this.onPan?.(dx, dy);
  }

  handlePointerUp(): void {
    this.isDragging = false;
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();

    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const direction = e.deltaY < 0 ? 1 : -1;
    this.stepZoom(direction, mouseX, mouseY);
  }

  private stepZoom(direction: number, anchorX?: number, anchorY?: number): void {
    const newIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, this.currentZoomIndex + direction));

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

    if (hasAnchor) {
      screenX = anchorX!;
      screenY = anchorY!;
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

  getHoveredObject(): PickResult | null {
    return this.hoveredObject;
  }

  destroy(): void {
    this.canvas.removeEventListener('wheel', this.handleWheel);
  }
}
