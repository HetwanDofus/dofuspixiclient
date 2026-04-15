import {
  Container,
  type FederatedPointerEvent,
  Graphics,
  type Sprite,
  Text,
} from "pixi.js";

import type { CellData } from "@/game/datacenter/cell";
import type { ExtendedTexture } from "@/game/types";
import {
  CELL_HALF_HEIGHT,
  CELL_HALF_WIDTH,
} from "@/game/constants/battlefield";
import { Z_DEBUG_OVERLAY } from "@/game/constants/z-index";
import { getCellPosition } from "@/game/datacenter/cell";
import { computeMapScale, type MapScale } from "@/game/datacenter/map";

import { Actor, type ActorId, freshActorId } from "../actor";
import { RENDERED, type Rendered } from "../capabilities";

export interface SpriteDebugInfo {
  sprite: Sprite;
  tileId: number;
  cellId: number;
  layer: number; // 0=ground, 1=object1, 2=object2
  type: "ground" | "objects";
  rotation: number;
  flip: boolean;
  groundSlope?: number;
}

export class DebugOverlay extends Actor implements Rendered {
  readonly id: ActorId = freshActorId();
  readonly [RENDERED] = true as const;
  readonly container: Container;
  readonly zIndex = Z_DEBUG_OVERLAY;

  private tooltip: Container;
  private tooltipBg: Graphics;
  private tooltipText: Text;
  private spritesByCellId = new Map<number, SpriteDebugInfo[]>();
  private enabled = false;
  private screenWidth = 1484;
  private screenHeight = 1114;
  private currentCellId = -1;

  // Cell picking data
  private mapContainer: Container | null = null;
  private cells: CellData[] = [];
  private mapWidth = 15;
  private mapScale: MapScale = { scale: 1, offsetX: 0, offsetY: 0 };
  private boundOnPointerMove: ((e: FederatedPointerEvent) => void) | null =
    null;
  private boundOnPointerLeave: (() => void) | null = null;

  constructor(parentContainer: Container) {
    super();
    this.container = new Container();
    this.container.label = "debug-overlay";
    this.container.zIndex = Z_DEBUG_OVERLAY;
    parentContainer.addChild(this.container);

    // Create tooltip
    this.tooltip = new Container();
    this.tooltip.visible = false;

    this.tooltipBg = new Graphics();
    this.tooltip.addChild(this.tooltipBg);

    this.tooltipText = new Text({
      text: "",
      style: {
        fontFamily: "monospace",
        fontSize: 12,
        fill: 0xffffff,
        wordWrap: false,
      },
    });
    this.tooltipText.x = 8;
    this.tooltipText.y = 6;
    this.tooltip.addChild(this.tooltipText);

    this.container.addChild(this.tooltip);
  }

  setMapContainer(mapContainer: Container): void {
    this.mapContainer = mapContainer;
  }

  setMapData(cells: CellData[], mapWidth: number, mapHeight: number): void {
    this.cells = cells;
    this.mapWidth = mapWidth;
    this.mapScale = computeMapScale(mapWidth, mapHeight);
  }

  registerSprite(info: SpriteDebugInfo): void {
    let arr = this.spritesByCellId.get(info.cellId);

    if (!arr) {
      arr = [];
      this.spritesByCellId.set(info.cellId, arr);
    }

    arr.push(info);
  }

  clear(): void {
    this.spritesByCellId.clear();
    this.currentCellId = -1;
    this.hideTooltip();
  }

  enable(): void {
    this.enabled = true;
    this.container.visible = true;
    this.attachEvents();
  }

  disable(): void {
    this.enabled = false;
    this.container.visible = false;
    this.hideTooltip();
    this.detachEvents();
  }

  toggle(): boolean {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }

    return this.enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private attachEvents(): void {
    if (!this.mapContainer || this.boundOnPointerMove) {
      return;
    }

    this.mapContainer.eventMode = "static";
    this.boundOnPointerMove = (e: FederatedPointerEvent) =>
      this.onPointerMove(e);
    this.boundOnPointerLeave = () => this.hideTooltip();
    this.mapContainer.on("pointermove", this.boundOnPointerMove);
    this.mapContainer.on("pointerleave", this.boundOnPointerLeave);
  }

  private detachEvents(): void {
    if (!this.mapContainer) {
      return;
    }

    if (this.boundOnPointerMove) {
      this.mapContainer.off("pointermove", this.boundOnPointerMove);
      this.boundOnPointerMove = null;
    }

    if (this.boundOnPointerLeave) {
      this.mapContainer.off("pointerleave", this.boundOnPointerLeave);
      this.boundOnPointerLeave = null;
    }
  }

