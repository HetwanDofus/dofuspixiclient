import type { Container } from "pixi.js";

import {
  HOVERABLE,
  type Hoverable,
  POSITIONED,
  type Positioned,
  RENDERED,
  type Rendered,
  TICKABLE,
  type Tickable,
} from "@/game/scene/capabilities";

import { Actor, type ActorId, freshActorId } from "../actor";

/**
 * Minimal state PlayerActor's capability accessors read through to.
 * ActivePlayer satisfies this trivially; tests can supply a lighter stand-in.
 */
export interface PlayerActorState {
  container: Container;
  cellId: number;
}

/**
 * Scene-driven Actor wrapping a player's ActivePlayer state.
 * PlayerRenderer owns the state record + rendering internals; the actor
 * exposes the capability brands (Tickable/Rendered/Positioned/Hoverable)
 * so scene.query(...) can iterate players alongside tiles and overlays.
 */
export class PlayerActor
  extends Actor
  implements Tickable, Rendered, Positioned, Hoverable
{
  readonly id: ActorId = freshActorId();
  readonly [TICKABLE] = true as const;
  readonly [RENDERED] = true as const;
  readonly [POSITIONED] = true as const;
  readonly [HOVERABLE] = true as const;

  constructor(
    readonly playerId: number,
    private readonly active: PlayerActorState,
    private readonly tick: (dt: number) => void,
    private readonly onDispose: () => void
  ) {
    super();
  }

  get container(): Container {
    return this.active.container;
  }
  get zIndex(): number {
    return this.active.container.zIndex;
  }
  set zIndex(v: number) {
    this.active.container.zIndex = v;
  }

  get cellId(): number {
    return this.active.cellId;
  }
  set cellId(v: number) {
    this.active.cellId = v;
  }
  get x(): number {
    return this.active.container.x;
  }
  set x(v: number) {
    this.active.container.x = v;
  }
  get y(): number {
    return this.active.container.y;
  }
  set y(v: number) {
    this.active.container.y = v;
  }

  /** Fighters use their network ID as their pickable ID. */
  get pickableId(): number {
    return this.playerId;
  }

  // Hover effects are driven by PlayerRenderer through the picking system;
  // this hook exists only to satisfy the Hoverable capability contract.
  onHover(_state: boolean): void {}

  update(dt: number): void {
    this.tick(dt);
  }

  dispose(): void {
    this.onDispose();
  }
}
