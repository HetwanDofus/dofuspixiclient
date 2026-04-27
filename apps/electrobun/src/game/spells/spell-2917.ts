/**
 * Spell 2917 — Unknown Spell (likely a self-buff or target-cell impact anim).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2917/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no `move`/`shoot`/`duplicate` symbols,
 * no caster-anchor references, no dual-anchored placements — this is a pure
 * single-clip impact animation placed at the target cell.
 *
 * The manifest has a single `animations[]` entry (`anim1`, 240 frames) and NO
 * `librarySymbols[]`. All AS scripts belong to internal DefineSprite nodes
 * embedded within that composite animation; they are NOT independently
 * attachMovie-able symbols. The runtime plays the pre-composited `anim1`
 * timeline directly.
 *
 * Internal sprite structure (informational — drives the composited frames):
 *   - DefineSprite_7  (97 frames): frame_1 randomises alpha (30–119).
 *                                   frame_97 stops.
 *   - DefineSprite_19 (181 frames): frame_181 removes grandparent +
 *                                   stops → spell complete.
 *   - DefineSprite_44 (40 frames): frame_1 gotoAndPlay(random(10)+1)
 *                                   (random entry point); frame_40 stops.
 *   - DefineSprite_40 / DefineSprite_15: apply colour transforms
 *                                   (GAC.applyColor — not reproducible
 *                                   in the TS runtime; no-op here).
 *   - DefineSprite_47 (238 frames): frame_238 stops.
 *   - DefineSprite_46 (94 frames):  frame_94 stops.
 *
 * The longest internal timeline is DefineSprite_19 which fires
 * `_parent._parent.removeMovieClip()` at frame 181, driving spell
 * completion. The pre-composited `anim1` asset already bakes all of
 * this into its 240-frame strip; we honour the canonical completion
 * signal at frame 181 (0-based: 180) and signalHit slightly before
 * (frame 97 of the inner sprite, mapped here to anim1 frame ~97).
 *
 * Main timeline: no SOMA.playSound call present in scripts — no sound.
 *
 * Library symbols: none (librarySymbols[] is absent/empty in manifest).
 * Textures: `textures.getFrames("anim1")` (bare name, no lib_ prefix).
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
  width: 83.85,
  height: 216.65,
  offsetX: -51.05,
  offsetY: -145.3,
};

export class Spell2917 extends RuntimeSpell {
  readonly spellId = 2917;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 240-frame composited impact animation -----------
    // The entire spell visual is baked into this single animated symbol.
    // Key canonical events ported from the internal DefineSprite scripts:
    //
    //   frame_1  (index 0):  DefineSprite_7/frame_1 — random alpha on
    //                        inner glint sprite. In the composited asset
    //                        this is already baked; we don't need to
    //                        reproduce it, but we DO need to track the
    //                        timeline for signalHit + complete timing.
    //
    //   frame_97 (index 96): DefineSprite_7/frame_97 — inner sprite
    //                        stops. Used as signalHit marker (the glint
    //                        has finished its burst, meaning the impact
    //                        has fully registered visually).
    //
    //   frame_181 (index 180): DefineSprite_19/frame_181 —
    //                        `_parent._parent.removeMovieClip()` → the
    //                        outer movie clip is removed. This is the
    //                        canonical spell-complete signal.
    //
    //   frame_238 (index 237): DefineSprite_47/frame_238 — stop().
    //                        Also used as safety stop for the anim1
    //                        clip (matches manifest stopFrame=237).
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 240,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS DefineSprite_7/frame_1/DoAction.as — randomise inner
          // glint alpha: `_alpha = 30 + random(90)`.
          // In the composited asset this is baked, but we port the
          // intent here as a no-op comment for completeness; the clip
          // alpha is left at 1 (fully opaque) since the texture already
          // encodes the visual result.
          0,
          (_clip, _ctx) => {
            // Canonical: _alpha = 30 + random(90) on inner DefineSprite_7.
            // Pre-composited into anim1 frames — no runtime action needed.
          },
        ],
        [
          // AS DefineSprite_7/frame_97/DoAction.as — `stop()` on the
          // inner glint sprite. Marks the end of the impact burst.
          // We use this as the canonical hit signal.
          96,
          (_clip, _ctx) => {
            // Canonical: DefineSprite_7/frame_97 → stop() on inner sprite.
            // Impact burst complete — signal hit to the combat sequencer.
            this.runtime.signalHit();
          },
        ],
        [
          // AS DefineSprite_19/frame_181/DoAction.as —
          //   `_parent._parent.removeMovieClip(); stop();`
          // The inner DefineSprite_19 removes the outer mc at frame 181.
          // This is the canonical spell-complete trigger.
          180,
          (clip, _ctx) => {
            // Canonical: _parent._parent.removeMovieClip() + stop().
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
        [
          // AS DefineSprite_47/frame_238/DoAction.as — `stop()`.
          // Safety stop at the end of the longest authored timeline.
          // Matches manifest stopFrame=237 (0-based index 237).
          237,
          (clip, _ctx) => {
            // Canonical: DefineSprite_47/frame_238 → stop().
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline: no SOMA.playSound present in canonical AS scripts.
    // Attach the anim1 clip as the sole child of root so it begins
    // playing from the first runtime tick.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
