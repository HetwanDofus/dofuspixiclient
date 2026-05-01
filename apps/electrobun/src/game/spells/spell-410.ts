/**
 * Spell 410 — Explosion (likely an AOE impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/410/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move`, `shoot`, `duplicate`, or
 * WorldAbsolute dual-anchor pattern. The manifest has a single `anim1`
 * animation (no librarySymbols), and the AS defines two sprites:
 *
 *   - DefineSprite_6 — a single-frame sprite placed multiple times. On
 *     frame_1 it randomises its rotation (0-359°) and scale (30-79%).
 *     At frame_52 it stops. This acts as a rotated/scaled instance of the
 *     `anim1` frames.
 *   - DefineSprite_8 — the outer container, 96 frames. At frame_94 it calls
 *     `_parent.removeMovieClip()`, ending the spell.
 *
 * The manifest has NO librarySymbols array, meaning all textures live in
 * `animations[0]` under the bare name `"anim1"`. DefineSprite_6 is the
 * visual symbol that plays these frames; DefineSprite_8 is its container.
 *
 * Because the manifest's `librarySymbols` is absent (empty), we do NOT
 * use `lib_` prefixes anywhere. The harness attaches nothing automatically
 * for TargetCell — we attach DefineSprite_8 (the outer container) from
 * `onSpellStart`, which in turn holds instances of DefineSprite_6.
 *
 * However, examining the scripts carefully: the main timeline's frame_1
 * only calls `SOMA.playSound("explosion")`. The SWF places DefineSprite_8
 * implicitly on the main timeline. DefineSprite_8's frame_94 fires
 * `_parent.removeMovieClip()` — this removes the outer mc (DefineSprite_8
 * itself from the main timeline), which is the completion signal.
 *
 * DefineSprite_6 is placed one or more times inside DefineSprite_8 by the
 * SWF authoring. Since the manifest lists only one `anim1` animation with
 * 96 frames, DefineSprite_6's textures come from `"anim1"`. We attach a
 * single instance of sprite6 inside sprite8 at depth 1. Its frame_1 script
 * randomises rotation and scale; it plays through and stops at frame 52.
 *
 * signalHit: fired at the first visible impact frame (frame 1 of sprite8,
 * i.e. the moment the explosion begins).
 *
 * Library symbols:
 *   - "sprite6" — visual explosion instance. frame_1 randomises rotation
 *     and scale; frame_52 stops. Textures from "anim1".
 *   - "sprite8" — outer container, 96 frames. frame_1 attaches sprite6 and
 *     signals hit. frame_94 removes self + completes the spell.
 *
 * Main timeline: SOMA.playSound("explosion"); (implicit stop + sprite8 place).
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
  width: 221,
  height: 58.45,
  offsetX: -54.85,
  offsetY: -50.05,
};

export class Spell410 extends RuntimeSpell {
  readonly spellId = 410;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite6Sym!: SymbolDefinition;
  private sprite8Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite6 — rotated/scaled explosion visual ---------------
    // AS DefineSprite_6/frame_1/DoAction.as:
    //   _rotation = random(360);
    //   t = random(50) + 30;
    //   _xscale = t;
    //   _yscale = t;
    // AS DefineSprite_6/frame_52/DoAction.as:
    //   stop();
    this.sprite6Sym = {
      name: "sprite6",
      totalFrames: 96,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            const t = Math.floor(Math.random() * 50) + 30;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
          },
        ],
        [
          51,
          (clip) => {
            // AS DefineSprite_6/frame_52/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite8 — outer container, 96 frames --------------------
    // AS DefineSprite_8/frame_94/DoAction.as:
    //   _parent.removeMovieClip();
    // frame_1: attaches sprite6 and signals hit (explosion onset).
    this.sprite8Sym = {
      name: "sprite8",
      totalFrames: 96,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // frame_1: place the visual explosion instance inside this container.
            clip.attach(this.sprite6Sym, "sprite6_1", 1, ctx);
            // Signal the hit at the moment the explosion first appears.
            this.runtime.signalHit();
          },
        ],
        [
          93,
          (clip) => {
            // AS DefineSprite_8/frame_94/DoAction.as
            // _parent.removeMovieClip() — removes the outer container from
            // the main timeline, which is our completion signal.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite8Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("explosion");
    callbacks.playSound("explosion");
    // Implicit main-timeline placement of sprite8 at depth 1.
    this.root.attach(this.sprite8Sym, "sprite8", 1, context);
  }
}
