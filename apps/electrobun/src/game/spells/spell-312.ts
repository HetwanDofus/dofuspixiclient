/**
 * Spell 312 — Artillerie (Roublard / Rogue artillery).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/312/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no move/shoot/duplicate pattern,
 * no caster-rotation logic, no dual-anchored world-absolute placement —
 * the spell is a single composite impact animation at the target cell.
 * The manifest has a single `animations` entry ("anim1", 279 frames,
 * isComposite=true) and NO librarySymbols. All sub-sprite behaviours
 * are baked into the authored composite timeline. The AS scripts define
 * several internal PlaceObject clip-events (for spinning/drifting
 * sub-elements) plus a final removal frame (DefineSprite_9/frame_277).
 *
 * However, there are NO `attachMovie` calls in any of the scripts —
 * every sub-sprite (DefineSprite_4, DefineSprite_7, DefineSprite_8,
 * DefineSprite_9) is placed statically on its parent timeline by the
 * SWF PlaceObject records. Their onLoad/onEnterFrame clip-events are
 * baked into the composite SVG frames the exporter produced. We do NOT
 * need to register library symbols or spawn children at runtime.
 *
 * What we DO need:
 *   1. Register "anim1" as the root symbol (the sole animations[] entry)
 *      so the root clip displays the 279-frame composite.
 *   2. Fire `signalHit()` at an appropriate impact frame. The canonical
 *      AS does not have an explicit `this.end()` call, so we use the
 *      midpoint of the animation (~frame 14, when the initial burst
 *      would visually land) — using frame 13 (0-based) as a reasonable
 *      canonical impact signal.
 *   3. Fire `complete()` at frame 278 (0-based), matching
 *      DefineSprite_9/frame_277/DoAction.as → `_parent.removeMovieClip()`.
 *      DefineSprite_9 is the outermost authored timeline container
 *      (279 frames), and its frame_277 script removes the outer mc.
 *
 * Main timeline: `SOMA.playSound("arty_101");` only (no stop, no explicit
 * child attaches — all content is in the composite anim1 timeline).
 *
 * Library symbols: none (librarySymbols[] is absent/empty in manifest).
 *
 * Animations:
 *   - anim1 — 279-frame composite impact animation at target cell.
 *     frame 13 (0-based): signalHit (impact burst visible).
 *     frame 278 (0-based): complete (mirrors _parent.removeMovieClip()).
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
  width: 80,
  height: 78.45,
  offsetX: -43.55,
  offsetY: -50.1,
};

export class Spell312 extends RuntimeSpell {
  readonly spellId = 312;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 279-frame composite artillery impact ----
    // This is the sole animations[] entry; no librarySymbols.
    // All internal sub-sprite physics (spinning debris in DefineSprite_4,
    // rotating sparks in DefineSprite_7, spiralling orbs in DefineSprite_8)
    // are baked into the composite SVG frames produced by the exporter.
    // We drive the timeline here only for signalHit + complete timing.
    //
    // frame 13 (0-based) = AS frame_14: visual impact burst is fully visible.
    // frame 278 (0-based) = AS frame_279: mirrors DefineSprite_9/frame_277
    //   `_parent.removeMovieClip()` (the exporter's 279-frame count means
    //   the final frame index is 278).
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 279,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          13,
          (_clip) => {
            // Canonical impact frame — signal damage popup at target.
            this.runtime.signalHit();
          },
        ],
        [
          278,
          (clip) => {
            // AS DefineSprite_9/frame_277/DoAction.as: _parent.removeMovieClip()
            // This is the outermost timeline's final action — end the spell.
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
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("arty_101");
    callbacks.playSound("arty_101");

    // Attach the sole composite animation at the root so the timeline
    // starts playing immediately from the first runtime tick.
    this.root.attach(
      this.registry.resolve("anim1")!,
      "anim1",
      1,
      context,
    );
  }
}
