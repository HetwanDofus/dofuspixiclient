import { describe, expect, it } from "bun:test";

import { Sprite } from "pixi.js";

import { Cap } from "../capabilities";
import { Scene } from "../scene";
import { TileActor } from "./actor";

function makeSprite(): Sprite {
  return new Sprite();
}

describe("TileActor", () => {
  it("wraps a Pixi sprite and carries Rendered + Positioned brands", () => {
    const sprite = makeSprite();
    const actor = new TileActor({
      sprite,
      tileKey: "ground_42",
      frameIndex: 0,
      isAnimated: false,
      cellId: 100,
      x: 500,
      y: 300,
      layer: 0,
    });

    expect(actor.container).toBe(sprite);
    expect(actor.tileKey).toBe("ground_42");
    expect(actor.cellId).toBe(100);
    expect(actor.x).toBe(500);
    expect(actor.y).toBe(300);
  });

  it("derives zIndex per layer: layer-2 tiles stack above others", () => {
    const ground = new TileActor({
      sprite: makeSprite(),
      tileKey: "g",
      frameIndex: 0,
      isAnimated: false,
      cellId: 50,
      x: 0,
      y: 0,
      layer: 0,
    });
    const object2 = new TileActor({
      sprite: makeSprite(),
      tileKey: "o",
      frameIndex: 0,
      isAnimated: false,
      cellId: 50,
      x: 0,
      y: 0,
      layer: 2,
    });

    // layer 2 tiles multiply cellId by 100 to stack above layer 0/1
    expect(ground.zIndex).toBe(50);
    expect(object2.zIndex).toBe(5000);
  });

  it("explicit zIndex override wins over the layer formula", () => {
    const actor = new TileActor({
      sprite: makeSprite(),
      tileKey: "t",
      frameIndex: 0,
      isAnimated: false,
      cellId: 1,
      x: 0,
      y: 0,
      layer: 0,
      zIndex: 9999,
    });
    expect(actor.zIndex).toBe(9999);
  });

  it("registers in scene.query(Cap.Rendered) and Cap.Positioned buckets", () => {
    const scene = new Scene();
    const actor = new TileActor({
      sprite: makeSprite(),
      tileKey: "t",
      frameIndex: 0,
      isAnimated: false,
      cellId: 1,
      x: 0,
      y: 0,
      layer: 0,
    });
    scene.add(actor);

    expect(scene.query(Cap.Rendered).has(actor)).toBe(true);
    expect(scene.query(Cap.Positioned).has(actor)).toBe(true);
  });

  it("dispose() destroys the underlying sprite exactly once", () => {
    const sprite = makeSprite();
    const actor = new TileActor({
      sprite,
      tileKey: "t",
      frameIndex: 0,
      isAnimated: false,
      cellId: 1,
      x: 0,
      y: 0,
      layer: 0,
    });

    actor.dispose();
    expect(sprite.destroyed).toBe(true);

    // Idempotent
    expect(() => actor.dispose()).not.toThrow();
  });

  it("scene.remove(id) disposes and removes from all capability buckets", () => {
    const scene = new Scene();
    const sprite = makeSprite();
    const actor = new TileActor({
      sprite,
      tileKey: "t",
      frameIndex: 0,
      isAnimated: false,
      cellId: 1,
      x: 0,
      y: 0,
      layer: 0,
    });
    scene.add(actor);
    scene.remove(actor.id);

    expect(scene.has(actor.id)).toBe(false);
    expect(scene.query(Cap.Rendered).has(actor)).toBe(false);
    expect(sprite.destroyed).toBe(true);
  });
});
