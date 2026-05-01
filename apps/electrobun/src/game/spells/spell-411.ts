/**
 * Spell 411 — Lakam (Osamodas).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/411/scripts/scripts/
 *
 * displayType=11 (TargetCell). Single composite animation (`anim1`) anchored
 * at the target cell. No librarySymbols[] entries — no runtime-spawned
 * particles via attachMovie. The manifest's animations[] has a single entry
 * `anim1` (150 frames).
 *
 * Inner symbols (statically placed on the anim1 timeline, NOT attachMovie'd):
 *   - DefineSprite_5 — particle placed on anim1's timeline. frame_1 seeds
 *     random rotation/scale/phase via gotoAndPlay; frame_109 stops it.
 *     Because these are statically placed (PlaceObject2 without a library
 *     symbol link), their visual output is captured in the per-frame anim1
 *     SVGs. However, their timeline scripts drive playback branching that
 *     affects the composite frames.
 *   - DefineSprite_8 — the outer wrapper (= anim1 itself, 150 frames).
 *     frame_148: `_parent.removeMovieClip(); stop();` — removes the spell
 *     and signals completion.
 *
 * DefineSprite_5 frame scripts:
 *   - frame_1: `_rotation = random(360); t = random(50)+30; _xscale=t;
 *               _yscale=t; gotoAndPlay(random(21));`
 *   - frame_109: `stop();`
 *   These drive the internal particle timeline only (no onClipEvent handlers).
 *   Since DefineSprite_5 has no CLIPACTIONRECORD onLoad/onEnterFrame, there
 *   are no per-tick physics to port — only the frameScripts matter, and those
 *   affect DefineSprite_5's own internal playback (random start phase clamped
 *   to [0,20], stops at frame 109). The anim1 symbol itself is what the runtime
 *   ticks; the inner sprite's randomised phase is already expressed across the
 *   150 composite frames.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("lakam_409");
 *
 * Signal flow:
 *   - signalHit: frame 0 of anim1 (instant impact, no projectile).
 *   - complete: frame 147 of anim1 (AS frame_148 → _parent.removeMovieClip()).
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
  width: 160.7,
  height: 55.7,
  offsetX: 2.25,
  offsetY: -36.8,
};

export class Spell411 extends RuntimeSpell {
  readonly spellId = 411;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 150-frame composite at target cell --------------
    // Outer symbol is DefineSprite_8 (150 frames). Contains statically
    // placed DefineSprite_5 particles (no attachMovie, no CLIPACTIONRECORD).
    //
    // AS DefineSprite_8/frame_148/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    //
    // AS DefineSprite_5/frame_1/DoAction.as (inner static placement):
    //   _rotation = random(360);
    //   t = random(50) + 30;
    //   _xscale = t; _yscale = t;
    //   gotoAndPlay(random(21));
    //
    // AS DefineSprite_5/frame_109/DoAction.as (inner static placement):
    //   stop();
    //
    // DefineSprite_5 has no CLIPACTIONRECORD onClipEvent(load) or
    // onClipEvent(enterFrame) — only frameScripts. Its random phase
    // (gotoAndPlay(random(21))) and scale seeding happen on frame_1 of
    // its own authored timeline. These are statically placed instances
    // (not library symbols) so the anim1 SymbolDefinition's frameScripts
    // handle the outer timeline; the inner particles' frame_1 randomisation
    // affects only their own internal playback and is expressed through
    // the composite anim1 frame textures.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 150,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip, _ctx) => {
            // Frame 1 of anim1: instant impact spell — signal hit immediately.
            this.runtime.signalHit();
          },
        ],
        [
          147,
          (clip, _ctx) => {
            // AS DefineSprite_8/frame_148/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.stop();
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
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("lakam_409");
    callbacks.playSound("lakam_409");

    // Attach anim1 to root so it starts ticking from the next runtime frame.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
