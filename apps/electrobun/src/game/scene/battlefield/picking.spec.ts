import { beforeEach, describe, expect, test } from "bun:test";

import type { Sprite } from "pixi.js";

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
  skills: [{ id: 84, label: "Entrer" }],
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
