/**
 * Spell 1103 — Flûte des Eniripsa (Eniripsa flute heal).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1103/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile, no caster reference, no
 * `move`/`shoot`/`duplicate` symbols. A single impact animation at the
 * target cell. The manifest has no librarySymbols[] entries — all content
 * is driven by the top-level animations[] (sprite_3, sprite_5, sprite_6)
 * placed directly on the main timeline.
 *
 * Main timeline layout:
 *   frame_1/DoAction.as  : SOMA.playSound("aute_1103")
 *   frame_137/DoAction.as: this.end()           → signalHit
 *   frame_159/DoAction.as: this.removeMovieClip() → spell complete
 *
 * Library symbols: none (librarySymbols[] is absent / empty).
 *
 * Authored sprites (from animations[]):
 *   - sprite_3 — 250-frame composite (oscillating circles or glyph, isComposite).
 *                Played on the main timeline for the full duration.
 *   - sprite_5 — 124-frame non-composite sprite (main flute anim).
 *                Played on the main timeline.
 *   - sprite_6 — 48-frame composite. Has its own frame_47 script:
 *                `gotoAndPlay(30)` → loops back to frame 30 (0-based: 29).
 *                Played on the main timeline.
 *
 * The main timeline is a single 159-frame sequence. All three authored
 * sprites are placed as children and tick in parallel. The outer mc
 * drives signalHit at frame 137 and completion at frame 159.
 *
 * Because librarySymbols[] is empty we use bare animation names
 * (no "lib_" prefix) for textures.getFrames().
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

// ---- Manifest bounds for each authored animation -------------------------

const SPRITE_3_BOUNDS = {
  width: 80.5,
  height: 80.5,
  offsetX: -49.55,
  offsetY: -43.45,
};

const SPRITE_5_BOUNDS = {
  width: 233.2,
  height: 108.55,
  offsetX: -114.2,
  offsetY: -51.2,
};

const SPRITE_6_BOUNDS = {
  width: 233.2,
  height: 108.55,
  offsetX: -114.2,
  offsetY: -51.2,
};

export class Spell1103 extends RuntimeSpell {
  readonly spellId = 1103;
  readonly displayType = SpellDisplayType.TargetCell;

  // Symbols held as instance fields so onSpellStart can reference them.
  private sprite3Sym!: SymbolDefinition;
  private sprite5Sym!: SymbolDefinition;
  private sprite6Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE_3_BOUNDS);
    const sprite5Anchor = calculateAnchor(SPRITE_5_BOUNDS);
    const sprite6Anchor = calculateAnchor(SPRITE_6_BOUNDS);

    // ---- sprite_3 — 250-frame composite oscillating glyph ---------------
    // No AS frame scripts for this symbol. Plays through all 250 frames
    // and loops (default Flash behaviour for a clip without stop()).
    // It runs in parallel with the outer timeline; the outer mc removal
    // at frame_159 terminates everything.
    this.sprite3Sym = {
      name: "sprite_3",
      totalFrames: 250,
      frames: textures.getFrames("sprite_3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
    };

    // ---- sprite_5 — 124-frame main flute animation -----------------------
    // No AS frame scripts for this symbol. Plays through 124 frames and
    // then loops. Outer mc termination at frame_159 cleans it up.
    this.sprite5Sym = {
      name: "sprite_5",
      totalFrames: 124,
      frames: textures.getFrames("sprite_5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
    };

    // ---- sprite_6 — 48-frame composite with loop-back script ------------
    // AS: scripts/DefineSprite_6/frame_47/DoAction.as
    //   gotoAndPlay(30);
    // frame_47 (0-based: 46) → gotoAndPlay(30) means AS 1-based frame 30
    // → 0-based index 29. So sprite_6 plays frames 0-46, then loops from
    // frame 29 onward indefinitely until the outer mc removes it.
    this.sprite6Sym = {
      name: "sprite_6",
      totalFrames: 48,
      frames: textures.getFrames("sprite_6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      frameScripts: new Map([
        [
          46,
          (clip) => {
            // AS: DefineSprite_6/frame_47/DoAction.as → gotoAndPlay(30)
            clip.gotoAndPlay(29);
          },
        ],
      ]),
    };

    this.registry.register(this.sprite3Sym);
    this.registry.register(this.sprite5Sym);
    this.registry.register(this.sprite6Sym);

    // ---- Outer "main timeline" container --------------------------------
    // The main SWF timeline drives signalHit at frame 137 and complete at
    // frame 159. We model this as a single long-lived container symbol
    // attached at the root, whose frameScripts carry the canonical actions.
    //
    // The three authored sprites are placed as children of this container
    // at depth 1/2/3 on frame_1 (their placement frames in the authored
    // SWF timeline). Because all placements happen at frame_1 we attach
    // them in the frame_0 script of the container.
    const mainSym: SymbolDefinition = {
      name: "main_timeline",
      totalFrames: 159,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: implicit placement of sprite_3, sprite_5, sprite_6
            // on the main timeline at frame_1.
            clip.attach(this.sprite3Sym, "sprite3", 1, ctx);
            clip.attach(this.sprite5Sym, "sprite5", 2, ctx);
            clip.attach(this.sprite6Sym, "sprite6", 3, ctx);
          },
        ],
        [
          136,
          () => {
            // AS: scripts/frame_137/DoAction.as → this.end()
            this.runtime.signalHit();
          },
        ],
        [
          158,
          (clip) => {
            // AS: scripts/frame_159/DoAction.as → this.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(mainSym);

    // Store for use in onSpellStart.
    this._mainSym = mainSym;
  }

  private _mainSym!: SymbolDefinition;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as → SOMA.playSound("aute_1103")
    callbacks.playSound("aute_1103");

    // Attach the main timeline container at root. The harness has already
    // finished (TargetCell just leaves root at (0,0) relative to the
    // target anchor), so children attached here are positioned correctly.
    this.root.attach(this._mainSym, "main_timeline", 1, context);
  }
}
