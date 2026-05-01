/**
 * Spell 707 — Grina (Sadida / Earth).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/707/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no `move`, `shoot`, `duplicate`,
 * or any projectile/beam logic. It is a single animated composite that plays
 * at the target cell. The manifest carries one `animations[]` entry (`anim1`,
 * 24 frames, no `librarySymbols[]`), confirming the target-cell pattern.
 *
 * The outer main timeline has only two scripted frames:
 *   - frame_1:  SOMA.playSound("grina_707")
 *   - frame_67: this.removeMovieClip() → spell complete
 *
 * Two library-like DefineSprites appear in the scripts list but are authored
 * sub-sprites of the composite `anim1` asset:
 *   - DefineSprite_3 — frame_1: gotoAndStop(random(3) + 1)  (random still-frame picker)
 *   - DefineSprite_5 — frame_1:  random trajectory selector → gotoAndStop("traj1"); play()
 *                     frame_39: stop()
 *                     frame_79: stop()
 *                     frame_119: stop()
 *   - DefineSprite_8 — frame_23: stop()
 *
 * None of those sub-sprites are attached via `attachMovie` — they are placed
 * directly on the authored `anim1` composite timeline and their behaviours are
 * baked into the pre-rendered SVG frame sequence exported in `animations[]`.
 * No `librarySymbols[]` is present in the manifest, so there is nothing to
 * register via `SymbolDefinition`. The `anim1` animation drives itself.
 *
 * The runtime-level contract:
 *   - signalHit  — the `anim1` stopFrame is 22 (0-based frame 22), which
 *     corresponds to the visual peak; we fire signalHit there.
 *   - complete   — mirroring frame_67/DoAction.as `this.removeMovieClip()`.
 *     The `anim1` symbol has 24 frames (indices 0–23). Frame_67 on the outer
 *     main timeline is the removal frame. We model the outer timeline as the
 *     `anim1` symbol itself and fire complete at frame index 23 (the last
 *     authored frame), which is the closest proxy to frame_67 that the
 *     exported asset exposes.
 *
 * Library symbols: none (librarySymbols[] is absent in manifest.json).
 * Main timeline: playSound("grina_707") on frame_1; removeMovieClip on frame_67.
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
  width: 397.95,
  height: 222.8,
  offsetX: -201.35,
  offsetY: -101.8,
};

export class Spell707 extends RuntimeSpell {
  readonly spellId = 707;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 24-frame composite impact animation at target cell ----
    // animations[] entry (no lib_ prefix — not in librarySymbols[]).
    // The authored sub-sprite scripts (DefineSprite_3, DefineSprite_5,
    // DefineSprite_8) are entirely internal to the composite and their
    // behaviours are expressed through the per-frame SVG exports.
    //
    // Frame scripts mirror the outer main timeline:
    //   frame_1/DoAction.as  → (sound, handled in onSpellStart)
    //   frame_67/DoAction.as → this.removeMovieClip()
    //
    // The outer timeline has 67 frames but the exported asset has 24.
    // We map the removal to the last available frame (index 23).
    // signalHit fires at the manifest's stopFrame (index 22), the
    // canonical visual-peak frame for this animation.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 24,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          22,
          (_clip) => {
            // Canonical stopFrame / visual peak — signal hit (damage popup).
            // Mirrors the manifest fadingFrame / stopFrame annotation.
            this.runtime.signalHit();
          },
        ],
        [
          23,
          (clip) => {
            // AS scripts/frame_67/DoAction.as: this.removeMovieClip()
            // Frame_67 of the outer main timeline — maps to the last
            // exported frame (index 23) of the anim1 asset.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("grina_707");
    callbacks.playSound("grina_707");

    // Attach anim1 at the root (target cell anchor) so it starts
    // ticking from the next runtime frame, mirroring the implicit
    // placement of the main-timeline composite in the canonical SWF.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
