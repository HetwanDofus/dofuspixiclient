/**
 * Spell 1103 — Aute (Flûte/Bard-type spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1103/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion, no
 * caster-anchor, no duplicate/beam logic, and no WorldAbsolute dual-anchor
 * pattern. A single animated timeline plays at the target cell. Chosen by
 * elimination: no `move`/`shoot`/`duplicate` symbols, no `cellFrom`/`cellTo`
 * position logic in the scripts, single impact at target → TargetCell.
 *
 * Manifest layout:
 *   - animations[]:
 *       sprite_3  — 250-frame composite animation (isComposite=true)
 *       sprite_5  — 124-frame simple animation
 *       sprite_6  — 48-frame composite animation; has a frame_47 script
 *                   that loops back: gotoAndPlay(30)
 *
 *   - librarySymbols[]: (empty — no attachMovie calls in AS)
 *
 * Main timeline scripts:
 *   frame_1/DoAction.as   → SOMA.playSound("aute_1103")
 *   frame_137/DoAction.as → this.end()  → signalHit
 *   frame_159/DoAction.as → this.removeMovieClip() → spell complete
 *
 * DefineSprite_6/frame_47/DoAction.as → gotoAndPlay(30) on sprite_6's
 * own timeline (loop frames 30-47 indefinitely while the outer timeline
 * runs to frame 159).
 *
 * The manifest has NO librarySymbols entries, so there are NO `lib_`
 * prefixed texture lookups. All animations are registered as top-level
 * symbols using their bare manifest names. The two parallel animated
 * sprites (sprite_3, sprite_5, sprite_6) are placed on the main timeline
 * as authored children — we attach them explicitly in onSpellStart and
 * drive the outer timeline's frame_137/frame_159 callbacks from the
 * sprite_6 symbol (the longest-lived authored piece at 48 frames with
 * an internal loop, outlasting sprite_5's 124 frames within the outer
 * 159-frame timeline).
 *
 * Since the outer mc main timeline carries frame_137 (signalHit) and
 * frame_159 (complete), we model the outer timeline as the root clip's
 * own driving symbol — a 159-frame "outer" symbol that registers those
 * frame callbacks and whose stop/complete signals are fired from there.
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

// Bounds from manifest animations[] entries (no librarySymbols present).
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

    // ---- sprite_3 — 250-frame composite animation at target ------
    // No frame scripts in canonical AS for this symbol.
    this.sprite3Sym = {
      name: "sprite_3",
      totalFrames: 250,
      frames: textures.getFrames("sprite_3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
    };

    // ---- sprite_5 — 124-frame simple animation at target ---------
    // No frame scripts in canonical AS for this symbol.
    this.sprite5Sym = {
      name: "sprite_5",
      totalFrames: 124,
      frames: textures.getFrames("sprite_5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
    };

    // ---- sprite_6 — 48-frame composite animation, loops 30-47 ---
    // AS DefineSprite_6/frame_47/DoAction.as: gotoAndPlay(30)
    // This symbol loops internally between frames 30 and 47 (0-based:
    // 29 and 46) for the lifetime of the outer timeline.
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

    // ---- outer timeline driver — 159-frame root-level container --
    // The main SWF timeline carries frame_137 (this.end → signalHit)
    // and frame_159 (this.removeMovieClip → complete). We model this
    // as a container-only symbol placed on the root so these frame
    // callbacks fire at the right absolute frame counts.
    //
    // The outer mc also implicitly places sprite_3, sprite_5, sprite_6
    // as authored children — those are attached from onSpellStart.
    const outerSym: SymbolDefinition = {
      name: "outer",
      totalFrames: 159,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          136,
          () => {
            // AS: frame_137/DoAction.as → this.end()
            this.runtime.signalHit();
          },
        ],
        [
          158,
          (clip) => {
            // AS: frame_159/DoAction.as → this.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(outerSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: frame_1/DoAction.as → SOMA.playSound("aute_1103")
    callbacks.playSound("aute_1103");

    // Attach the outer timeline driver so frame_137 and frame_159
    // fire at the correct absolute frames.
    const outerSym = this.registry.resolve("outer");
    if (outerSym) {
      this.root.attach(outerSym, "outer", 1, context);
    }

    // Attach the three authored animated children that the main
    // timeline places implicitly as authored PlaceObject entries.
    this.root.attach(this.sprite3Sym, "sprite3", 2, context);
    this.root.attach(this.sprite5Sym, "sprite5", 3, context);
    this.root.attach(this.sprite6Sym, "sprite6", 4, context);
  }
}
