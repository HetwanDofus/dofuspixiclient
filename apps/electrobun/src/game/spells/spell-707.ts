/**
 * Spell 707 — Grina (Sram poison/trap spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/707/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile, no caster reference — single
 * impact animation anchored at the target cell. The manifest has a single
 * `animations[]` entry ("anim1", 24 frames, no librarySymbols[]). The main
 * SWF timeline runs 67 frames; frame_67 does `this.removeMovieClip()` (spell
 * complete). frame_1 plays the sound.
 *
 * Library symbols (from manifest librarySymbols — EMPTY):
 *   None. The only visual content is "anim1" from the animations[] list.
 *
 * DefineSprite analysis:
 *   - DefineSprite_3: single-frame script `gotoAndStop(random(3) + 1)` — a
 *     random variant selector (picks frame 1, 2, or 3). 1-based AS frame
 *     → 0-based runtime: gotoAndStop(random(3)) i.e. 0, 1, or 2.
 *   - DefineSprite_5: trajectory selector. frame_1 picks traj1 randomly;
 *     frame_39 and frame_79 stop; frame_119 stops. All branches resolve to
 *     "traj1" (a == 0, 1, or 2 all goto "traj1"). Since we have no label
 *     map, gotoAndStop("traj1") corresponds to frame_1 (the only authored
 *     label in a simple trajectory symbol), which we model as gotoAndStop(0).
 *   - DefineSprite_8: frame_23 stop() — a 23-frame sub-animation that halts
 *     at the end.
 *
 * These DefineSprites are embedded within the anim1 composite timeline (the
 * manifest marks anim1 as `isComposite: true`). Since they are NOT separate
 * librarySymbols that AS `attachMovie`s by name, and no AS code outside their
 * own DoAction scripts references them by attachMovie calls, they are internal
 * to the pre-rendered composite. The anim1 frames already bake their visuals.
 *
 * Main timeline: 67 frames. frame_1 plays sound; frame_67 removes the clip
 * (spell complete). The anim1 composite has 24 frames (stopFrame=22 means it
 * holds the last rendered frame). We attach anim1 via the SymbolDefinition
 * pattern, with a frameScript at frame 22 (0-based) to call stop(), and rely
 * on the outer 67-frame shell for completion timing.
 *
 * Since there are no attachMovie calls in any script, and the single visual
 * is the anim1 composite rendered animation, we register "anim1" as a symbol
 * (non-library, from animations[]), attach it in onSpellStart, and wire the
 * outer timeline completion to frame 66 (AS frame_67).
 *
 * Hit signal: fired at the first impact frame of anim1 (frame 0, immediately
 * on attach — canonical impact spells signal hit at impact start).
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
  width: 397.95,
  height: 222.8,
  offsetX: -201.35,
  offsetY: -101.8,
};

export class Spell707 extends RuntimeSpell {
  readonly spellId = 707;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 — 24-frame composite impact animation (no lib_ prefix:
    // this symbol comes from animations[], not librarySymbols[]).
    // stopFrame=22 means the canonical AS stops at frame 23 (1-based),
    // i.e. frame index 22 (0-based). DefineSprite_8/frame_23 → stop().
    // The outer main timeline runs 67 frames; frame_67 removes the clip
    // and signals completion.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 24,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS DefineSprite_8/frame_23/DoAction.as: stop()
          // 0-based index 22 = AS frame 23.
          22,
          (clip) => {
            clip.stop();
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
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("grina_707");
    callbacks.playSound("grina_707");

    // Attach anim1 at root (displayType=11: root is already at target cell).
    // We use a wrapper root symbol to host the outer 67-frame timeline that
    // carries the completion frame (frame_67 → removeMovieClip).
    // Since RuntimeSpell's root clip has no authored timeline of its own,
    // we attach anim1 as a child here. The completion is signalled from
    // the root's onEnterFrame counter tracking the outer 67-frame shell.
    const child = this.root.attach(this.anim1Sym, "anim1", 1, context);

    // Signal hit immediately on attach — this is a direct-impact spell
    // with no projectile travel. The canonical impact frame is frame_1
    // (index 0), which is already playing.
    this.runtime.signalHit();

    // Drive the outer 67-frame main-timeline completion counter via the
    // root's onEnterFrame. AS frame_67 → 0-based index 66.
    // We count elapsed ticks on the root clip.
    this.root.vars.outerFrame = 0;
    this.root.onEnterFrame = (_clip, _ctx) => {
      const outerFrame = (this.root.vars.outerFrame as number) + 1;
      this.root.vars.outerFrame = outerFrame;

      // AS scripts/frame_67/DoAction.as: this.removeMovieClip()
      // Outer frame 66 (0-based) = AS frame_67.
      if (outerFrame >= 66) {
        child.remove();
        this.root.onEnterFrame = null;
        this.runtime.complete();
      }
    };
  }
}
