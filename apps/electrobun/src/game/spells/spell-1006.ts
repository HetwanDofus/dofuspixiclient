/**
 * Spell 1006 — (Unknown name, likely a Cra or similar class spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1006/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion, no caster
 * reference, no dual-anchored layout, and no library symbols used via attachMovie
 * with separate CLIPACTIONRECORD handlers. It is a single composite animation
 * anchored at the target cell. The manifest has a single `animations[]` entry
 * ("anim1", 130 frames, isComposite=true) and NO `librarySymbols[]` entries.
 *
 * AS layout:
 *   - DefineSprite_5 — "anim1" main animation clip, 149 authored frames.
 *       frame_1:  gotoAndPlay(random(15) + 1)  → randomises start frame.
 *       frame_149: stop()
 *   - DefineSprite_37 — outer container.
 *       frame_97:  this.end()  → signalHit (damage popup).
 *       frame_129: _parent.removeMovieClip(); stop()  → spell complete.
 *
 * Library symbols: none (librarySymbols[] is absent/empty).
 * Main timeline: attaches DefineSprite_37 at depth 1 (= the outer container),
 *   which itself contains the anim1 sprite (DefineSprite_5).
 *
 * Since no `librarySymbols[]` are present in the manifest, textures for the
 * animation are accessed WITHOUT a `lib_` prefix: `textures.getFrames("anim1")`.
 *
 * The `anim1` symbol has 130 exported frames (indices 0–129). The authored
 * DefineSprite_5 has 149 frames but the exporter stops at 129 (stopFrame=128
 * in manifest, 0-based). We clamp totalFrames to 130 accordingly.
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
  width: 96.75,
  height: 76.1,
  offsetX: -36.1,
  offsetY: -64.2,
};

export class Spell1006 extends RuntimeSpell {
  readonly spellId = 1006;
  readonly displayType = SpellDisplayType.TargetCell;

  private outerSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 (DefineSprite_5) — main animation clip -----------
    // AS DefineSprite_5/frame_1/DoAction.as:
    //   gotoAndPlay(random(15) + 1);
    // AS DefineSprite_5/frame_149/DoAction.as:
    //   stop();
    // The exporter exports 130 frames (0-based indices 0–129).
    // frame_149 (0-based 148) is beyond the 130 exported frames so
    // we rely on the outer container's frame_129 for completion
    // instead. The sprite loops by default; frame_1 randomises
    // the entry point in [1..15] (0-based [0..14]).
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 130,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_5/frame_1/DoAction.as:
            //   gotoAndPlay(random(15) + 1);
            const target = Math.floor(Math.random() * 15) + 1;
            clip.gotoAndPlay(target - 1);
          },
        ],
      ]),
    };

    // ---- outer container (DefineSprite_37) ----------------------
    // AS DefineSprite_37/frame_97/DoAction.as:
    //   this.end();   → signalHit
    // AS DefineSprite_37/frame_129/DoAction.as:
    //   _parent.removeMovieClip(); stop();  → spell complete
    this.outerSym = {
      name: "outer",
      totalFrames: 129,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // frame_1 of DefineSprite_37: attach the anim1 sprite at depth 1.
            clip.attach(anim1Sym, "anim1", 1, ctx);
          },
        ],
        [
          96,
          () => {
            // AS DefineSprite_37/frame_97/DoAction.as:
            //   this.end();  → signal hit (damage popup at target)
            this.runtime.signalHit();
          },
        ],
        [
          128,
          (clip) => {
            // AS DefineSprite_37/frame_129/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
    this.registry.register(this.outerSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline frame_1: attach the outer container at depth 1.
    // No sound found in the canonical AS for this spell.
    this.root.attach(this.outerSym, "outer", 1, context);
  }
}
