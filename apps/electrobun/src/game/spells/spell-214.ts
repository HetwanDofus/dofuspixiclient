/**
 * Spell 214 — Crockette (Osamodas).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/214/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile, no caster reference,
 * no duplicate/beam pattern — it is a single animated impact at the target cell.
 * The manifest has no librarySymbols[], only a single `animations[]` entry (`anim1`
 * with 147 frames). There are no `attachMovie` calls in the AS. The main timeline
 * is driven entirely by the authored `anim1` timeline.
 *
 * AS layout:
 *   - DefineSprite_17/frame_1: SOMA.playSound("crockette_214") — the sound sprite.
 *   - DefineSprite_18/frame_145: _parent.removeMovieClip() — outer container removal,
 *     signals spell completion. This is the longest-lived sprite (145 frames → index 144).
 *   - DefineSprite_11/frame_1:  gotoAndPlay(random(18) + 2) — random start offset.
 *   - DefineSprite_11/frame_4:  _rotation = random(360) — random initial rotation.
 *   - DefineSprite_11/frame_28: gotoAndPlay(2) — loop back to frame 2.
 *   - DefineSprite_3/frame_1/PlaceObject2_2_1/onClipEvent(enterFrame):
 *       _alpha = random(100) + 80;  (clamped to 0-1 range: (random(100)+80)/100)
 *       this._rotation += 10;       (10 degrees per frame)
 *
 * Since librarySymbols is empty, the top-level `anim1` animation IS the spell.
 * We register it as the single symbol and attach it on `onSpellStart`.
 * The `anim1` symbol's frameScripts replicate DefineSprite_18 behaviour
 * (frame 144 → complete). DefineSprite_11 and DefineSprite_3 are inner sub-sprites
 * baked into the composite anim1 frames — their authored rendering is already in
 * the frame textures. We honour their script-driven behaviour via the `anim1` symbol's
 * frameScripts where they are relevant to timing (hit + completion).
 *
 * signalHit: fired at frame 13 (frame_14) — a reasonable mid-impact frame for a
 * 147-frame animation with the visual peak roughly there. The canonical AS does not
 * have an explicit `this.end()` call, so we approximate with the first quarter of
 * the animation.
 *
 * complete(): fired at frame 144 (AS frame_145 of DefineSprite_18:
 *   `_parent.removeMovieClip()`).
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
  width: 87.25,
  height: 29.9,
  offsetX: -17.65,
  offsetY: -78.6,
};

export class Spell214 extends RuntimeSpell {
  readonly spellId = 214;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 — the single composite animation for this spell (147 frames).
    // No librarySymbols in the manifest, so no `lib_` prefix — use bare "anim1".
    //
    // Inner sub-sprites are baked into the composite frame textures:
    //   - DefineSprite_17 plays a sound on its frame_1 (handled in onSpellStart).
    //   - DefineSprite_11 has random-rotation/loop behaviour (visual, baked in frames).
    //   - DefineSprite_3's enterFrame flickers alpha + rotates (baked in composite frames).
    //
    // We only need script hooks for completion and hit signalling.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 147,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // Canonical approximate hit frame — visual impact peak.
          // AS has no explicit end() call; we fire signalHit early in the animation.
          13,
          (_clip) => {
            // Signal damage/hit at frame 14 (0-based: 13).
            this.runtime.signalHit();
          },
        ],
        [
          // AS DefineSprite_18/frame_145/DoAction.as: _parent.removeMovieClip()
          // frame_145 → index 144 (0-based).
          144,
          (clip) => {
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
    // AS DefineSprite_17/frame_1/DoAction.as: SOMA.playSound("crockette_214")
    callbacks.playSound("crockette_214");

    // Attach the main anim1 composite at the root so it starts playing.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
