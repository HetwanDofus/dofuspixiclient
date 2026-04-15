import { describe, expect, it } from "bun:test";

import { Container, Sprite } from "pixi.js";

import { Actor, type ActorId, freshActorId } from "./actor";
import { RENDERED, type Rendered } from "./capabilities";
import { Scene } from "./scene";

class FakeRendered extends Actor implements Rendered {
  readonly id: ActorId = freshActorId();
  readonly [RENDERED] = true as const;
  readonly container: Container;
  readonly zIndex: number;

  constructor(zIndex: number, label?: string) {
    super();
    this.container = new Container();

    if (label) {
      this.container.label = label;
    }

    this.zIndex = zIndex;
  }

  dispose(): void {
    if (!this.container.destroyed) {
      this.container.destroy();
    }
  }
}

describe("Scene.queryRenderedSorted", () => {
  it("returns actors ordered by zIndex ascending", () => {
    const scene = new Scene();
    const top = new FakeRendered(10000, "debug");
    const mid = new FakeRendered(5000, "grid");
    const bot = new FakeRendered(100, "tile");

    scene.add(top);
    scene.add(bot);
    scene.add(mid);

    const sorted = scene.queryRenderedSorted();
    expect(sorted.map((a) => a.zIndex)).toEqual([100, 5000, 10000]);
  });

  it("is stable — ties preserve insertion order", () => {
    const scene = new Scene();
    const first = new FakeRendered(500, "first");
    const second = new FakeRendered(500, "second");
    const third = new FakeRendered(500, "third");

    scene.add(first);
    scene.add(second);
    scene.add(third);

    const sorted = scene.queryRenderedSorted();
    expect(sorted).toEqual([first, second, third]);
  });

  it("returns an empty array when no Rendered actors are registered", () => {
    const scene = new Scene();
    expect(scene.queryRenderedSorted()).toEqual([]);
  });

  it("snapshot is independent — mutating it does not affect the scene", () => {
    const scene = new Scene();
    const a = new FakeRendered(1);
    scene.add(a);

    const snapshot = scene.queryRenderedSorted();
    snapshot.length = 0;

    expect(scene.queryRenderedSorted()).toHaveLength(1);
  });
});

describe("Scene.renderSnapshot", () => {
  it("formats one line per Rendered actor, z-sorted, with container label", () => {
    const scene = new Scene();
    const grid = new FakeRendered(5000, "grid-overlay");
    const debug = new FakeRendered(10000, "debug-overlay");

    scene.add(debug);
    scene.add(grid);

    const lines = scene.renderSnapshot();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("z=5000");
    expect(lines[0]).toContain("container=grid-overlay");
    expect(lines[1]).toContain("z=10000");
    expect(lines[1]).toContain("container=debug-overlay");
  });

  it("falls back to the constructor name when container has no label", () => {
    const scene = new Scene();
    class TileActorStub extends Actor implements Rendered {
      readonly id: ActorId = freshActorId();
      readonly [RENDERED] = true as const;
      readonly container = new Sprite();
      readonly zIndex = 42;
      dispose(): void {
        if (!this.container.destroyed) {
          this.container.destroy();
        }
      }
    }

    const stub = new TileActorStub();
    scene.add(stub);

    const [line] = scene.renderSnapshot();
    expect(line).toContain("TileActorStub");
    // Sprite without label uses the container's constructor name
    expect(line).toContain("container=Sprite");
  });
});
