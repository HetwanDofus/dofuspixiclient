/**
 * Spell 2050 — Aspiration (unknown class).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2050/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile, no caster reference,
 * no `move`/`shoot`/`duplicate` symbols — it is a single impact animation at the
 * target cell. The outer timeline contains no explicit child attachments other than
 * what the authored sprite timelines provide. There are no `librarySymbols[]` entries
 * in the manifest; the single `animations[]` entry (`anim1`, 66 frames) is the
 * top-level animated content.
 *
 * Canonical AS layout:
 *   - frame_1/DoAction.as         : SOMA.playSound("aspiration")
 *   - DefineSprite_11/frame_1     : per-instance Y randomisation + optional y-flip
 *   - DefineSprite_11/frame_48    : stop()
 *   - DefineSprite_12/frame_64    : stop(); _parent.removeMovieClip() → complete()
 *
 * DefineSprite_12 is the outer container (66-frame timeline driven by `anim1`).
 * Its frame_64 stop + removeMovieClip is the canonical completion signal.
 *
 * DefineSprite_11 is an inner sub-sprite (at least 48 frames) placed on the
 * timeline. Its frame_1 randomly offsets Y and occasionally flips yscale.
 * Since there are no `librarySymbols[]` in the manifest, all symbols are
 * registered against the bare `animations[]` texture key ("anim1"), and the
 * outer timeline itself is the main driving clip.
 *
 * Because `librarySymbols` is empty we model this as a single `anim1` symbol
 * (the whole 66-frame strip) with frame scripts at frames 0 (Y-randomise + flip)
 * and 47 (stop inner) and 63 (stop outer + complete). The `anim1` symbol serves
 * as both DefineSprite_11 (inner) and DefineSprite_12 (outer) logic collapsed
 * onto one registered symbol attached at the root, consistent with how self-buff /
 * shield / aura spells with a single animations[] entry work.
 *
 * signalHit is fired at the first visible frame (frame 0) since there is no
 * dedicated impact frame — the aspiration effect is immediate.
 *
 * Library symbols: none (librarySymbols[] is empty).
 * Main timeline: SOMA.playSound("aspiration").
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
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 — the single animated sprite covering the full 66-frame timeline.
    // Incorporates the behaviour of both DefineSprite_11 (inner sub-sprite,
    // frame_1 Y-randomise + flip, frame_48 stop) and DefineSprite_12 (outer
    // container, frame_64 stop + removeMovieClip → complete).
    // Because librarySymbols[] is empty, textures live under the bare "anim1" key.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 66,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, _ctx) => {
            // AS DefineSprite_11/frame_1/DoAction.as
            // _Y = 20 * (-0.5 + Math.random());
            clip.y = 20 * (-0.5 + Math.random());

            // if (random(4) == 1) { _yscale = -_yscale; }
            if (Math.floor(Math.random() * 4) === 1) {
              clip.scaleY = -clip.scaleY;
            }

            // signalHit at the first visible frame — no dedicated impact frame exists.
            this.runtime.signalHit();
          },
        ],
        [
          47,
          (clip) => {
            // AS DefineSprite_11/frame_48/DoAction.as
            // stop();
            clip.stop();
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

    // Attach the anim1 clip at the root so it starts ticking.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
