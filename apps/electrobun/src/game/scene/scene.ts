import type { Actor, ActorId } from "./actor";
import {
  Cap,
  type CapDef,
  capByBrand,
  type Rendered,
  type Tickable,
} from "./capabilities";

const EMPTY: ReadonlySet<never> = new Set();

export class Scene {
  private readonly actors = new Map<ActorId, Actor>();
  private readonly buckets = new Map<symbol, Set<Actor>>();
  private readonly tickListeners = new Set<(dt: number) => void>();
  private readonly preTickListeners = new Set<(dt: number) => void>();

  add(a: Actor): void {
    if (this.actors.has(a.id)) {
      throw new Error(`Scene: actor id ${a.id} already present`);
    }

    this.actors.set(a.id, a);

    for (const sym of Object.getOwnPropertySymbols(a)) {
      if (!capByBrand.has(sym)) {
        continue;
      }

      this.bucket(sym).add(a);
    }
  }

  remove(id: ActorId): void {
    const a = this.actors.get(id);

    if (!a) {
      return;
    }

    for (const sym of Object.getOwnPropertySymbols(a)) {
      const b = this.buckets.get(sym);

      if (b) {
        b.delete(a);
      }
    }

    this.actors.delete(id);

    try {
      a.dispose();
    } catch (err) {
      console.error(`[Scene] dispose failed for actor ${id}`, err);
    }
  }

  has(id: ActorId): boolean {
    return this.actors.has(id);
  }

  get(id: ActorId): Actor | undefined {
    return this.actors.get(id);
  }

  query<T>(cap: CapDef<T>): ReadonlySet<Actor & T> {
    return (this.buckets.get(cap.token) ?? EMPTY) as ReadonlySet<Actor & T>;
  }

  grantCapability<T>(a: Actor, cap: CapDef<T>): void {
    if (!this.actors.has(a.id)) {
      throw new Error(`Scene: cannot grant on unregistered actor ${a.id}`);
    }

    (a as unknown as Record<symbol, true>)[cap.token] = true;
    this.bucket(cap.token).add(a);
  }

  revokeCapability<T>(a: Actor, cap: CapDef<T>): void {
    const b = this.buckets.get(cap.token);

    if (b) {
      b.delete(a);
    }

    delete (a as unknown as Record<symbol, true>)[cap.token];
  }

  onPreTick(fn: (dt: number) => void): () => void {
    this.preTickListeners.add(fn);
    return () => this.preTickListeners.delete(fn);
  }

  onPostTick(fn: (dt: number) => void): () => void {
    this.tickListeners.add(fn);
    return () => this.tickListeners.delete(fn);
  }

  tick(dt: number): void {
    for (const fn of this.preTickListeners) {
      fn(dt);
    }

    const tickable = this.query(Cap.Tickable);

    if (tickable.size > 0) {
      const snapshot = Array.from(tickable) as (Actor & Tickable)[];

      for (const a of snapshot) {
        if (!this.actors.has(a.id)) {
          continue;
        }

        a.update(dt);
      }
    }

    for (const fn of this.tickListeners) {
      fn(dt);
    }
  }

  queryRendered(): ReadonlySet<Actor & Rendered> {
    return this.query(Cap.Rendered);
  }

  /**
   * All Rendered actors sorted by zIndex ascending.
   *
   * Drives deterministic draw-order consumers (debug dumps, future
   * scene-managed PIXI tree). Allocates per call — not for per-frame use.
   * Stable sort preserves insertion order across equal zIndex values.
   */
  queryRenderedSorted(): (Actor & Rendered)[] {
    const snapshot = Array.from(this.query(Cap.Rendered));
    snapshot.sort((a, b) => a.zIndex - b.zIndex);
    return snapshot;
  }

  /**
   * One-line summary of each Rendered actor for debug UIs / logs.
   * Example: "#7 GridOverlay z=5000 container=grid-overlay"
   */
  renderSnapshot(): string[] {
    return this.queryRenderedSorted().map((a) => {
      const container = a.container;
      const label =
        typeof container.label === "string" && container.label.length > 0
          ? container.label
          : container.constructor.name;
      return `#${a.id} ${a.constructor.name} z=${a.zIndex} container=${label}`;
    });
  }

  clear(): void {
    const ids = Array.from(this.actors.keys());

    for (const id of ids) {
      this.remove(id);
    }
  }

  get size(): number {
    return this.actors.size;
  }

  bucketSize(cap: CapDef<unknown>): number {
    return this.buckets.get(cap.token)?.size ?? 0;
  }

  private bucket(token: symbol): Set<Actor> {
    let b = this.buckets.get(token);

    if (!b) {
      b = new Set();
      this.buckets.set(token, b);
    }

    return b;
  }
}
