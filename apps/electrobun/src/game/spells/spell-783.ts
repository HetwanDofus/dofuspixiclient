/**
 * Spell 783 — Gonflement (Osamodas or similar self-buff/aura).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/783/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no library symbols, no
 * projectile, no caster reference — it is a single composite animation
 * (`anim1`, 141 frames) played at the target cell. The outer sprite
 * (DefineSprite_16) plays its authored timeline, fires a sound on
 * frame_1, and calls `stop(); _parent.removeMovieClip();` at frame_139
 * (0-based: 138). No `attachMovie` calls, no `move`/`shoot` symbols,
 * no CLIPACTIONRECORD handlers.
 *
 * Library symbols: none (librarySymbols[] is absent / empty in manifest).
 *
 * Main timeline (DefineSprite_16):
 *   - frame_1  (index 0):  SOMA.playSound("gonfle")
 *   - frame_139 (index 138): stop(); _parent.removeMovieClip()
 *
 * The composite `anim1` animation (141 frames) is registered as the
 * sole symbol and attached to the root so the SpellClip runtime drives
 * its timeline, fires the frame scripts, and signals completion at the
 * canonical removal frame.
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

export class Spell783 extends RuntimeSpell {
  readonly spellId = 783;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 141-frame composite animation at target cell ----
    // Mirrors DefineSprite_16 (the outer sprite in the canonical SWF).
    // frame_1/DoAction.as:  SOMA.playSound("gonfle")  — handled in onSpellStart.
    // frame_139/DoAction.as: stop(); _parent.removeMovieClip()
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 141,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          138,
          (clip) => {
            // AS DefineSprite_16/frame_139/DoAction.as:
            //   stop();
            //   _parent.removeMovieClip();
            clip.stop();
            clip.remove();
            this.runtime.signalHit();
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
    // AS DefineSprite_16/frame_1/DoAction.as:
    //   SOMA.playSound("gonfle");
    callbacks.playSound("gonfle");

    // Attach the main composite animation at the root so the runtime
    // drives its timeline from the first tick.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
