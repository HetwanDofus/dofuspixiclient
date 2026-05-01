/**
 * Spell 816 — Vlad's Punch (displayType=11 TargetCell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/816/scripts/scripts/
 *
 * displayType=11 (TargetCell). Single impact at target cell. No projectile,
 * no caster reference, no move/shoot/duplicate symbols. The animation is
 * a single `anim1` sprite placed at the target. The manifest has no
 * `librarySymbols` — only a top-level `animations` entry named "anim1".
 * This is a self-contained impact animation with multiple internal symbol
 * timelines (DefineSprite_3, _6, _7, _8, _9, _10, _11, _12) that are
 * stitched together by the main-timeline `anim1` composite.
 *
 * AS layout (key actions):
 *   - frame_1/DoAction.as: SOMA.playSound("vlad_806")
 *   - DefineSprite_6 (45 frames): frame_1 plays "punch" + seeds scale-up
 *     animation via onEnterFrame; frame_19 stops.
 *   - DefineSprite_7 (91 frames): t=7; frame_22 signalHit; frame_91 removes.
 *   - DefineSprite_8 (106 frames): t=11; frame_64 signalHit; frame_106 removes.
 *   - DefineSprite_9 (118 frames): t=20; frame_79 signalHit; frame_118 removes.
 *   - DefineSprite_10 (121 frames): t=25; frame_79 signalHit; frame_121 removes.
 *   - DefineSprite_11 (121 frames): t=33; frame_79 signalHit; frame_121 removes.
 *   - DefineSprite_3: random rotation + 50% alpha.
 *   - DefineSprite_12: gotoAndStop(level) — selects level-dependent sub-frame.
 *
 * The longest-lived symbol is DefineSprite_9/10/11 at 121 frames. The outer
 * mc removal is triggered by `_parent._parent.removeMovieClip()` from those
 * final-frame scripts. Since all these are pre-composited into `anim1` frames
 * (isComposite: true), the runtime treats `anim1` as the root timeline.
 *
 * The `anim1` animation has only 5 frames in the manifest, meaning it is a
 * composite but the sub-sprites drive behavior. The `anim1` clip is attached
 * directly to root at depth 1 in onSpellStart. Completion is signalled at
 * the natural end of the anim1 timeline (frame 5 = index 4).
 *
 * signalHit: fired at the earliest canonical hit frame across the sub-sprites.
 * The earliest `this.end()` call is DefineSprite_7/frame_22 (index 21).
 * Since anim1 is composite and we tick via the 5-frame anim1 clip, we fire
 * signalHit at frame index 2 (≈ midpoint, matching the canonical "impact" beat)
 * and complete at frame index 4.
 *
 * Library symbols: none (manifest librarySymbols is absent/empty).
 * Main anim: anim1 (5-frame composite impact at target).
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
  width: 274.25,
  height: 266.5,
  offsetX: -142.8,
  offsetY: -143.15,
};

export class Spell816 extends RuntimeSpell {
  readonly spellId = 816;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 — main impact composite animation at target cell.
    // 5 frames total (manifest: frameCount=5). Plays through the
    // impact burst. signalHit at frame index 2 (canonical hit beat
    // matching DefineSprite_7/frame_22's this.end()). Completion at
    // frame index 4 (last frame, mirroring _parent._parent.removeMovieClip
    // from the longest-lived sub-sprite DefineSprite_10/11 frame_121 mapped
    // proportionally into the 5-frame composite window).
    // AS: scripts/frame_1/DoAction.as → SOMA.playSound("vlad_806") (handled in onSpellStart)
    // AS: DefineSprite_6/frame_1/DoAction.as → SOMA.playSound("punch") (frame index 0)
    // AS: DefineSprite_3/frame_1/DoAction.as → _rotation = random(360); _alpha = 50
    // AS: DefineSprite_12/frame_1/DoAction.as → gotoAndStop(_parent.level)
    // AS: DefineSprite_7/frame_22/DoAction.as → this.end() (hit signal)
    // AS: DefineSprite_9/frame_118/DoAction.as → _parent._parent.removeMovieClip(); stop()
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 5,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, _ctx) => {
            // AS DefineSprite_6/frame_1/DoAction.as: SOMA.playSound("punch")
            // The punch sound fires as this composite frame plays. Captured
            // via the callbacks reference stored in onSpellStart; we cannot
            // call callbacks here directly so we use the stored ref.
            if (this._soundCallback) {
              this._soundCallback("punch");
            }
            // AS DefineSprite_3/frame_1/DoAction.as:
            //   _rotation = random(360); _alpha = 50;
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            clip.alpha = 50 / 100;

            // AS DefineSprite_6/frame_1/DoAction_2.as:
            //   t = random(_parent.t) + _parent.t
            //   _xscale = _yscale = 0
            //   onEnterFrame: _xscale += t; _yscale += t; t /= 1.6
            // _parent.t for DefineSprite_6 comes from the outer composite.
            // Canonical DefineSprite_6/frame_1: t=7 (outer container) but
            // DefineSprite_6 reads _parent.t which is set by DefineSprite_7
            // (t=7). We use t=7 as the seed value matching DefineSprite_7/frame_1.
            const parentT = 7;
            const scaleT = Math.floor(Math.random() * parentT) + parentT;
            clip.scaleX = 0;
            clip.scaleY = 0;
            clip.vars.scaleT = scaleT;
            clip.vars.scaleAnimating = true;
          },
        ],
        [
          2,
          (_clip, _ctx) => {
            // AS DefineSprite_7/frame_22/DoAction.as: this.end()
            // Earliest hit-signal frame across all sub-sprites.
            this.runtime.signalHit();
          },
        ],
        [
          4,
          (clip, _ctx) => {
            // AS DefineSprite_9/frame_118/DoAction.as (and _10/frame_121, _11/frame_121):
            //   _parent._parent.removeMovieClip(); stop();
            // This is the outer mc removal — signal completion.
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
      onEnterFrame: (clip, _ctx) => {
        // AS DefineSprite_6/frame_1/DoAction_2.as onEnterFrame:
        //   _xscale = _xscale + t; _yscale = _yscale + t; t /= 1.6
        if (clip.vars.scaleAnimating) {
          let scaleT = clip.vars.scaleT as number;
          // Convert from Flash percent increments to decimal:
          // clip.scaleX is 0-1, so each step adds (scaleT / 100).
          clip.scaleX = clip.scaleX + scaleT / 100;
          clip.scaleY = clip.scaleY + scaleT / 100;
          scaleT = scaleT / 1.6;
          clip.vars.scaleT = scaleT;
          // Stop animating scale once it's negligible or clip is stopped.
          if (scaleT < 0.01) {
            clip.vars.scaleAnimating = false;
          }
        }
      },
    };

    this.registry.register(this.anim1Sym);
  }

  // Stored reference to the sound callback so frameScripts can fire sounds.
  private _soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("vlad_806")
    callbacks.playSound("vlad_806");

    // Store sound callback for use inside frameScripts (punch sound at frame 0).
    this._soundCallback = callbacks.playSound;

    // Attach the anim1 composite at depth 1 on the root.
    // For displayType=11 (TargetCell), root is already anchored at target cell.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
