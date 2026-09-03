import { beforeEach, describe, expect, test } from "bun:test";

import { AnimatedSprite, type Sprite, Texture } from "pixi.js";

import type { PickingSystem } from "@/game/render/picking-system";
import type { PlayerRenderer } from "@/game/scene/player/renderer";
import type { InteractiveObjectData, PickResult } from "@/game/types";
import { BattlefieldPicking } from "@/game/scene/battlefield/picking";
import { contextMenuStore } from "@/game/stores/context-menu-store";

// Pickable ids address the player tables and the tile tables alike. A map
// reload drops both sets of sprites, so anything that survives it answers
// for a sprite that is gone — and a reused id makes a door answer with a
// departed actor's menu. QA-089.

const DOOR_GFX = 6749;

function makeSprite(): Sprite {
  return {} as unknown as Sprite;
}

function makePickingSystem(): PickingSystem {
  const registered = new Set<number>();

  return {
    registerObject: ({ id }: { id: number }) => registered.add(id),
    unregisterObject: (id: number) => registered.delete(id),
    clear: () => registered.clear(),
    registeredIds: registered,
  } as unknown as PickingSystem;
}

function makeRenderer(playerId: number, name: string): PlayerRenderer {
  return {
    getPlayerPickingData: (id: number) =>
      id === playerId ? { sprite: makeSprite() } : undefined,
    getPlayerName: (id: number) => (id === playerId ? name : undefined),
    getPlayerCell: () => undefined,
    isFightMode: () => false,
    setHoverHighlight: () => {},
    setHpBarVisible: () => {},
    showName: () => {},
    hideName: () => {},
  } as unknown as PlayerRenderer;
}

const doorData: InteractiveObjectData = {
  id: 128,
  name: "Porte",
  type: 5,
  skills: [{ id: 84, label: "Entrer", jobId: 1 }],
};

describe("BattlefieldPicking — map reload", () => {
  let picking: BattlefieldPicking;
  let renderer: PlayerRenderer;

  beforeEach(() => {
    renderer = makeRenderer(1, "Dev");
    const pickingSystem = makePickingSystem();

    picking = new BattlefieldPicking({
      pickingSystem: () => pickingSystem,
      interactiveObjects: () => new Map([[DOOR_GFX, doorData]]),
      npcLang: () => new Map(),
      worldActorRenderer: () => renderer,
      app: () => null,
    });
  });

  function clickTile(pickableId: number): void {
    const result: PickResult = {
      object: { id: pickableId, sprite: makeSprite() },
      x: 0,
      y: 0,
    };
    picking.onObjectClick(result);
  }

  test("a door registered after a map change opens the door menu", () => {
    // First map: the local character takes a pickable id.
    picking.registerPlayer(1, renderer, undefined, true);

    // Map change — the actor renderer is destroyed, then the new map's
    // tiles register.
    picking.clearPlayers();
    picking.clearTiles();
    const doorId = picking.registerTile(makeSprite(), DOOR_GFX, 236);

    clickTile(doorId);

    expect(contextMenuStore.getSnapshot().title).toBe("Porte");
  });

  test("ids are not recycled across map reloads", () => {
    const firstId = picking.registerTile(makeSprite(), DOOR_GFX, 236);

    picking.clearTiles();

    expect(picking.registerTile(makeSprite(), DOOR_GFX, 236)).not.toBe(firstId);
  });

  test("clearTiles leaves the actors pickable", () => {
    // The zoom rebuild clears tiles while the actors stay on screen; a
    // blanket `PickingSystem.clear()` there un-picks the character.
    picking.registerPlayer(1, renderer, undefined, true);
    const doorId = picking.registerTile(makeSprite(), DOOR_GFX, 236);

    picking.clearTiles();

    clickTile(doorId);
    expect(contextMenuStore.getSnapshot().open).toBe(false);

    picking.onObjectClick({
      object: { id: 1, sprite: makeSprite() },
      x: 0,
      y: 0,
    });
    expect(contextMenuStore.getSnapshot().title).toBe("Dev");
  });
});

describe("BattlefieldPicking — resource frames", () => {
  // The ash tree as it is published: a still to stand on, a still while it is
  // being cut, the 23-frame fall, the stump it rests on, then the regrowth.
  const TREE_STATES = [
    { frame: 1, start: 0, count: 1 },
    { frame: 2, start: 1, count: 1 },
    { frame: 3, start: 2, count: 23 },
    { frame: 4, start: 25, count: 1 },
    { frame: 5, start: 26, count: 18 },
  ];

  function makePicking(): BattlefieldPicking {
    return new BattlefieldPicking({
      pickingSystem: () => makePickingSystem(),
      interactiveObjects: () => new Map(),
      npcLang: () => new Map(),
      worldActorRenderer: () => null,
      app: () => null,
    });
  }

  function makeResource(): AnimatedSprite {
    const sprite = new AnimatedSprite({
      textures: Array.from({ length: 44 }, () => Texture.EMPTY),
      autoUpdate: false,
    });
    sprite.loop = false;
    sprite.stop();
    return sprite;
  }

  test("GDF frame 3 plays the fall and rests on the stump", () => {
    const picking = makePicking();
    const resource = makeResource();
    picking.registerTile(resource, 7500, 154, TREE_STATES);

    picking.setCellInteractive(154, 3, false);

    // The felling runs; it is the last frame of that run — the stump — the
    // tree is left on, never the first frame of the state after it.
    expect(resource.playing).toBe(true);
    expect(resource.currentFrame).toBe(2);

    resource.currentFrame = 24;
    expect(resource.playing).toBe(false);
    expect(resource.currentFrame).toBe(24);
  });

  test("a resource being harvested keeps standing", () => {
    const picking = makePicking();
    const resource = makeResource();
    picking.registerTile(resource, 7500, 154, TREE_STATES);

    picking.setCellInteractive(154, 2, false);

    expect(resource.currentFrame).toBe(1);
    expect(resource.playing).toBe(false);
  });

  test("the ready frame restores the standing resource", () => {
    const picking = makePicking();
    const resource = makeResource();
    resource.gotoAndStop(24);
    picking.registerTile(resource, 7500, 154, TREE_STATES);

    picking.setCellInteractive(154, 0, true);

    expect(resource.currentFrame).toBe(0);
    expect(resource.playing).toBe(false);
  });

  test("a depletion received during map loading registers as the stump", () => {
    // Nobody watched this tree fall — it was already down when we walked in,
    // so its state is taken at rest rather than replayed.
    const picking = makePicking();
    picking.setCellInteractive(154, 3, false);
    const resource = makeResource();

    picking.registerTile(resource, 7500, 154, TREE_STATES);

    expect(resource.currentFrame).toBe(24);
    expect(resource.playing).toBe(false);
  });

  test("a map change does not carry a stump to the same cell on another map", () => {
    const picking = makePicking();
    picking.setCellInteractive(154, 3, false);
    picking.clearCellStates();
    const resource = makeResource();

    picking.registerTile(resource, 7500, 154, TREE_STATES);

    expect(resource.currentFrame).toBe(0);
  });

  test("a tile with no state table is dimmed, not reframed", () => {
    const picking = makePicking();
    const resource = makeResource();
    picking.registerTile(resource, 7500, 154);

    picking.setCellInteractive(154, 3, false);

    expect(resource.currentFrame).toBe(0);
    expect(resource.alpha).toBeLessThan(1);
  });
});
