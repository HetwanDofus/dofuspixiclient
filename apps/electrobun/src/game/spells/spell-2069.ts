/**
 * Spell 2069 — Unknown (target-cell impact animation).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2069/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move`/`shoot`/`duplicate` symbol,
 * no caster reference, no dual-anchor pattern. The spell is a single animated
 * composite (`anim1`) that plays at the target cell — the canonical impact
 * use case.
 *
 * Canonical AS layout:
 *   - `anim1` (animations[] entry, NOT a librarySymbol) — 60-frame composite
 *     rendered at the target cell. No librarySymbols[] in the manifest;
 *     textures are accessed via bare `"anim1"` key (no `lib_` prefix).
 *
 *   The manifest references three DefineSprite numbers internally:
 *
 *   - DefineSprite_7 / frame_181 — outermost container. frame_181 calls
 *     `_parent._parent.removeMovieClip()` (removing the spell's outer mc)
 *     then `stop()`. Signals spell completion.
 *
 *   - DefineSprite_8 / frame_58 — inner container. frame_58 calls `stop()`.
 *     Halts at the last authored frame (58 frames total → index 57).
 *
 *   - DefineSprite_5 / frame_1 — per-instance particle/layer. frame_1 sets
 *     `_alpha = 30 + random(90)` (random alpha 30–119, clamped to 100 in
 *     practice → 0.30–1.00). frame_112 calls `stop()`.
 *
 * Because `librarySymbols` is empty in the manifest, all rendering is
 * driven by the single `anim1` composite timeline. The harness places the
 * root at the target cell; we register `anim1` as the root symbol and fire
 * the canonical frame scripts directly.
 *
 * Main timeline: no SOMA.playSound call found in the provided scripts.
 * `onSpellStart` is a no-op beyond the implicit child attach of `anim1`.
 *
 * Library symbols: none — single `animations[]` entry `anim1`.
 *
 * Hit signal: fired at frame 57 (stopFrame in manifest, mirrors
 * DefineSprite_8/frame_58 → stop(); which marks the visual peak).
 * Completion: fired at frame 180 of DefineSprite_7 (AS frame_181 →
 * `_parent._parent.removeMovieClip()`), mapped to index 180 here.
 * Because `anim1` has only 60 authored frames in the manifest (index 0–59),
 * we model the outer DefineSprite_7 lifetime as a looping / extended
 * container. In practice the anim1 asset has 60 frames; we cap totalFrames
 * at 60 and fire completion at index 57 (the manifest-declared stopFrame)
 * to match the observable "animation ends here" behaviour, consistent with
 * DefineSprite_8/frame_58 halting at the same point.
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
  width: 108.95,
  height: 134.1,
  offsetX: -72,
  offsetY: -96.4,
};

export class Spell2069 extends RuntimeSpell {
  readonly spellId = 2069;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 60-frame composite impact at target cell --------
    // No librarySymbols[] entry; textures accessed via bare "anim1" key.
    // The manifest stopFrame is 57 (0-based), fadingFrame is 56.
    //
    // Internal frame scripts ported:
    //   DefineSprite_5/frame_1/DoAction.as  → frameScripts[0]: set random alpha
    //   DefineSprite_8/frame_58/DoAction.as → frameScripts[57]: stop() + signalHit
    //   DefineSprite_7/frame_181 maps to the outer removal; since the asset
    //   only has 60 frames we fire complete() at the stop frame (57) —
    //   the outermost container's frame_181 removal is the canonical
    //   "end of spell" signal and we collapse it here because no further
    //   authored frames exist beyond stopFrame=57.

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 60,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_5/frame_1/DoAction.as
            // _alpha = 30 + random(90)
            // AS alpha 0-100 → TS 0-1. random(90) = Math.floor(Math.random() * 90).
            // The AS value can exceed 100 (up to 119) but Flash clamps _alpha to 100.
            const alphaAS = 30 + Math.floor(Math.random() * 90);
            clip.alpha = Math.min(alphaAS, 100) / 100;
          },
        ],
        [
          57,
          (clip) => {
            // AS DefineSprite_8/frame_58/DoAction.as → stop()
            // This is the manifest stopFrame; signal hit at the visual peak.
            // AS DefineSprite_7/frame_181/DoAction.as → _parent._parent.removeMovieClip()
            // Collapsed here as no authored frames follow the stop frame.
            clip.stop();
            this.runtime.signalHit();
            clip.remove();
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
    // Main timeline: no SOMA.playSound call in provided scripts.
    // Attach the anim1 composite at the target cell (root is already
    // positioned at cellTo by the TargetCell harness).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
