import { describe, expect, it } from "bun:test";

import { Container } from "pixi.js";

import { Cap } from "./capabilities";
import { CellHighlighter } from "./overlays/cell-highlighter";
import { GridOverlay } from "./overlays/grid";
import { Scene } from "./scene";

describe("overlay actors integrate with Scene", () => {
  it("GridOverlay is Rendered and discoverable via scene.query(Cap.Rendered)", () => {
    const parent = new Container();
    const scene = new Scene();
    const overlay = new GridOverlay(parent);
    scene.add(overlay);

    const rendered = scene.query(Cap.Rendered);
    expect(rendered.has(overlay)).toBe(true);
    expect(overlay.container).toBeInstanceOf(Container);
    expect(overlay.zIndex).toBeGreaterThan(0);
  });

  it("CellHighlighter is Rendered", () => {
    const parent = new Container();
    const scene = new Scene();
    const overlay = new CellHighlighter(parent);
    scene.add(overlay);

    const rendered = scene.query(Cap.Rendered);
    expect(rendered.has(overlay)).toBe(true);
  });

  it("scene.clear() disposes overlay containers", () => {
    const parent = new Container();
    const scene = new Scene();
    const grid = new GridOverlay(parent);
    const cell = new CellHighlighter(parent);
    scene.add(grid);
    scene.add(cell);

    expect(grid.container.destroyed).toBe(false);
    expect(cell.container.destroyed).toBe(false);

    scene.clear();

    expect(grid.container.destroyed).toBe(true);
    expect(cell.container.destroyed).toBe(true);
    expect(scene.size).toBe(0);
  });

  it("calling destroy() after scene.clear() is a safe no-op", () => {
    const parent = new Container();
    const scene = new Scene();
    const grid = new GridOverlay(parent);
    scene.add(grid);

    scene.clear();
    expect(() => grid.destroy()).not.toThrow();
  });

  it("overlay zIndex establishes draw-order contract", () => {
    const parent = new Container();
    const grid = new GridOverlay(parent);
    const cell = new CellHighlighter(parent);

    // Cell tints (placement, reachable range, spell range, path)
    // render ABOVE the grid, mirroring the original 1.29 ordering
    // Grid=400 < Zone=500 in ExternalContainer.as.
    expect(cell.zIndex).toBeGreaterThan(grid.zIndex);
  });
});
