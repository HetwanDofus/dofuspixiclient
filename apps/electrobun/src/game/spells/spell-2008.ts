/**
 * Spell 2008 — Lichrounch (Osamodas or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2008/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single authored symbol
 * `DefineSprite_18_shoot` (84-frame impact animation) plus an outer
 * `DefineSprite_32` container that:
 *   - frame_1: positions self at cellTo, plays "licrounch_1003" sound
 *   - frame_25: fires signalHit (this.end()) + plays "explosion" sound
 *   - frame_67: calls _parent.removeMovieClip() → spell complete
 *
 * The `DefineSprite_18_shoot` inner symbol is the 84-frame rendered
 * animation; it stops at frame_70 (= index 69).
 *
 * There are no library symbols (librarySymbols[] is absent from manifest).
 * The `shoot` animation is listed directly in animations[] and drives
 * the visual via the `shoot` symbol registered as a container with its
 * 84 frame textures.
 *
 * The outer sprite (DefineSprite_32) acts as the root-level clip that
 * positions everything at cellTo and sequences timing. Since displayType=11
 * the container is already anchored at the target cell, so the
 * frame_1 positioning (`_X = _parent.cellTo.x; _Y = _parent.cellTo.y`)
 * is equivalent to placing the child at the world target position —
 * but since our container IS at the target, we position the shoot child
 * at (0,0) relative to the container.
 *
 * Main timeline (frame_2/DoAction.as): stop() — the outer SWF stops
 * immediately; the inner DefineSprite_32 drives the timeline.
 *
 * Library symbols: none (librarySymbols[] absent).
 * Animations: shoot (84 frames) — rendered SVG sequence.
 */

import type {
  SpellCallbacks,
  SpellContext,
  SpellTextureProvider,
  SymbolDefinition,
} from "@dofus/spell-runtime";
import {
  RuntimeSpell,
  SpellDisplayType,
  calculateAnchor,
} from "@dofus/spell-runtime";

const SHOOT_BOUNDS = {
  width: 204.8,
  height: 129.6,
  offsetX: -102.35,
  offsetY: -68.1,
};

export class Spell2008 extends RuntimeSpell {
  readonly spellId = 2008;
  readonly displayType = SpellDisplayType.TargetCell;

  private shootSym!: SymbolDefinition;
  private outerSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 84-frame impact animation (DefineSprite_18_shoot) ----
    // AS DefineSprite_18_shoot/frame_70/DoAction.as: stop()
    this.shootSym = {
      name: "shoot",
      totalFrames: 84,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          69,
          (clip) => {
            // AS: DefineSprite_18_shoot/frame_70/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- outer container (DefineSprite_32) -------------------------
    // This wraps the shoot symbol and sequences:
    //   frame_1: position at cellTo, play "licrounch_1003"
    //   frame_25: this.end() → signalHit + play "explosion"
    //   frame_67: _parent.removeMovieClip() → spell complete
    //
    // Since the container is at the target cell (displayType=11) and
    // the canonical AS sets _X/_Y to cellTo, the shoot child is
    // placed at (0,0) in container-local coords (they coincide).
    this.outerSym = {
      name: "outer",
      totalFrames: 67,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_32/frame_1/DoAction.as → SOMA.playSound("licrounch_1003")
            // AS: DefineSprite_32/frame_1/DoAction_2.as → _X = _parent.cellTo.x; _Y = _parent.cellTo.y
            // Container (displayType=11) is already anchored at cellTo in world space,
            // so placing shoot at (0,0) local matches the canonical _parent.cellTo position.
            clip.attach(this.shootSym, "shoot", 1, ctx, { x: 0, y: 0 });
          },
        ],
        [
          24,
          () => {
            // AS: DefineSprite_32/frame_25/DoAction.as → SOMA.playSound("explosion")
            // AS: DefineSprite_32/frame_25/DoAction_2.as → this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          66,
          (clip) => {
            // AS: DefineSprite_32/frame_67/DoAction.as → _parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.shootSym);
    this.registry.register(this.outerSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: DefineSprite_32/frame_1/DoAction.as → SOMA.playSound("licrounch_1003")
    // Sound is played when the outer clip starts (frame_1). We play it here
    // at spell start and also attach the outer container to the root.
    callbacks.playSound("licrounch_1003");
    // Attach the outer sequencing container at the root (target cell).
    this.root.attach(this.outerSym, "outer", 1, context);
  }
}
