import type { Container } from "pixi.js";
import { component, field } from "@lastolivegames/becsy";

import type { CellData } from "@/ank/battlefield/datacenter/cell";

export interface NetworkCommand {
  type: number;
  payload: unknown;
  timestamp: number;
}

@component
export class NetworkCommandQueue {
  @field.object declare commands: NetworkCommand[];
}

@component
export class MapContext {
  @field.uint32 declare mapId: number;
  @field.uint8 declare mapWidth: number;
  @field.uint8 declare mapHeight: number;
  @field.object declare cellDataMap: Map<number, CellData>;
}

@component
export class PlayerContext {
  @field.uint32 declare characterId: number;
  @field.uint16 declare currentCellId: number;
  @field.boolean declare isMoving: boolean;
}

export interface FrameTimeData {
  deltaMs: number;
  totalMs: number;
}

@component
export class FrameTime {
  @field.object declare data: FrameTimeData;
}

@component
export class RenderContext {
  @field.object declare actorsContainer: Container;
  @field.object declare combatContainer: Container | null;
}

@component
export class ResizeContext {
  @field.float64 declare zoom: number;
  @field.float64 declare baseZoom: number;
  @field.float64 declare screenWidth: number;
  @field.float64 declare screenHeight: number;
  @field.boolean declare dirty: boolean;
}

@component
export class InteractionEvent {
  @field.int32 declare hoveredPickableId: number;
  @field.int32 declare clickedPickableId: number;
  @field.boolean declare dirty: boolean;
}