  private onPointerMove(e: FederatedPointerEvent): void {
    if (!this.enabled) {
      return;
    }

    // Convert global position to map-local position
    const local = this.mapContainer
      ? this.mapContainer.toLocal(e.global)
      : e.global;

    const cell = this.findCellAt(local.x, local.y);

    if (!cell) {
      this.hideTooltip();
      this.currentCellId = -1;
      return;
    }

    // Only rebuild tooltip when cell changes
    if (cell.id !== this.currentCellId) {
      this.currentCellId = cell.id;
      this.buildTooltip(cell);
    }

    // Always update position
    const padding = 8;
    const width = this.tooltipText.width + padding * 2;
    const height = this.tooltipText.height + padding * 2;
    this.positionTooltipAtMouse(e.global.x, e.global.y, width, height);
    this.tooltip.visible = true;
  }

  private findCellAt(mapX: number, mapY: number): CellData | null {
    const { scale, offsetX, offsetY } = this.mapScale;
    const hw = CELL_HALF_WIDTH * scale;
    const hh = CELL_HALF_HEIGHT * scale;

    for (const cell of this.cells) {
      const pos = getCellPosition(cell.id, this.mapWidth, cell.groundLevel);
      const cx = pos.x * scale + offsetX;
      const cy = pos.y * scale + offsetY;

      const dx = mapX - cx;
      const dy = mapY - cy;

      if (Math.abs(dx / hw) + Math.abs(dy / hh) <= 1) {
        return cell;
      }
    }

    return null;
  }

  private buildTooltip(cell: CellData): void {
    const cellSprites = this.spritesByCellId.get(cell.id) ?? [];
    // Sort by layer: ground (0) → object1 (1) → object2 (2)
    cellSprites.sort((a, b) => a.layer - b.layer);

    const layerNames = ["ground", "object1", "object2"];
    let text = `Cell: ${cell.id}\n`;

    for (const s of cellSprites) {
      const layerName = layerNames[s.layer] ?? `layer${s.layer}`;
      const tex = s.sprite.texture as ExtendedTexture;
      const scale = tex.source.resolution ?? "?";
      const isFallback = tex._isFallback ?? false;
      const requestedScale = tex._requestedScale;

      let line = `${layerName}: ${s.type}_${s.tileId}`;

      if (s.rotation) {
        line += ` R${s.rotation}`;
      }

      if (s.flip) {
        line += " F";
      }

      if (s.groundSlope && s.groundSlope !== 1) {
        line += ` S${s.groundSlope}`;
      }

      line += ` (s:${scale})`;

      if (isFallback && requestedScale !== undefined) {
        line += ` FALLBACK(${requestedScale})`;
      }

      text += `${line}\n`;
    }

    // Show which layers are missing
    const presentLayers = new Set(cellSprites.map((s) => s.layer));

    for (let i = 0; i < 3; i++) {
      if (!presentLayers.has(i)) {
        text += `${layerNames[i]}: —\n`;
      }
    }

    this.tooltipText.text = text.trimEnd();

    // Update background
    const padding = 8;
    const width = this.tooltipText.width + padding * 2;
    const height = this.tooltipText.height + padding * 2;

    const hasFallback = cellSprites.some((s) => {
      const t = s.sprite.texture as ExtendedTexture;
      return t._isFallback ?? false;
    });

    this.tooltipBg.clear();
    this.tooltipBg.roundRect(0, 0, width, height, 4);
    this.tooltipBg.fill({
      color: hasFallback ? 0x990000 : 0x000000,
      alpha: 0.9,
    });
    this.tooltipBg.stroke({
      color: hasFallback ? 0xff0000 : 0x666666,
      width: 1,
    });
  }

  private positionTooltipAtMouse(
    mouseX: number,
    mouseY: number,
    width: number,
    height: number
  ): void {
    const margin = 15;

    let x = mouseX + margin;
    let y = mouseY - height - margin;

    if (x + width > this.screenWidth) {
      x = mouseX - width - margin;
    }

    if (x < 0) {
      x = margin;
    }

    if (y < 0) {
      y = mouseY + margin;
    }

    if (y + height > this.screenHeight) {
      y = this.screenHeight - height - margin;
    }

    this.tooltip.x = x;
    this.tooltip.y = y;
  }

  setScreenSize(width: number, height: number): void {
    this.screenWidth = width;
    this.screenHeight = height;
  }

  onResize(event: { screenWidth: number; screenHeight: number }): void {
    this.setScreenSize(event.screenWidth, event.screenHeight);
  }

  getContainer(): Container {
    return this.container;
  }

  private hideTooltip(): void {
    this.tooltip.visible = false;
    this.currentCellId = -1;
  }

  destroy(): void {
    this.dispose();
  }

  /** Scene calls this on remove(id) / clear(). Idempotent. */
  dispose(): void {
    this.detachEvents();
    this.clear();

    if (!this.container.destroyed) {
      this.container.destroy({ children: true });
    }
  }
}
