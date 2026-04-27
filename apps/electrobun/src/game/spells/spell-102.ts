/**
 * Spell 102 — Attaque Naturelle (Feca variant / Artisanat-style impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/102/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move`, `shoot`, `duplicate`, or
 * `librarySymbols` entry in the manifest — the entire animation is a single
 * `anim1` timeline (51 frames, composite) that plays at the target cell.
 * The main timeline's frame_1 fires `SOMA.playSound("arty_102")`.
 * The outer mc removal is driven by `frame_172/DoAction.as` →
 * `this.removeMovieClip()`, which we mirror from the anim1 symbol's
 * final-frame script.
 *
 * Library symbols: none (librarySymbols[] is absent from manifest).
 *
 * The many DefineSprite_* scripts in the manifest belong to sub-sprites
 * composited inside the `anim1` dofasset; the runtime renders them as
 * baked SVG frames — we do not need to register them as separate
 * SymbolDefinitions. The only things we must express in TS are:
 *   - The `anim1` symbol itself (51 frames, plays through to completion).
 *   - signalHit at a canonical impact frame (frame 1, first visible frame).
 *   - complete() at the canonical removal frame (frame 172 in AS → but
 *     the asset only has 51 frames; the outer mc's frame_172 DoAction
 *     is the main timeline, not anim1. We treat the end of anim1 as
 *     the completion point: stopFrame=48 per manifest, so we fire
 *     complete() at frame index 48 (AS frame 49) when the clip stops).
 *
 * Main timeline: `frame_1/DoAction.as` → SOMA.playSound("arty_102").
 *                `frame_172/DoAction.as` → this.removeMovieClip() — this is
 *                the outer SWF main-timeline removal; we mirror it by calling
 *                this.runtime.complete() from the anim1 stop frame.
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
  width: 138.55,
  height: 91.55,
  offsetX: -70.4,
  offsetY: -73.5,
};

export class Spell102 extends RuntimeSpell {
  readonly spellId = 102;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 51-frame composite impact at target cell --------
    // manifest: animations[0], frameCount=51, stopFrame=48.
    // The canonical outer SWF's frame_172/DoAction.as fires
    // `this.removeMovieClip()` — we map that to complete() at the
    // stop frame (index 48, AS frame 49) since the anim only has
    // 51 frames and the outer removal happens after the animation
    // finishes playing.
    // signalHit is fired at frame index 0 (AS frame 1) — the first
    // visible impact frame.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 51,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS frame_1: first impact frame — signal hit so damage
            // popup appears as soon as the animation starts.
            this.runtime.signalHit();
          },
        ],
        [
          48,
          (clip) => {
            // AS frame_172/DoAction.as (outer mc removal) mapped to
            // stopFrame=48 of anim1. Stop the clip and signal spell
            // completion.
            // AS: this.removeMovieClip() → outer mc teardown.
            clip.stop();
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
    // AS frame_1/DoAction.as: SOMA.playSound("arty_102");
    callbacks.playSound("arty_102");

    // Attach anim1 at the root so it starts playing from the first
    // runtime tick. For displayType=11 (TargetCell) the container is
    // already positioned at the target cell, so no additional offset
    // is needed.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
