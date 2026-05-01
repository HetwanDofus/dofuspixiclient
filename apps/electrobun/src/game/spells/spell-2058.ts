/**
 * Spell 2058 — (Unknown name, likely a nature/thorn spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2058/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile, no caster reference,
 * no `move`/`shoot`/`duplicate` symbols, and no `_parent.cellFrom`/`cellTo`
 * positioning logic. It is a single impact animation at the target cell.
 *
 * Canonical AS layout:
 *   - DefineSprite_8 — main spell sprite (61 frames):
 *       frame_1:  SOMA.playSound("herbe")
 *       frame_22: SOMA.playSound("pic")
 *       frame_37: SOMA.playSound("pic")
 *       frame_61: _parent.removeMovieClip(); stop() → spell complete
 *
 *   - DefineSprite_2 — sub-sprite with 16-frame timeline:
 *       frame_16: stop()
 *
 * The manifest has no librarySymbols[] entries — all content is in top-level
 * animations[] (anim1, anim5, anim9, anim19, anim23). No `lib_` prefix.
 *
 * Looking at the animations:
 *   - anim9 has 75 frames (stopFrame=60) and is the largest — this is the
 *     main DefineSprite_8 body animation.
 *   - anim1, anim5, anim19, anim23 are 18-frame clips (stopFrame=15) —
 *     these correspond to DefineSprite_2 (or sub-placements).
 *
 * The main sprite (DefineSprite_8) controls the whole spell lifecycle.
 * We register it as a symbol and attach it from onSpellStart.
 * DefineSprite_2 (stop at frame 16) is a sub-symbol used inside DefineSprite_8.
 *
 * Sounds:
 *   - frame 0  (manifest sound): "herbe"  → AS frame_1
 *   - frame 21 (manifest sound): "pic"    → AS frame_22
 *   - frame 36 (manifest sound): "pic"    → AS frame_37
 *
 * Main timeline: no explicit frame_1 script on the outer SWF main timeline
 * (sounds are inside DefineSprite_8 itself). We attach DefineSprite_8 from
 * onSpellStart and the first-frame script handles the sound + sub-attach.
 *
 * signalHit: fired at frame_22 (first "pic" impact sound).
 * complete:  fired at frame_61 (_parent.removeMovieClip()).
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

// Bounds from manifest animations[] entries (no lib_ prefix — no librarySymbols[])
const ANIM9_BOUNDS = {
  width: 76.1,
  height: 96.1,
  offsetX: -38.75,
  offsetY: -61.05,
};

const ANIM1_BOUNDS = {
  width: 25.6,
  height: 15.25,
  offsetX: -9.15,
  offsetY: -15.4,
};

export class Spell2058 extends RuntimeSpell {
  readonly spellId = 2058;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite8Sym!: SymbolDefinition;
  private sprite2Sym!: SymbolDefinition;

  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim9Anchor = calculateAnchor(ANIM9_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- DefineSprite_2 — 16-frame sub-sprite, stops at frame 16 ----
    // AS DefineSprite_2/frame_16/DoAction.as: stop()
    // Uses anim1 texture (18-frame strip; we use first 16 for the authored 16-frame timeline).
    // The manifest lists anim1, anim5, anim19, anim23 as 18-frame animations.
    // DefineSprite_2 has 16 authored frames (stopFrame=15 in the anim1 entry).
    // We use anim1 as the primary texture for this sub-symbol.
    const anim1Frames = textures.getFrames("anim1");
    this.sprite2Sym = {
      name: "sprite2",
      totalFrames: 16,
      frames: anim1Frames.slice(0, 16),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          15,
          (clip) => {
            // AS DefineSprite_2/frame_16/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_8 — main 61-frame spell sprite ---------------
    // AS frame_1:  SOMA.playSound("herbe")
    // AS frame_22: SOMA.playSound("pic")
    // AS frame_37: SOMA.playSound("pic")
    // AS frame_61: _parent.removeMovieClip(); stop()
    // Uses anim9 texture (75 frames; we use 61 for the authored timeline).
    const anim9Frames = textures.getFrames("anim9");
    this.sprite8Sym = {
      name: "sprite8",
      totalFrames: 61,
      frames: anim9Frames.slice(0, 61),
      anchorX: anim9Anchor.x,
      anchorY: anim9Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_8/frame_1/DoAction.as: SOMA.playSound("herbe")
            this.playSound?.("herbe");
            // Attach the sub-sprite (DefineSprite_2) at frame 1 of sprite8.
            // The manifest shows anim1/anim5/anim19/anim23 as supplementary
            // 18-frame animations placed inside DefineSprite_8's authored
            // timeline. We attach sprite2 here as the canonical sub-placement.
            clip.attach(this.sprite2Sym, "sprite2", 1, ctx);
          },
        ],
        [
          21,
          () => {
            // AS DefineSprite_8/frame_22/DoAction.as: SOMA.playSound("pic")
            this.playSound?.("pic");
            // frame_22 is the first impact sound — signal hit here.
            this.runtime.signalHit();
          },
        ],
        [
          36,
          () => {
            // AS DefineSprite_8/frame_37/DoAction.as: SOMA.playSound("pic")
            this.playSound?.("pic");
          },
        ],
        [
          60,
          (clip) => {
            // AS DefineSprite_8/frame_61/DoAction.as:
            //   _parent.removeMovieClip(); stop()
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite2Sym);
    this.registry.register(this.sprite8Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use inside frameScripts (which don't
    // receive SpellCallbacks directly).
    this.playSound = callbacks.playSound;

    // Attach the main sprite (DefineSprite_8) at the root. Its own
    // frame_1 script fires immediately via attach() → frameScripts[0].
    this.root.attach(this.sprite8Sym, "sprite8", 1, context);
  }
}
