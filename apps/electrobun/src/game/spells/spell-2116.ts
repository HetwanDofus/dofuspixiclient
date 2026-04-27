/**
 * Spell 2116 — Artillerie (Roublard / Rogue area effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2116/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile, no caster-reference,
 * no `move`/`shoot`/`duplicate` symbols, and no `_parent.cellFrom` reads. The
 * entire animation plays at the target cell — single impact composite `anim1`
 * (51 frames, stopFrame=48). No librarySymbols are present in the manifest;
 * `anim1` is the sole animation entry. The main timeline `frame_1/DoAction.as`
 * plays the sound. The main timeline `frame_172/DoAction.as` removes the outer
 * mc (`this.removeMovieClip()`), which is the completion signal.
 *
 * However, examining the scripts more carefully:
 * The manifest lists many DefineSprite_* symbols (baton, tige, baton2, etc.)
 * but NO librarySymbols[] array — meaning these are INTERNAL to the `anim1`
 * composite animation and are NOT directly attachMovie'd by per-spell code.
 * The DefineSprite scripts are part of the authored composite anim1 timeline
 * internals; the texture provider already bakes them into the per-frame SVGs.
 *
 * The top-level spell behavior is:
 *   - frame_1: SOMA.playSound("arty_102")
 *   - frame_172: this.removeMovieClip() → spell complete
 *
 * Since anim1 has stopFrame=48 (0-based frame 48, total 51 frames) and the
 * outer timeline runs to frame 172, the anim1 composite handles the visual
 * and the outer timeline drives completion timing.
 *
 * signalHit: fired at anim1's impact — the canonical impact is around the
 * midpoint of the animation (no explicit "end()" call visible, so we use
 * a reasonable heuristic: frame 12 of anim1, matching typical impact timing
 * for artillery-type spells). Given no librarySymbols, we attach `anim1`
 * as a single container symbol via onSpellStart and signal hit at frame 12.
 *
 * Library symbols: none (all composited inside anim1 frames).
 *
 * Main timeline:
 *   frame_1: SOMA.playSound("arty_102")
 *   frame_172: this.removeMovieClip() → complete
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

export class Spell2116 extends RuntimeSpell {
  readonly spellId = 2116;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main impact composite (51 frames, stopFrame=48) ----
    // This is the sole visual for spell 2116. It is in animations[] only
    // (no librarySymbols entry), so we use textures.getFrames("anim1")
    // without any lib_ prefix.
    //
    // frame_49 (AS frame_49 of DefineSprite_25): stop() — mirrors
    //   scripts/DefineSprite_25/frame_49/DoAction.as
    //
    // We signal hit at frame 12 (a reasonable impact timing) and
    // signal complete at frame 172 of the outer timeline. Since we're
    // driving the outer timeline via this symbol's frameScripts, we
    // place complete() at frame 171 (0-based) = AS frame 172.
    //
    // Note: the outer timeline is 172 frames total. We model the outer
    // timeline as anim1's container running 172 frames. Since anim1
    // itself has 51 frames with a stop at frame 49 (0-based 48), the
    // visual stops there while the "outer" timer continues.
    // We encode the outer completion via frameScripts on anim1 itself
    // (frame 171 = AS frame_172).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 172,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS frame_49 of DefineSprite_25/frame_49/DoAction.as: stop()
          // Corresponds to the stopFrame=48 (0-based) from manifest.
          48,
          (clip) => {
            // scripts/DefineSprite_25/frame_49/DoAction.as: stop()
            clip.stop();
          },
        ],
        [
          // Signal hit at a canonical impact frame (~frame 13 = 0-based 12)
          12,
          () => {
            // No explicit "end()" or signalHit frame in the AS, but impact
            // visuals peak around frame 13 for artillery-type spells.
            this.runtime.signalHit();
          },
        ],
        [
          // AS frame_172/DoAction.as: this.removeMovieClip()
          // 0-based: frame 171
          171,
          (clip) => {
            // scripts/frame_172/DoAction.as: this.removeMovieClip()
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
    // scripts/frame_1/DoAction.as: SOMA.playSound("arty_102")
    callbacks.playSound("arty_102");

    // Attach anim1 at the root so it starts playing from the next tick.
    // displayType=11 means the container is already at the target cell;
    // anim1 is placed at root local (0,0) matching canonical AS behaviour.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
