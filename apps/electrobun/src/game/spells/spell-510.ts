/**
 * Spell 510 — Lance (Feca lance spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/510/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no `move`, `shoot`, `duplicate`,
 * or `_parent.cellFrom`/`cellTo` traversals — it is a single impact animation
 * anchored at the target cell. The outer sprite (DefineSprite_9) plays a 73-frame
 * timeline, fires `_parent.removeMovieClip()` at frame 73, and plays the "lance"
 * sound at frame 1. The manifest has no `librarySymbols[]` entries — only a
 * single `animations: [{name: "anim1", frameCount: 75}]` entry. DefineSprite_9
 * wraps the `anim1` content; DefineSprite_6 and DefineSprite_8 are sub-symbols
 * referenced inside `anim1`'s authored composite frames (their scripts drive
 * visibility flicker and staggered playhead entry). Since `librarySymbols` is
 * empty, we use the bare `"anim1"` key for `textures.getFrames`.
 *
 * Library symbols (all from animations[], NOT librarySymbols[]):
 *   - anim1 — 75-frame composite animation. Wraps DefineSprite_9 (outer 73-frame
 *     container). frame_1 plays sound "lance". frame_73 calls
 *     `_parent.removeMovieClip()` → `this.runtime.complete()`.
 *     DefineSprite_6 sub-symbol (52-frame, visibility flicker):
 *       onLoad: _visible = false.
 *       onEnterFrame: _visible = false; if random(20)==1 _visible = true.
 *       frame_52: stop().
 *     DefineSprite_8 sub-symbol (multi-instance staggered start via onLoad):
 *       PlaceObject2_7_1/onLoad: gotoAndPlay(random(6)+2)
 *       PlaceObject2_7_3/onLoad: gotoAndPlay(random(9)+3)
 *       PlaceObject2_7_5/onLoad: gotoAndPlay(random(6)+5)
 *       PlaceObject2_7_7/onLoad: gotoAndPlay(random(9)+2)
 *     The staggered instances are baked into the composite `anim1` frames;
 *     we model them as authored frame-texture playback.
 *
 * Main timeline: sound "lance" fires from DefineSprite_9/frame_1. Completion
 * fires from DefineSprite_9/frame_73 via `_parent.removeMovieClip()`.
 *
 * Since `librarySymbols` is empty, the entire visual is driven by the `anim1`
 * composite animation registered as a single SymbolDefinition. The outer
 * DefineSprite_9 script actions (sound + removal) are modelled as frameScripts
 * on the anim1 symbol. signalHit is fired at the first frame (frame 0 / impact
 * is immediate for a target-cell impact spell with no projectile phase).
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
  width: 421.35,
  height: 23.15,
  offsetX: -20.9,
  offsetY: -14.3,
};

export class Spell510 extends RuntimeSpell {
  readonly spellId = 510;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 — the single composite animation for this spell.
    // Canonical outer timeline: DefineSprite_9 (73 frames).
    //   frame_1/DoAction.as: SOMA.playSound("lance")  → handled in onSpellStart.
    //   frame_73/DoAction.as: this._parent.removeMovieClip() → complete().
    //
    // The manifest lists 75 frames for anim1; DefineSprite_9 has 73 authored
    // frames. We use the full 75-frame texture sequence from the asset and fire
    // the completion/hit signals at the canonical AS frame indices (0-based).
    //
    // signalHit: no projectile phase → fire immediately at frame 0 (impact
    // is the entire animation for a TargetCell spell).
    //
    // DefineSprite_6 sub-symbol visibility flicker and DefineSprite_8
    // staggered-playhead instances are baked into the composite SVG frames
    // by the exporter, so we do not need to model them as separate clips.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 75,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_9/frame_1/DoAction.as: SOMA.playSound("lance")
            // Sound is played in onSpellStart; signalHit fires here (frame 0 =
            // immediate impact at target cell, no projectile travel).
            this.runtime.signalHit();
          },
        ],
        [
          72,
          (clip) => {
            // AS DefineSprite_9/frame_73/DoAction.as:
            //   this._parent.removeMovieClip();
            // frame_73 (1-based) → frameScripts index 72 (0-based).
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
    // AS DefineSprite_9/frame_1/DoAction.as: SOMA.playSound("lance")
    callbacks.playSound("lance");

    // Attach the anim1 clip at the root so it starts playing immediately.
    // For displayType=11 (TargetCell) the container is already positioned
    // at the target cell by the harness/spell-view, so placing anim1 at
    // root local (0,0) is canonical.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
