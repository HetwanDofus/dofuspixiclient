/**
 * Spell 701 — Grina (Osamodas).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/701/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion, no caster
 * reference, no dual-anchor logic — a single animated composite plays at the
 * target cell. The manifest has no librarySymbols, only a single `animations`
 * entry ("anim1") with 105 frames. There is no `attachMovie` call anywhere in
 * the scripts; the animation is an authored main-timeline sprite.
 *
 * Canonical AS layout:
 *
 *   - DefineSprite_14 (outer mc, 105 frames):
 *       frame_1 / DoAction.as  : SOMA.playSound("grina_701")
 *       frame_103 / DoAction.as: _parent.removeMovieClip() → spell complete
 *
 *   - DefineSprite_10 (inner sprite placed on DefineSprite_14's timeline):
 *       frame_1 / DoAction.as  : gotoAndStop(random(6) + 1)
 *         — jumps to a random frame 1-6 on load to pick one of six
 *           visual variants stored in the first six frames of anim1.
 *
 * Because librarySymbols is empty, we model this as two nested SymbolDefinitions:
 *   - "anim1_inner" (DefineSprite_10): totalFrames=6, uses anim1 frame textures,
 *     frame_1 randomises the displayed frame and stops.
 *   - "anim1" (DefineSprite_14): totalFrames=105, uses anim1 frame textures,
 *     frame_1 plays sound (via onSpellStart), frame_103 signals complete and
 *     removes self.
 *
 * signalHit is fired at frame_1 of the outer sprite (impact is immediate —
 * this is a melee-style attack that hits on the very first visible frame).
 *
 * No `lib_` prefix is used anywhere because librarySymbols is empty.
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
  width: 126,
  height: 76.55,
  offsetX: -25.95,
  offsetY: -13.6,
};

export class Spell701 extends RuntimeSpell {
  readonly spellId = 701;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1InnerSym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    const anim1Frames = textures.getFrames("anim1");

    // ---- anim1_inner — DefineSprite_10 (inner randomised variant picker) ----
    // AS: DefineSprite_10/frame_1/DoAction.as
    //   gotoAndStop(random(6) + 1);
    // Jumps to one of the first 6 frames at random and stops, selecting
    // one of six visual variants baked into the anim1 texture sequence.
    this.anim1InnerSym = {
      name: "anim1_inner",
      totalFrames: 6,
      frames: anim1Frames.slice(0, 6),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_10/frame_1/DoAction.as
            // gotoAndStop(random(6) + 1)  →  0-based: random(6) + 0
            clip.gotoAndStop(Math.floor(Math.random() * 6));
          },
        ],
      ]),
    };

    // ---- anim1 — DefineSprite_14 (outer 105-frame container) ----------------
    // AS: DefineSprite_14/frame_1/DoAction.as   → SOMA.playSound("grina_701")
    //     DefineSprite_14/frame_103/DoAction.as → _parent.removeMovieClip()
    // The sound is played in onSpellStart (main-timeline frame_1 equivalent).
    // frame_103 (0-based: 102) removes the parent outer mc and signals complete.
    // signalHit is fired at frame_1 (0-based: 0) — the hit is immediate.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 105,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_14/frame_1/DoAction.as (sound handled in onSpellStart)
            // Signal hit at the first impact frame.
            this.runtime.signalHit();
            // Place the inner randomised-variant sprite on depth 1.
            clip.attach(this.anim1InnerSym, "anim1_inner", 1, ctx);
          },
        ],
        [
          102,
          (clip) => {
            // AS: DefineSprite_14/frame_103/DoAction.as
            // _parent.removeMovieClip() — outer mc removal → spell complete.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1InnerSym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: DefineSprite_14/frame_1/DoAction.as → SOMA.playSound("grina_701")
    callbacks.playSound("grina_701");
    // Attach the outer 105-frame sprite onto root so the timeline starts ticking.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
