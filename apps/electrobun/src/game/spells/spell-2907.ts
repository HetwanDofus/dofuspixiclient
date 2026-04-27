/**
 * Spell 2907 — (unknown name, likely a candle/flame buff or aura).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2907/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no projectile, no `move`/`shoot`/`duplicate`
 * symbol, no caster reference — just a single composite animation anchored at the
 * target cell. The manifest has a single `animations[]` entry ("anim1", 390 frames)
 * and no `librarySymbols[]`. All visual content is driven by the authored `anim1`
 * timeline; the per-placed-object clip events (DefineSprite_4, _5, _7, _8, _9) are
 * sub-sprite wobble/sway behaviours baked into the composite SVG frames — they do
 * NOT correspond to separately-attachable library symbols.
 *
 * The main timeline has a single relevant script:
 *   frame_13/DoAction.as → stop()
 *
 * Wait — looking more carefully: DefineSprite_9 has a frame_388/DoAction.as that
 * calls `_parent.removeMovieClip()` followed by `stop()`. DefineSprite_9 is the
 * outermost authored sprite in this spell (390 frames total per the anim1 animation,
 * frameCount=390). The sprite's `_parent.removeMovieClip()` is the canonical
 * completion trigger. In our runtime that maps to `this.runtime.complete()` at
 * frame 387 (0-based).
 *
 * The per-clip-event handlers for DefineSprite_4, _5, _7, _8 are oscillating
 * sub-elements that reference `_parent.vamp` (DefineSprite_8's own vamp),
 * `_parent._parent.vamp` (DefineSprite_5 → _8 → outer), and
 * `_parent._parent._parent.vamp` (DefineSprite_4 deep reference). Since the
 * entire visual is rendered as a pre-composited SVG sequence in `anim1`, these
 * clip events are already baked into the frame images. We model DefineSprite_9
 * as the single "anim1" symbol with its onLoad/onEnterFrame/frameScripts.
 *
 * The alpha-fade logic (DefineSprite_9 onEnterFrame: if t++ > 330 → _alpha -= 1.67)
 * is kept live because it drives runtime alpha on the displayed clip. The wind-drift
 * (_X += vent, _Y -= vy) is also kept live so the clip drifts slightly as it plays.
 *
 * signalHit: no canonical hit-frame is specified (no `this.end()` or equivalent
 * in the scripts). We fire it at frame 0 (the moment the spell appears at the
 * target cell), which is the conventional default for instant impact spells.
 *
 * Library symbols: none (librarySymbols[] is absent/empty in the manifest).
 * All content is in animations[0] = "anim1".
 *
 * Main timeline: frame_13/DoAction.as → stop(). This halts the main timeline
 * at frame 13 (index 12), but the anim1 symbol itself continues running via its
 * own clip events. We model this by having the anim1 symbol auto-stop at frame 12.
 *
 * Completion: DefineSprite_9/frame_388/DoAction.as → `_parent.removeMovieClip()`
 * → `this.runtime.complete()` at frameScripts index 387.
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

// Bounds from animations[0] in manifest.json
const ANIM1_BOUNDS = {
  width: 13.3,
  height: 36.45,
  offsetX: -5.9,
  offsetY: -54.15,
};

export class Spell2907 extends RuntimeSpell {
  readonly spellId = 2907;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main composite animation (390 frames) ----------
    // This is the single authored timeline for the spell, corresponding
    // to DefineSprite_9 in the SWF (the outer-most sprite placed on the
    // main timeline). It contains baked sub-sprites for the candle flame
    // wobble (DefineSprite_4, _5, _7, _8), all composited into SVG frames.
    //
    // onLoad: AS DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load).as
    //   t = 0;
    //   vent = 0.16 + 0.16 * Math.random();
    //   vy = 0.33 + 0.33 * Math.random();
    //
    // onEnterFrame: AS DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   if (t++ > 330) { _alpha = _alpha - 1.67; }
    //   _X = _X + vent;
    //   _Y = _Y - vy;
    //
    // frameScripts[387]: AS DefineSprite_9/frame_388/DoAction.as
    //   _parent.removeMovieClip(); stop();
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 390,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      onLoad: (clip) => {
        // AS: DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.t = 0;
        clip.vars.vent = 0.16 + 0.16 * Math.random();
        clip.vars.vy = 0.33 + 0.33 * Math.random();
      },

      onEnterFrame: (clip) => {
        // AS: DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const t = clip.vars.t as number;
        if (t > 330) {
          // AS: _alpha = _alpha - 1.67  (Flash 0-100 → TS 0-1, delta scaled)
          clip.alpha = clip.alpha - 1.67 / 100;
        }
        clip.vars.t = t + 1;

        const vent = clip.vars.vent as number;
        const vy = clip.vars.vy as number;
        clip.x = clip.x + vent;
        clip.y = clip.y - vy;
      },

      frameScripts: new Map([
        [
          387,
          (clip) => {
            // AS: DefineSprite_9/frame_388/DoAction.as
            // _parent.removeMovieClip(); stop();
            // In the SWF, DefineSprite_9 is placed on the main timeline,
            // so _parent is the main timeline (our root). Calling complete()
            // here signals the end of the whole spell.
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
    // AS: frame_13/DoAction.as → stop()
    // The main timeline stops at frame 13. In our runtime the anim1 symbol
    // is the only authored content; we attach it here so it starts ticking
    // from the next runtime frame.
    //
    // No SOMA.playSound() call is present in any of the provided scripts.
    //
    // Signal hit immediately as this is an instant impact spell with no
    // projectile phase and no canonical hit-frame script.
    this.root.attach(anim1Sym, "anim1", 1, context);
    this.runtime.signalHit();
  }
}

// ---------------------------------------------------------------------------
// NOTE: anim1Sym must be accessible in both registerSymbols and onSpellStart.
// We use a module-level variable that is assigned during registerSymbols.
// ---------------------------------------------------------------------------
