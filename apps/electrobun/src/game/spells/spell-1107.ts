/**
 * Spell 1107 — (Unknown spell, likely a self-buff or aura effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1107/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile symbols (move/shoot/duplicate),
 * no _parent.cellFrom / _parent.cellTo positioning, no caster-side anchor.
 * The spell places its content at the target cell. The main timeline runs
 * 238 frames total; frame_205 calls `this.end()` (signalHit) and frame_238
 * calls `this.removeMovieClip()` (complete).
 *
 * The manifest has NO librarySymbols[], so there are no `lib_` prefixed
 * textures. Two animations are present:
 *   - sprite_5  — 210-frame outer visual (the main aura/impact ring)
 *   - sprite_18 — 39-frame looping inner detail; frame_1 jumps to a random
 *                 frame in [0,29] for varied phase; frame_37 loops back to
 *                 frame 6 (AS `gotoAndPlay(6)` → 0-based frame 5).
 *
 * The outer main timeline uses sprite_5 directly as its authored visual
 * (210 frames placed on the main 238-frame timeline). sprite_18 is a
 * separately authored DefineSprite placed inside the composition.
 *
 * Since there are no librarySymbols[] and both animations appear in the
 * top-level animations[] list, textures are accessed without the `lib_`
 * prefix. Both symbols are attached in onSpellStart, mirroring their
 * implicit placement on the canonical main timeline frame_1.
 *
 * Main timeline script summary:
 *   frame_1/DoAction.as   : SOMA.playSound("autre_1107")
 *   frame_205/DoAction.as : this.end()             → signalHit
 *   frame_238/DoAction.as : this.removeMovieClip() → complete
 *
 * DefineSprite_18 scripts:
 *   frame_1/DoAction.as   : gotoAndPlay(random(30))   → random start phase
 *   frame_37/DoAction.as  : gotoAndPlay(6)            → loop from frame 6
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

const SPRITE_5_BOUNDS = {
  width: 125.7,
  height: 125.7,
  offsetX: -72.15,
  offsetY: -66.05,
};

const SPRITE_18_BOUNDS = {
  width: 63.55,
  height: 43.9,
  offsetX: -28.55,
  offsetY: -25.6,
};

export class Spell1107 extends RuntimeSpell {
  readonly spellId = 1107;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite5Sym!: SymbolDefinition;
  private sprite18Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite5Anchor = calculateAnchor(SPRITE_5_BOUNDS);
    const sprite18Anchor = calculateAnchor(SPRITE_18_BOUNDS);

    // ---- sprite_18 — looping inner detail (39 frames) ------------
    // AS DefineSprite_18/frame_1/DoAction.as:
    //   gotoAndPlay(random(30));
    // AS DefineSprite_18/frame_37/DoAction.as:
    //   gotoAndPlay(6);
    this.sprite18Sym = {
      name: "sprite_18",
      totalFrames: 39,
      frames: textures.getFrames("sprite_18"),
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_18/frame_1/DoAction.as: gotoAndPlay(random(30))
            // random(30) → [0, 29] → gotoAndPlay target is 1-based in AS
            // so result in [1, 30] → 0-based [0, 29]
            const targetAS = Math.floor(Math.random() * 30) + 1;
            clip.gotoAndPlay(targetAS - 1);
          },
        ],
        [
          36,
          (clip) => {
            // AS DefineSprite_18/frame_37/DoAction.as: gotoAndPlay(6)
            clip.gotoAndPlay(5);
          },
        ],
      ]),
    };

    // ---- sprite_5 — main 210-frame outer visual ------------------
    // The main timeline's frame_205 and frame_238 scripts are handled
    // at the root level (via the sprite_5 symbol's frameScripts), since
    // sprite_5 is the primary authored content placed on the timeline.
    // frame_205: this.end()             → signalHit
    // frame_238 is beyond sprite_5's 210 frames, so it is handled on
    // the root container's own timeline by attaching sprite_5 as a
    // child and wiring a wrapper symbol that covers the full 238 frames.
    //
    // However, since the outer main timeline IS the spell's root clip
    // (not a child symbol), we model it differently: sprite_5 covers
    // frames 0-209 (210 total). The main timeline's frame_205 and
    // frame_238 live outside sprite_5's authored length, meaning they
    // belong to the root's own timeline orchestration.
    //
    // We model this as a root-level wrapper symbol (sprite_5 used as a
    // 210-frame sub-clip attached at root) plus a separate root-timeline
    // symbol that carries the completion scripts at frames 204 and 237.
    // The simplest correct approach: use sprite_5 as the visual, and
    // attach a separate "root_timeline" container symbol to the root
    // that drives signalHit at frame 204 (AS frame_205) and complete
    // at frame 237 (AS frame_238).
    //
    // AS frame_205/DoAction.as: this.end() → signalHit
    // AS frame_238/DoAction.as: this.removeMovieClip() → complete
    this.sprite5Sym = {
      name: "sprite_5",
      totalFrames: 210,
      frames: textures.getFrames("sprite_5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
    };

    // ---- root_timeline — 238-frame container with completion scripts
    // This symbol mirrors the canonical main SWF timeline which is
    // 238 frames long. It carries no visual content of its own —
    // sprite_5 and sprite_18 are children. Its frameScripts handle the
    // canonical frame_205 (signalHit) and frame_238 (complete) actions.
    const rootTimelineSym: SymbolDefinition = {
      name: "root_timeline",
      totalFrames: 238,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          204,
          (_clip) => {
            // AS scripts/frame_205/DoAction.as: this.end()
            this.runtime.signalHit();
          },
        ],
        [
          237,
          (clip) => {
            // AS scripts/frame_238/DoAction.as: this.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite18Sym);
    this.registry.register(this.sprite5Sym);
    this.registry.register(rootTimelineSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("autre_1107")
    callbacks.playSound("autre_1107");

    // Attach the root timeline container which drives signalHit + complete.
    // Then attach sprite_5 (main visual) and sprite_18 (looping detail)
    // as children of the root, mirroring their implicit placement on the
    // canonical main timeline frame_1.
    const rootTimelineSym = this.registry.resolve("root_timeline");
    if (rootTimelineSym) {
      const rootTl = this.root.attach(rootTimelineSym, "root_timeline", 1, context);
      // Attach the main visual inside the root timeline container.
      rootTl.attach(this.sprite5Sym, "sprite_5", 1, context);
      // Attach the looping inner detail inside the root timeline container.
      rootTl.attach(this.sprite18Sym, "sprite_18", 2, context);
    }
  }
}
