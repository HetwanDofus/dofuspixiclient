import { component, field } from "@lastolivegames/becsy";

/**
 * Callback-based resize — each entity handles its own resize logic.
 */
export interface ResizeEvent {
  zoom: number;
  baseZoom: number;
  screenWidth: number;
  screenHeight: number;
}

@component
export class Resizable {
  @field.object declare onResize: ((event: ResizeEvent) => void) | null;
}
