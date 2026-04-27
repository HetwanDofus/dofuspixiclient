/**
 * Spell 206 — Croque-mitaine (Osamodas, or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/206/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is a single authored animation symbol
 * (DefineSprite_24 / "anim1") that plays a 216-frame composite timeline at
 * the target cell. No projectile motion, no library symbols spawned via
 * attachMovie, no caster-side content. This is a pure target-impact spell.
 *
 * Library symbols: none (librarySymbols[] is absent from manifest).
 *
 * The manifest exposes one animation: "anim1" (216 frames, isComposite=true).
 * The AS scripts all live inside DefineSprite_24, which IS the anim1 symbol.
 * We register it as a SymbolDefinition named "anim1" with textures.getFrames("anim1").
 *
 * Main timeline: implicit placement of anim1 at the target cell; no explicit
 * SOMA.playSound on the outer main timeline (all sounds are within DefineSprite_24).
 *
 * DefineSprite_24 frame scripts (1-based AS → 0-based TS):
 *   frame_1   (index 0)   : SOMA.playSound("dodge_607c")
 *   frame_70  (index 69)  : SOMA.playSound("crockette_206")
 *   frame_79  (index 78)  : SOMA.playSound("herbe")
 *   frame_100 (index 99)  : this.end() → signalHit
 *   frame_157 (index 156) : SOMA.playSound("dodge_607")
 *   frame_214 (index 213) : _parent.removeMovieClip() → complete
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

const ANIM1_BOUNDS = {
  width: 50.2,
  height: 389.25,
  offsetX: -25.8,
  offsetY: -214.5,
};

export class Spell206 extends RuntimeSpell {
  readonly spellId = 206;
  readonly displayType = SpellDisplayType.TargetCell;

  private callbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 216-frame composite impact at target cell -------
    // AS source: scripts/DefineSprite_24/
    // All sounds and signals are driven by frame scripts inside this symbol.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 216,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_24/frame_1/DoAction.as
            // SOMA.playSound("dodge_607c");
            this.callbacks?.playSound("dodge_607c");
          },
        ],
        [
          69,
          (_clip) => {
            // AS DefineSprite_24/frame_70/DoAction.as
            // SOMA.playSound("crockette_206");
            this.callbacks?.playSound("crockette_206");
          },
        ],
        [
          78,
          (_clip) => {
            // AS DefineSprite_24/frame_79/DoAction.as
            // SOMA.playSound("herbe");
            this.callbacks?.playSound("herbe");
          },
        ],
        [
          99,
          (_clip) => {
            // AS DefineSprite_24/frame_100/DoAction.as
            // this.end() → damage popup at target
            this.runtime.signalHit();
          },
        ],
        [
          156,
          (_clip) => {
            // AS DefineSprite_24/frame_157/DoAction.as
            // SOMA.playSound("dodge_607");
            this.callbacks?.playSound("dodge_607");
          },
        ],
        [
          213,
          (clip) => {
            // AS DefineSprite_24/frame_214/DoAction.as
            // _parent.removeMovieClip(); → spell complete
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Store callbacks so frame scripts inside anim1 can play sounds.
    this.callbacks = callbacks;

    // Attach anim1 at root (target cell, depth 1).
    // The harness anchors the container at the target cell for displayType=11,
    // so no additional offset is needed.
    const sym = this.registry.resolve("anim1");
    if (sym) {
      this.root.attach(sym, "anim1", 1, context);
    }
  }
}
