/**
 * Spell 1007 — Herbe (grass/nature impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1007/scripts/scripts/
 *
 * displayType=11 (TargetCell). Single impact animation at the target cell.
 * No projectile, no caster reference, no dual-anchor. The outermost
 * DefineSprite_14 drives a 295-frame timeline with periodic "herbe" sounds
 * and a signalHit at frame 178. DefineSprite_12 is a decorative sub-sprite
 * that randomises its start frame and scale on load. DefineSprite_8 is
 * another sub-sprite that randomly jumps to frame 20 (80% chance) or plays
 * from frame 1 (20% chance), stopping at frame 55.
 *
 * Library symbols:
 *   - anim1 (DefineSprite_14) — 297-frame outer container. frame_1 plays
 *     "herbe"; frame_58 plays "herbe"; frame_121 plays "herbe"; frame_178
 *     fires signalHit (this.end()); frame_184 plays "herbe"; frame_295
 *     removes self and completes the spell.
 *   - DefineSprite_12 — decorative leaf/sprite. frame_1: gotoAndPlay(random(40)+1),
 *     random alpha [30,80]%, random scale [30,150] (xscale=t, yscale=t/2).
 *     frame_289: stop().
 *   - DefineSprite_8 — small variant sprite. frame_1: 80% chance gotoAndStop(20),
 *     else plays from 1. frame_55: stop().
 *
 * Main timeline: single anim1 animation placed on the root at the target cell.
 * The manifest shows `librarySymbols` is empty, so `anim1` is in `animations[]`
 * and uses bare key "anim1" (no lib_ prefix). The sounds in the manifest
 * match the frame scripts on DefineSprite_14 — we drive them from frameScripts
 * rather than from onSpellStart to keep them in sync with the timeline.
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
  width: 95.1,
  height: 38.1,
  offsetX: -49.25,
  offsetY: -17.05,
};

export class Spell1007 extends RuntimeSpell {
  readonly spellId = 1007;
  readonly displayType = SpellDisplayType.TargetCell;

  private callbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ---- DefineSprite_8 — small variant sprite --------------------
    // AS DefineSprite_8/frame_1/DoAction.as:
    //   if (random(5) != 1) { gotoAndStop(20); }
    // AS DefineSprite_8/frame_55/DoAction.as:
    //   stop();
    const sprite8Sym: SymbolDefinition = {
      name: "sprite8",
      totalFrames: 55,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_8/frame_1/DoAction.as
            if (Math.floor(Math.random() * 5) !== 1) {
              clip.gotoAndStop(19); // gotoAndStop(20) → 0-based = 19
            }
          },
        ],
        [
          54,
          (clip) => {
            // AS DefineSprite_8/frame_55/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_12 — decorative leaf sub-sprite -------------
    // AS DefineSprite_12/frame_1/DoAction.as:
    //   gotoAndPlay(random(40) + 1);
    //   _alpha = 30 + random(50);
    //   t = 30 + random(120);
    //   _xscale = t;
    //   _yscale = t / 2;
    // AS DefineSprite_12/frame_289/DoAction.as:
    //   stop();
    const sprite12Sym: SymbolDefinition = {
      name: "sprite12",
      totalFrames: 289,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_12/frame_1/DoAction.as
            const targetFrame = Math.floor(Math.random() * 40); // random(40)+1 → 0-based = random(40)
            clip.gotoAndPlay(targetFrame);
            clip.alpha = (30 + Math.floor(Math.random() * 50)) / 100;
            const t = 30 + Math.floor(Math.random() * 120);
            clip.scaleX = t / 100;
            clip.scaleY = (t / 2) / 100;
          },
        ],
        [
          288,
          (clip) => {
            // AS DefineSprite_12/frame_289/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- anim1 (DefineSprite_14) — outer 297-frame container -----
    // AS DefineSprite_14/frame_1/DoAction.as:  SOMA.playSound("herbe");
    // AS DefineSprite_14/frame_58/DoAction.as: SOMA.playSound("herbe");
    // AS DefineSprite_14/frame_121/DoAction.as: SOMA.playSound("herbe");
    // AS DefineSprite_14/frame_178/DoAction.as: this.end(); → signalHit
    // AS DefineSprite_14/frame_184/DoAction.as: SOMA.playSound("herbe");
    // AS DefineSprite_14/frame_295/DoAction.as: _parent.removeMovieClip(); stop();
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 297,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_14/frame_1/DoAction.as
            this.callbacks?.playSound("herbe");
          },
        ],
        [
          57,
          (_clip) => {
            // AS DefineSprite_14/frame_58/DoAction.as
            this.callbacks?.playSound("herbe");
          },
        ],
        [
          120,
          (_clip) => {
            // AS DefineSprite_14/frame_121/DoAction.as
            this.callbacks?.playSound("herbe");
          },
        ],
        [
          177,
          (_clip) => {
            // AS DefineSprite_14/frame_178/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          183,
          (_clip) => {
            // AS DefineSprite_14/frame_184/DoAction.as
            this.callbacks?.playSound("herbe");
          },
        ],
        [
          294,
          (clip) => {
            // AS DefineSprite_14/frame_295/DoAction.as
            // _parent.removeMovieClip() — remove the outer mc and complete
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite8Sym);
    this.registry.register(sprite12Sym);
    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Store callbacks so frame scripts can fire sounds.
    this.callbacks = callbacks;

    // Attach the main anim1 timeline to root. The harness has already
    // positioned root at the target cell (displayType=11 TargetCell).
    // The anim1 frame_1 script will fire immediately and play "herbe".
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
