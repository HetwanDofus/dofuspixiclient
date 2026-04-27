/**
 * Spell 2906 — (Unknown name, likely a Sacrieur/Eniripsa buff or DoT effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2906/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion, no caster
 * reference, no dual-anchored layout, and no beam/duplicate symbols. The entire
 * animation is a single composite timeline (`anim1`, 390 frames) placed at the
 * target cell. The manifest has NO `librarySymbols[]` entries — all symbols
 * (DefineSprite_9, _8, _7, _5, _4) are internal sub-sprites of the composite
 * `anim1` animation, not independently `attachMovie`d library symbols. The
 * `anim1` animation IS the only content the spell needs to display.
 *
 * AS layout:
 *   - DefineSprite_9 (outer composite, 390 frames):
 *       PlaceObject2_8_1 (sub-sprite, presumably a smoke/particle):
 *         onLoad:  t=0; vent=0.16+0.16*rand; vy=0.33+0.33*rand
 *         onEnterFrame: if t++>330 → fade alpha by 1.67/frame;
 *                       _X += vent; _Y -= vy  (drifts right, rises)
 *       frame_388: _parent.removeMovieClip(); stop()  → spell completion
 *
 *   - DefineSprite_8 (oscillating parent):
 *       PlaceObject2_7_1:
 *         onLoad:  i=0; vamp=0.1*rand
 *         onEnterFrame: _X = 10*sin(i+=vamp)  → horizontal sway
 *
 *   - DefineSprite_7 (child of DefineSprite_8):
 *       PlaceObject2_5_2:
 *         onLoad:  a=1.5
 *         onEnterFrame: _rotation = 10*sin(a += _parent.vamp)
 *                       (_parent here is the DefineSprite_8 instance)
 *
 *   - DefineSprite_5 (child with 2-level vamp reference):
 *       PlaceObject2_4_2:
 *         onLoad:  a=2
 *         onEnterFrame: _rotation = 15*sin(a += _parent._parent.vamp)
 *
 *   - DefineSprite_4 (child with 3-level vamp reference):
 *       PlaceObject2_3_2:
 *         onLoad:  a=5
 *         onEnterFrame: _rotation = 20*sin(a += _parent._parent._parent.vamp)
 *
 *   - Main timeline (frame_13/DoAction.as): stop()
 *     → The main timeline stops at frame 13 (0-based: 12). This is the
 *       canonical "stop and hold" — the spell displays the held frame
 *       until DefineSprite_9's frame_388 fires and removes the outer mc.
 *
 * Because there are NO `librarySymbols[]` in the manifest, and the entire
 * animation is expressed as a single composite `anim1` timeline (390 frames,
 * all pre-rendered into SVG frame images by the exporter), the sub-sprite
 * clip events (DefineSprite_9 etc.) are already baked into the composite
 * frame images. The runtime only needs to:
 *   1. Register `anim1` as a single SymbolDefinition with its 390 frames.
 *   2. Attach it to the root on spell start.
 *   3. Fire signalHit at the canonical impact point (frame 13, where the
 *      main timeline stops — this is the "hit" moment).
 *   4. Fire complete() at the canonical removal frame (frame 388 →
 *      0-based 387, which is also the manifest's `stopFrame`).
 *
 * NOTE: The sub-sprite clip events are internal authored behaviors already
 * composited into the exported frame images. We do NOT need to re-implement
 * them as separate SymbolDefinitions because there are no `attachMovie` calls
 * for them in the AS — they are PlaceObject2 (statically placed on the
 * authored timeline) sub-clips, not dynamically attached library symbols.
 * The exporter has rendered all their visual contributions into `anim1_N.svg`.
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
  width: 13.3,
  height: 36.45,
  offsetX: -5.9,
  offsetY: -54.15,
};

export class Spell2906 extends RuntimeSpell {
  readonly spellId = 2906;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 — the single composite animation (390 frames, pre-rendered).
    // All sub-sprite clip events (DefineSprite_9/_8/_7/_5/_4) are baked
    // into the exported SVG frames by the exporter; no separate library
    // symbols are needed.
    //
    // frame_13/DoAction.as: stop()  → main timeline holds at frame 12 (0-based)
    // DefineSprite_9/frame_388/DoAction.as: _parent.removeMovieClip(); stop()
    //   → 0-based frame 387 = manifest stopFrame — signals completion.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 390,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS frame_13/DoAction.as: stop()
          // The main timeline stops here — this is the "settled" impact point.
          12,
          (_clip) => {
            // Canonical main timeline stop at frame 13 (0-based: 12).
            // Signal hit at the moment the animation settles.
            this.runtime.signalHit();
            // Do NOT call clip.stop() — the composite continues playing
            // its internal sub-sprite animations (baked into the frames).
            // The anim1 clip itself must keep advancing through all 390
            // frames so that frame_387 (DefineSprite_9/frame_388) fires.
          },
        ],
        [
          // DefineSprite_9/frame_388/DoAction.as: _parent.removeMovieClip(); stop()
          // 0-based: frame 387 (= manifest stopFrame).
          387,
          (clip) => {
            // _parent.removeMovieClip() — remove the anim1 clip and signal
            // that the spell is complete.
            clip.remove();
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
    // Main timeline has no SOMA.playSound() call for this spell.
    // The manifest lists no sounds[]. Simply attach anim1 to the root
    // so it starts ticking from the next runtime frame.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
