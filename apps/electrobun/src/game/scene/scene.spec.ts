import { describe, expect, it, mock } from "bun:test";

import { Actor, type ActorId, freshActorId } from "./actor";
import { Cap, TICKABLE, type Tickable } from "./capabilities";
import { Scene } from "./scene";

class NullActor extends Actor {
  readonly id: ActorId = freshActorId();
  readonly disposed = mock(() => {});
  dispose(): void {
    this.disposed();
  }
}

class TickerActor extends Actor implements Tickable {
  readonly id: ActorId = freshActorId();
  readonly [TICKABLE] = true as const;
  readonly ticks: number[] = [];

  update(dt: number): void {
    this.ticks.push(dt);
  }

  dispose(): void {}
}

describe("Scene", () => {
  it("add + has + get round-trip", () => {
    const s = new Scene();
    const a = new NullActor();

    expect(s.has(a.id)).toBe(false);
    s.add(a);
    expect(s.has(a.id)).toBe(true);
    expect(s.get(a.id)).toBe(a);
    expect(s.size).toBe(1);
  });

  it("rejects duplicate actor ids", () => {
    const s = new Scene();
    const a = new NullActor();
    s.add(a);
    expect(() => s.add(a)).toThrow();
  });

  it("remove disposes the actor exactly once", () => {
    const s = new Scene();
    const a = new NullActor();
    s.add(a);

    s.remove(a.id);
    expect(a.disposed).toHaveBeenCalledTimes(1);
    expect(s.has(a.id)).toBe(false);
  });

  it("remove on a missing id is a no-op", () => {
    const s = new Scene();
    expect(() => s.remove(99999)).not.toThrow();
  });

  it("tick drives only Tickable actors", () => {
    const s = new Scene();
    const null1 = new NullActor();
    const tick1 = new TickerActor();
    const tick2 = new TickerActor();
    s.add(null1);
    s.add(tick1);
    s.add(tick2);

    s.tick(0.016);
    s.tick(0.032);

    expect(tick1.ticks).toEqual([0.016, 0.032]);
    expect(tick2.ticks).toEqual([0.016, 0.032]);
  });

  it("query returns only actors with the matching capability", () => {
    const s = new Scene();
    const null1 = new NullActor();
    const tick1 = new TickerActor();
    s.add(null1);
    s.add(tick1);

    const tickables = s.query(Cap.Tickable);
    expect(tickables.size).toBe(1);
    expect(tickables.has(tick1)).toBe(true);
  });

  it("pre/post tick hooks fire in order around the tick", () => {
    const s = new Scene();
    const tick1 = new TickerActor();
    s.add(tick1);

    const sequence: string[] = [];
    s.onPreTick(() => sequence.push("pre"));
    s.onPostTick(() => sequence.push("post"));

    s.tick(1);

    expect(sequence).toEqual(["pre", "post"]);
    expect(tick1.ticks).toEqual([1]);
  });

  it("clear disposes every actor", () => {
    const s = new Scene();
    const actors = [new NullActor(), new NullActor(), new NullActor()];

    for (const a of actors) {
      s.add(a);
    }

    s.clear();

    expect(s.size).toBe(0);

    for (const a of actors) {
      expect(a.disposed).toHaveBeenCalledTimes(1);
    }
  });

  it("grantCapability adds to the bucket query", () => {
    const s = new Scene();
    const a = new NullActor();
    s.add(a);

    expect(s.bucketSize(Cap.Tickable)).toBe(0);
    s.grantCapability(a, Cap.Tickable);
    expect(s.bucketSize(Cap.Tickable)).toBe(1);

    s.revokeCapability(a, Cap.Tickable);
    expect(s.bucketSize(Cap.Tickable)).toBe(0);
  });
});
