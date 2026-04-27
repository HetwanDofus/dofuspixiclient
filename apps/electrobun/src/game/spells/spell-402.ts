/**
 * Spell 402 — (Iop/unknown, single-target impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/402/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no library symbols, no `move`/`shoot`/
 * `duplicate` references, no caster-relative positioning, and no dual-anchor
 * logic. The spell is a single authored 141-frame composite animation
 * (anim1) anchored at the target cell. The only AS scripts are:
 *
 *   DefineSprite_16/frame_1/DoAction.as   → SOMA.playSound("gonfle")
 *   DefineSprite_16/frame_139/DoAction.as → stop(); _parent.removeMovieClip()
 *
 * `DefineSprite_16` is the top-level sprite backing the `anim1` animation.
 * frame_1  fires on the very first frame: plays a sound.
 * frame_139 stops playback and removes itself, signalling completion.
 *
 * Library symbols: none (librarySymbols[] is absent / empty in manifest).
 *
 * Main timeline: implicit — anim1 is placed on the main timeline by the
 * harness as the root clip. onSpellStart plays the canonical sound.
 *
 * Hit signal: fired at frame_1 (first impact frame), matching the typical
 * TargetCell pattern where the animation starts at the target and the hit
 * is simultaneous with the first frame.
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
  width: 518,
  height: 391.85,
  offsetX: -249.15,
  offsetY: -278.25,
};

export class Spell402 extends RuntimeSpell {
  readonly spellId = 402;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // DefineSprite_16 is the single authored timeline exposed as "anim1"
    // in animations[]. It has no librarySymbols entry, so we use the bare
    // "anim1" key (no lib_ prefix).
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 141,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_16/frame_1/DoAction.as
            // SOMA.playSound("gonfle") is handled in onSpellStart;
            // signal hit on the first visible frame at the target cell.
            this.runtime.signalHit();
          },
        ],
        [
          138,
          (clip) => {
            // AS DefineSprite_16/frame_139/DoAction.as
            // stop();
            // _parent.removeMovieClip();
            clip.stop();
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
    // AS DefineSprite_16/frame_1/DoAction.as: SOMA.playSound("gonfle")
    callbacks.playSound("gonfle");

    // Attach the anim1 symbol as the root's single child so the runtime
    // ticks it from frame 0. For TargetCell the root is already at the
    // target cell; anim1 sits at (0,0) within that container.
    const sym = this.registry["symbols"]?.get("anim1") ??
      // resolve via the registry's public API
      this.registry.resolve("anim1");

    if (sym) {
      this.root.attach(sym, "anim1", 1, context);
    }
  }
}
