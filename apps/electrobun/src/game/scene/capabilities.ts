import type { Container } from "pixi.js";

import type { Actor } from "./actor";

export const TICKABLE = Symbol("Tickable");
export const POSITIONED = Symbol("Positioned");
export const RENDERED = Symbol("Rendered");
export const NETWORKED = Symbol("Networked");
export const HOVERABLE = Symbol("Hoverable");
export const ANIMATED = Symbol("Animated");
export const TARGETABLE = Symbol("Targetable");

export interface Tickable {
  readonly [TICKABLE]: true;
  update(dt: number): void;
}

export interface Positioned {
  readonly [POSITIONED]: true;
  cellId: number;
  x: number;
  y: number;
}

export interface Rendered {
  readonly [RENDERED]: true;
  container: Container;
  zIndex: number;
}

export interface Networked {
  readonly [NETWORKED]: true;
  networkId: number;
}

export interface Hoverable {
  readonly [HOVERABLE]: true;
  pickableId: number;
  onHover(state: boolean): void;
  onClick?(button: number): void;
}

export interface Animated {
  readonly [ANIMATED]: true;
  advanceFrame(dt: number): void;
}

export interface Targetable {
  readonly [TARGETABLE]: true;
  canBeTargeted(): boolean;
}

export interface CapDef<T> {
  readonly token: symbol;
  readonly name: string;
  readonly __phantom?: T;
}

function def<T>(token: symbol, name: string): CapDef<T> {
  return { token, name };
}

export const Cap = {
  Tickable: def<Tickable>(TICKABLE, "Tickable"),
  Positioned: def<Positioned>(POSITIONED, "Positioned"),
  Rendered: def<Rendered>(RENDERED, "Rendered"),
  Networked: def<Networked>(NETWORKED, "Networked"),
  Hoverable: def<Hoverable>(HOVERABLE, "Hoverable"),
  Animated: def<Animated>(ANIMATED, "Animated"),
  Targetable: def<Targetable>(TARGETABLE, "Targetable"),
} as const;

export const capByBrand = new Map<symbol, CapDef<unknown>>([
  [TICKABLE, Cap.Tickable as CapDef<unknown>],
  [POSITIONED, Cap.Positioned as CapDef<unknown>],
  [RENDERED, Cap.Rendered as CapDef<unknown>],
  [NETWORKED, Cap.Networked as CapDef<unknown>],
  [HOVERABLE, Cap.Hoverable as CapDef<unknown>],
  [ANIMATED, Cap.Animated as CapDef<unknown>],
  [TARGETABLE, Cap.Targetable as CapDef<unknown>],
]);

export function hasBrand<T>(a: Actor, cap: CapDef<T>): a is Actor & T {
  return cap.token in (a as unknown as Record<symbol, unknown>);
}
