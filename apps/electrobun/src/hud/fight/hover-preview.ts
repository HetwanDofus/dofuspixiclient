import type { DofusPathfinding } from "@dofus/grid";
import { cellsInArea, hasLineOfSight } from "@dofus/grid";

import type { Battlefield } from "@/game/scene";
import type { FightUI } from "@/hud/fight/fight-ui";
import { spellCastActor } from "@/game/machines/spell-cast.machine";
import { fightActor, fightStore } from "@/game/stores/fight-store";

/**
 * Wires cell-hover events from the battlefield to the fight-UI
 * overlays + cast machine. Three modes:
 *
 * 1. A movement animation is currently running (or it's not our turn
 *    in combat): no path / AoE preview at all — any lingering tint is
 *    cleared so the highlighter doesn't draw a stale path centered on
 *    the pre-move cell while the server drains MP mid-animation.
 *
 * 2. No spell selected + it's our turn + we have MP: draw the literal
 *    MP-bound path from our cell to the hovered cell using the same
 *    4-direction-only pathfinder the server validates against.
 *
 * 3. Spell selected (cast machine is `targeting`): compute the AoE
 *    footprint via the shared @dofus/grid `cellsInArea` primitive
 *    (same code the server runs), filter out-of-LoS cells, and
 *    dispatch HOVER_CELL to the machine so the highlight overlay
 *    stays in sync.
 */
export interface HoverPreviewDeps {
  battlefield: Battlefield;
  fightUI(): FightUI | null;
  pathfinding(): DofusPathfinding | null;
  currentCellId(): number | null;
  mapDimensions(): { width: number; height: number } | null;
  /**
   * True while our own sprite is running a movement animation. While
   * this is true the server is already settling MP; any hover-derived
   * tint has to stay off the canvas or it will draw a path from the
   * stale cell under the animating sprite.
   */
  isMoving(): boolean;
  /**
   * Cells occupied by fighters, used by `hasLineOfSight` as an
   * obstruction set.
   */
  occupiedCells(): Set<number>;
  /**
   * Snapshot fighter positions into the pathfinder's occupied-cell
   * set before we run findFightPath — otherwise the server rejects
   * paths that cross an enemy and the click looks swallowed. Called
   * on every hover; pathfinder state is overwritten each call.
   */
  syncOccupied(): void;
}

export class HoverPreview {
  constructor(private readonly deps: HoverPreviewDeps) {
    deps.battlefield.setOnCellHover((cellId) => this.onHover(cellId));
  }

  private onHover(cellId: number | null): void {
    const ui = this.deps.fightUI();
    if (!ui) {
      return;
    }

    // Outside any cell → drop all hover-derived overlays.
    if (cellId === null) {
      ui.clearHighlightType("movement-path");
      ui.clearHighlightType("spell-zone");
      ui.clearHighlightType("spell-zone-invalid");
      spellCastActor.send({ type: "HOVER_CLEAR" });
      return;
    }

    // Suppress all hover feedback while our sprite is still animating
    // — the canonical currentCellId for pathfinding is whatever the
    // server tells us AFTER the animation completes, so drawing now
    // would show a ghost path anchored to the pre-move cell.
    if (this.deps.isMoving()) {
      ui.clearHighlightType("movement-path");
      ui.clearHighlightType("spell-zone");
      ui.clearHighlightType("spell-zone-invalid");
      return;
    }

    const castSnap = spellCastActor.getSnapshot();
    if (castSnap.matches("targeting") && castSnap.context.spell) {
      this.updateSpellPreview(cellId);
      return;
    }

    this.updateMovementPreview(cellId);
  }

  private updateMovementPreview(hoveredCell: number): void {
    const ui = this.deps.fightUI();
    if (!ui) {
      return;
    }

    // Only preview when we actually can move — off-turn or during
    // placement the reachable tint isn't showing anyway.
    const fight = fightStore.getSnapshot();
    const fightMachineSnap = fightActor.getSnapshot();
    const isMyTurn =
      typeof fightMachineSnap.value === "object" &&
      fightMachineSnap.value !== null &&
      (fightMachineSnap.value as { fighting?: string }).fighting === "myTurn";
    if (fight.mode !== "fighting" || !isMyTurn || fight.mp <= 0) {
      // mp<=0 matches the original: once the MP is spent the reachable
      // ring disappears and so does the hovered-path hint — showing a
      // trimmed "you could walk here" overlay with zero MP is what
      // caused the path-spreads-everywhere regression.
      ui.clearHighlightType("movement-path");
      return;
    }

    const pf = this.deps.pathfinding();
    const from = this.deps.currentCellId();
    if (!pf || from === null) {
      return;
    }
    this.deps.syncOccupied();
    const path = pf.findFightPath(from, hoveredCell);
    if (!path || path.length < 2) {
      ui.clearHighlightType("movement-path");
      return;
    }
    // Trim to MP budget so we don't draw a path the server will reject.
    const trimmed = path.slice(0, Math.min(path.length, fight.mp + 1));
    // Skip the caster's current cell — it shouldn't look like a step.
    ui.highlightCells(trimmed.slice(1), "movement-path" as const);
  }

  private updateSpellPreview(hoveredCell: number): void {
    const ui = this.deps.fightUI();
    if (!ui) {
      return;
    }
    const snap = spellCastActor.getSnapshot();
    const spell = snap.context.spell;
    const caster = snap.context.casterCellId;
    const dims = this.deps.mapDimensions();
    if (!spell || caster === null || !dims) {
      return;
    }

    const inRange = snap.context.targetingCells.includes(hoveredCell);
    if (!inRange) {
      // Out of range / min-range — hide AoE, flash the cell in red so
      // the player sees why nothing is about to happen.
      ui.highlightCells([hoveredCell], "spell-zone-invalid" as const);
      spellCastActor.send({
        type: "HOVER_CELL",
        cellId: hoveredCell,
        previewCells: [],
      });
      return;
    }

    const occupants = this.deps.occupiedCells();
    const fmap = {
      width: dims.width,
      height: dims.height,
      occupantOf: (cell: number): number | undefined =>
        occupants.has(cell) ? cell : undefined,
    };

    // LoS gate: if the spell requires LoS and the caster can't see
    // the target cell, the whole AoE is invalid.
    const losOk =
      !spell.lineOfSight || hasLineOfSight(fmap, caster, hoveredCell);
    if (!losOk) {
      ui.highlightCells([hoveredCell], "spell-zone-invalid" as const);
      ui.clearHighlightType("spell-zone");
      spellCastActor.send({
        type: "HOVER_CELL",
        cellId: hoveredCell,
        previewCells: [],
      });
      return;
    }

    // For trap / glyph / summon spells the primary effect's
    // areaKind/areaSize describes the SPAWNED entity's trigger zone.
    // The canonical 1.29 client previews exactly that zone on hover
    // (the player wants to see where the glyph will trigger before
    // clicking). singleTargetSpawn is honored only by the cast
    // pipeline — preview always shows the full footprint.
    const area = cellsInArea(
      fmap,
      caster,
      hoveredCell,
      spell.areaKind,
      spell.areaSize
    );
    ui.clearHighlightType("spell-zone-invalid");
    ui.highlightCells(area, "spell-zone" as const);
    spellCastActor.send({
      type: "HOVER_CELL",
      cellId: hoveredCell,
      previewCells: area,
    });
  }
}
