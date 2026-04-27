/**
 * Spell 409 — Lakam (Osamodas earth/rock spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/409/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion, no caster
 * reference, no dual anchoring — it's a pure impact animation at the target cell.
 * The single `anim1` animation appears in `animations[]` only (no librarySymbols),
 * confirming a simple TargetCell impact pattern.
 *
 * AS layout:
 *   - Main timeline frame_1: SOMA.playSound("lakam_409")
 *   - DefineSprite_7 (outer wrapper, 150 frames / anim1):
 *       frame_148: _parent.removeMovieClip(); stop();  → complete()
 *   - DefineSprite_5 (particle sub-symbol, 127 frames):
 *       frame_1:   _rotation = -40 - random(100); t = random(50)+30;
 *                  _xscale = _yscale = t; gotoAndPlay(random(21))
 *       frame_31:  SOMA.playSound("lakam_409")
 *       frame_127: stop()
 *
 * The manifest has no `librarySymbols[]` entries. The composite `anim1` animation
 * (150 frames) is the sole authored timeline. DefineSprite_5 is a sub-symbol used
 * internally (likely as animated particles inside anim1); since it never appears
 * in librarySymbols and is never referenced by `attachMovie` in the AS scripts,
 * we treat it as embedded in the composite frames. The sprite_7 wrapper's
 * frame_148 fires _parent.removeMovieClip() — that outer mc removal is what we
 * model as runtime.complete().
 *
 * The main anim1 symbol is registered as "anim1" (bare name, no lib_ prefix)
 * because it only appears in animations[], not librarySymbols[].
 *
 * Signal strategy:
 *   - signalHit: fired at frame_1 of the anim1 clip (impact is immediate for
 *     this type of ground-slam spell).
 *   - complete: fired at frame_148 (AS frame_148 = index 147) where the canonical
 *     _parent.removeMovieClip() + stop() live.
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
  width: 163.1,
  height: 111.65,
  offsetX: 2.1,
  offsetY: -70.7,
};

export class Spell409 extends RuntimeSpell {
  readonly spellId = 409;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — composite impact animation at target cell -------
    // This is the top-level authored timeline (DefineSprite_7 wrapper).
    // AS DefineSprite_7/frame_148/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    // signalHit fires at frame_1 (first visible frame of the impact).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 150,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS: frame_1 of DefineSprite_7 — no explicit script,
            // but this is the canonical impact arrival frame. Signal hit.
            this.runtime.signalHit();
          },
        ],
        [
          147,
          (clip) => {
            // AS DefineSprite_7/frame_148/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
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
    // AS scripts/frame_1/DoAction.as:
    //   SOMA.playSound("lakam_409");
    callbacks.playSound("lakam_409");

    // Attach the main anim1 clip to the root so it starts ticking.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
