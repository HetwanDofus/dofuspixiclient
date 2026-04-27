/**
 * Spell 2061 — (Unknown name).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2061/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no projectile, no caster reference,
 * no `move`/`shoot`/`duplicate` symbol — just a single impact animation
 * (`anim1`, 18 frames) that plays at the target cell and removes itself at
 * frame 16 (`DefineSprite_2/frame_16/DoAction.as`: `_parent.removeMovieClip();
 * stop();`). This is the canonical single-impact-at-target pattern → TargetCell.
 *
 * Library symbols: none (`librarySymbols` is empty in the manifest).
 *
 * Animations:
 *   - anim1 — 18-frame impact composite anchored at the target cell.
 *     frame_16 (index 15) calls `_parent.removeMovieClip(); stop();`
 *     → we call `this.runtime.signalHit()` at the canonical impact
 *     (frame 0, the first visible frame) and `this.runtime.complete()`
 *     at frame 15 when the outer mc is removed.
 *
 * Main timeline: implicit — the main timeline places `anim1` on frame_1.
 * No `SOMA.playSound` call is present in any script.
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
  width: 284.6,
  height: 149.55,
  offsetX: -143.2,
  offsetY: -74.6,
};

export class Spell2061 extends RuntimeSpell {
  readonly spellId = 2061;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 18-frame impact animation at the target cell ----
    // AS: DefineSprite_2/frame_16/DoAction.as
    //   _parent.removeMovieClip();
    //   stop();
    //
    // No librarySymbols entry exists; anim1 appears only in animations[].
    // Textures are retrieved under the bare name (no lib_ prefix).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 18,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip, _ctx) => {
            // First visible frame — canonical hit moment for a
            // single-impact TargetCell spell with no projectile.
            this.runtime.signalHit();
          },
        ],
        [
          15,
          (clip, _ctx) => {
            // AS DefineSprite_2/frame_16/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
            // clip is anim1 itself; clip.parent is root (outer mc).
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
    // Main timeline frame_1: implicitly places anim1 at the root.
    // No SOMA.playSound call is present in the canonical scripts.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
