/**
 * Spell 2050 — Aspiration (Xelor / Cra capture beam).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2050/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The animation is a single wide horizontal
 * beam (`anim1`, 66 frames) that stretches from caster toward the target.
 * There are no library symbols with `attachMovie` calls — the two DefineSprite
 * nodes (11 and 12) ARE the `anim1` composite timeline itself:
 *
 *   - DefineSprite_11 (inner sprite, tracks the beam body):
 *       frame_1:  randomise Y position ±10 px; 25% chance flip yscale.
 *       frame_48: stop().
 *
 *   - DefineSprite_12 (outer container, the anim1 root):
 *       frame_64: stop() + _parent.removeMovieClip() → signals spell complete.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("aspiration").
 *
 * librarySymbols[] is empty in the manifest — no `lib_` prefix anywhere.
 * The single `anim1` animation entry drives the whole visual.
 *
 * signalHit: fired at frame_48 (canonical stop / peak of the beam).
 * complete:  fired at frame_64 (canonical _parent.removeMovieClip).
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
  width: 489.85,
  height: 32.75,
  offsetX: -4.4,
  offsetY: -15.5,
};

export class Spell2050 extends RuntimeSpell {
  readonly spellId = 2050;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // `anim1` is the sole animation in the manifest (librarySymbols[] is
    // empty). DefineSprite_12 wraps DefineSprite_11; their frame scripts
    // are folded into this single SymbolDefinition because the runtime
    // attaches one clip from onSpellStart and the scripts interact across
    // the 66-frame timeline.
    //
    // No `lib_` prefix — this entry lives in animations[], not
    // librarySymbols[].
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 66,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_11/frame_1/DoAction.as
            // _Y = 20 * (-0.5 + Math.random());
            // if (random(4) == 1) { _yscale = -_yscale; }
            clip.y = 20 * (-0.5 + Math.random());
            if (Math.floor(Math.random() * 4) === 1) {
              clip.scaleY = -clip.scaleY;
            }
          },
        ],
        [
          47,
          (clip) => {
            // AS DefineSprite_11/frame_48/DoAction.as
            // stop();
            clip.stop();
            // Beam has reached full compression — signal hit at this
            // canonical peak frame.
            this.runtime.signalHit();
          },
        ],
        [
          63,
          (clip) => {
            // AS DefineSprite_12/frame_64/DoAction.as
            // stop();
            // this._parent.removeMovieClip();
            clip.stop();
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
    // AS frame_1/DoAction.as: SOMA.playSound("aspiration");
    callbacks.playSound("aspiration");

    // Attach the main beam clip at root depth 1. The harness has already
    // rotated the root container to face the target (ProjectileLinear),
    // so the beam stretches naturally along the caster→target axis.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
