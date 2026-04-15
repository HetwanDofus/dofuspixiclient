import { describe, expect, it } from "bun:test";

import { Container } from "pixi.js";

import { Cap } from "../capabilities";
import { Scene } from "../scene";
import { PlayerActor, type PlayerActorState } from "./actor";

function fakeActive(opts?: {
  container?: Container;
  cellId?: number;
}): PlayerActorState {
  return {
    container: opts?.container ?? new Container(),
    cellId: opts?.cellId ?? 0,
  };
}

function makeActor(playerId: number, active: PlayerActorState): PlayerActor {
  return new PlayerActor(
    playerId,
    active,
    () => {},
    () => {}
  );
}

describe("PlayerActor capability contract", () => {
  it("lives in Rendered, Positioned, Hoverable, and Tickable buckets at once", () => {
    const scene = new Scene();
    const active = fakeActive({ cellId: 42 });
    const actor = makeActor(7, active);
    scene.add(actor);

    expect(scene.query(Cap.Rendered).has(actor)).toBe(true);
    expect(scene.query(Cap.Positioned).has(actor)).toBe(true);
    expect(scene.query(Cap.Hoverable).has(actor)).toBe(true);
    expect(scene.query(Cap.Tickable).has(actor)).toBe(true);
  });

  it("container accessor reads through to the live ActivePlayer record", () => {
    const container = new Container();
    const actor = makeActor(1, fakeActive({ container }));
    expect(actor.container).toBe(container);
  });

  it("cellId get/set mutates the ActivePlayer (no drift)", () => {
    const active = fakeActive({ cellId: 10 });
    const actor = makeActor(1, active);

    expect(actor.cellId).toBe(10);
    actor.cellId = 50;
    expect(active.cellId).toBe(50);
    expect(actor.cellId).toBe(50);
  });

  it("x/y accessors read/write the PIXI container directly", () => {
    const container = new Container();
    container.x = 100;
    container.y = 200;
    const actor = makeActor(1, fakeActive({ container }));

    expect(actor.x).toBe(100);
    expect(actor.y).toBe(200);

    actor.x = 500;
    actor.y = 600;
    expect(container.x).toBe(500);
    expect(container.y).toBe(600);
  });

  it("pickableId equals the player's network id", () => {
    const actor = makeActor(9001, fakeActive());
    expect(actor.pickableId).toBe(9001);
  });

  it("zIndex accessor reads/writes the container", () => {
    const container = new Container();
    container.zIndex = 5;
    const actor = makeActor(1, fakeActive({ container }));
    expect(actor.zIndex).toBe(5);

    actor.zIndex = 999;
    expect(container.zIndex).toBe(999);
  });

  it("update and dispose callbacks fire exactly once per invocation", () => {
    let tickCount = 0;
    let disposeCount = 0;
    const actor = new PlayerActor(
      1,
      fakeActive(),
      () => {
        tickCount++;
      },
      () => {
        disposeCount++;
      }
    );

    actor.update(0.016);
    actor.update(0.016);
    actor.dispose();

    expect(tickCount).toBe(2);
    expect(disposeCount).toBe(1);
  });
});
