/**
 * Spell 2007 — (Unknown spell name).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2007/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has a single authored animation
 * (`anim1`, 72 frames) with no library symbols, no `attachMovie` calls,
 * and no projectile/beam/caster logic. The only script is:
 *   DefineSprite_19/frame_70/DoAction.as → `_parent.removeMovieClip()`
 * which fires at frame 70 (0-based: 69), removes the outer mc, and signals
 * spell completion. The animation plays entirely at the target cell.
 *
 * Library symbols: none (librarySymbols[] is absent/empty in manifest).
 *
 * Main timeline: single `anim1` animation attached at root; no sound cue
 * present in the manifest scripts.
 *
 * The `anim1` symbol is the sole visual: 72 frames of authored SVG content.
 * frame_70 (0-based 69) removes the parent → complete.
 * We also fire signalHit at the same frame since that is the canonical
 * impact moment for a TargetCell impact spell (no separate hit frame is
 * authored in the AS).
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
  width: 119.15,
  height: 46.65,
  offsetX: -13.65,
  offsetY: -24.7,
};

export class Spell2007 extends RuntimeSpell {
  readonly spellId = 2007;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 72-frame target-cell impact animation ----------
    // No library symbol entry; this is the bare `animations[]` entry
    // named "anim1". Use textures.getFrames("anim1") (no lib_ prefix).
    //
    // AS DefineSprite_19/frame_70/DoAction.as:
    //   _parent.removeMovieClip();
    // → frameScripts[69]: remove parent, signal hit + complete.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 72,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          69,
          (clip) => {
            // AS DefineSprite_19/frame_70/DoAction.as: _parent.removeMovieClip()
            // This is the outer mc removal — signal hit (impact moment) and
            // spell completion simultaneously.
            this.runtime.signalHit();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline frame_1: place anim1 at root.
    // No SOMA.playSound call is present in the manifest scripts.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
