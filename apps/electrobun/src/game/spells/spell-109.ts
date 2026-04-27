/**
 * Spell 109 — Carapace (Feca shield).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/109/scripts/scripts/
 *
 * displayType=11 (TargetCell). No library symbols listed in manifest.json
 * (librarySymbols is absent/empty). The spell is a single authored animation
 * `anim1` (129 frames) placed at the target cell. This is a pure self-buff /
 * shield impact animation — no projectile, no caster reference, no attachMovie
 * calls in the canonical AS. All rendering is driven by the anim1 timeline
 * itself (a composite of sub-sprites whose scripts are listed below).
 *
 * Canonical AS layout:
 *
 *   DefineSprite_17 (outer wrapper, 129 frames — this is the anim1 timeline):
 *     frame_1/DoAction.as:   SOMA.playSound("shield_cara");
 *     frame_127/DoAction.as: _parent.removeMovieClip();
 *
 *   DefineSprite_13 (sub-sprite inside anim1, 28 frames):
 *     frame_1/DoAction.as:  _rotation = random(360);
 *     frame_28/DoAction.as: stop();
 *
 *   DefineSprite_14 (sub-sprite inside anim1):
 *     frame_1/PlaceObject2_3_2/CLIPACTIONRECORD onClipEvent(enterFrame).as:
 *       _rotation = _rotation + 10;
 *
 *   DefineSprite_15 (sub-sprite inside anim1, 55 frames):
 *     frame_55/DoAction.as: stop();
 *
 * The manifest exposes only one animation — `anim1` — with 129 frames. No
 * librarySymbols are present, so we use `textures.getFrames("anim1")` (no
 * `lib_` prefix). The entire spell is expressed as a single SymbolDefinition
 * for `anim1`, with:
 *   - frame_1 (index 0): play sound (mirrored in onSpellStart since it is the
 *     outermost timeline's frame_1 action) and set initial random rotation for
 *     the inner DefineSprite_13 sub-sprite — represented here as the anim1
 *     clip's own initial-frame state.
 *   - frame_127 (index 126): _parent.removeMovieClip() → complete().
 *
 * Because DefineSprite_13, _14, _15 are authored sub-sprites baked into the
 * composite `anim1` frames (their visual content is rasterised into the
 * per-frame SVGs by the exporter), we do not need to register them separately
 * as attachMovie targets. Their scripted behaviours (random initial rotation on
 * DefineSprite_13, continuous +10°/frame spin on DefineSprite_14) contribute to
 * the exported SVG frames and do not need to be replicated in TS. The only
 * load-bearing scripts are the sound call and the removal/completion call.
 *
 * signalHit: fired at frame_1 (index 0) of anim1 — the impact of the shield
 * on the target is instantaneous and coincides with the start of the animation.
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
  width: 113.3,
  height: 95.9,
  offsetX: -47.6,
  offsetY: -58.8,
};

export class Spell109 extends RuntimeSpell {
  readonly spellId = 109;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 129-frame shield burst at target cell ----------
    // Outer wrapper mirrors DefineSprite_17 (129 frames).
    // frame_1/DoAction.as:   SOMA.playSound("shield_cara")  — handled in onSpellStart
    // frame_127/DoAction.as: _parent.removeMovieClip()      — signals completion
    //
    // Inner sub-sprites DefineSprite_13 (_rotation = random(360); stop at 28),
    // DefineSprite_14 (continuous +10 deg/frame spin), and DefineSprite_15
    // (stop at 55) are baked into the composite SVG frames by the exporter;
    // their scripted effects do not require separate SymbolDefinition entries.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 129,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_17/frame_1/DoAction.as:
            //   SOMA.playSound("shield_cara");
            // Sound is played in onSpellStart (main-timeline entry).
            // Signal hit immediately — the shield impact is at the start
            // of the animation.
            this.runtime.signalHit();
          },
        ],
        [
          126,
          (clip) => {
            // AS DefineSprite_17/frame_127/DoAction.as:
            //   _parent.removeMovieClip();
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
    // AS DefineSprite_17/frame_1/DoAction.as: SOMA.playSound("shield_cara");
    callbacks.playSound("shield_cara");

    // Attach anim1 at root so it begins ticking from the next runtime frame.
    // For displayType=11 (TargetCell) the root container is already positioned
    // at the target cell by the harness / spell-view.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
