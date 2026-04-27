/**
 * Spell 1101 — (unknown name, likely a Cra or Iop spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1101/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile motion, no
 * caster-side reference, no `move`/`shoot`/`duplicate` library symbols,
 * and no `_parent.cellFrom` / `_parent.cellTo` usage in the scripts.
 * A single impact animation plays at the target cell — the classic
 * TargetCell pattern.
 *
 * Manifest layout:
 *   - animations[0]: sprite_2 — 486-frame main impact visual.
 *   - animations[1]: sprite_4 — 144-frame secondary animation (looping
 *     sub-cycle, loops back to frame 6 at frame 142).
 *   - No librarySymbols entries → NO `lib_` prefix on any getFrames call.
 *
 * Main timeline (top-level):
 *   - frame_1/DoAction.as:   SOMA.playSound("autre_1101")
 *   - frame_137/DoAction.as: this.end()  → signalHit
 *   - frame_159/DoAction.as: this.removeMovieClip() → complete
 *
 * sprite_2 is the primary timeline driven directly on the root:
 *   totalFrames = 486 (manifest), but the AS main-timeline only has
 *   159 frames of authored scripts. The two script keyframes tell us:
 *     frame 137 → hit signal
 *     frame 159 → removal / complete
 *
 * sprite_4 (DefineSprite_4) has its own looping behaviour:
 *   frame_1:   gotoAndPlay(random(60))   → random entry point [0..59]
 *   frame_142: gotoAndPlay(6)            → loop back to frame 6 (0-based: 5)
 *
 * Both timelines are attached from onSpellStart (implicit placement on
 * the main timeline in canonical Flash). sprite_2 carries the hit and
 * completion signals; sprite_4 runs as a background loop until the
 * parent is removed.
 *
 * Since this is displayType=11, the harness does NOT auto-signalHit —
 * we fire it from the canonical frame_137 script ourselves.
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

// Bounds from manifest animations[0] (sprite_2).
const SPRITE_2_BOUNDS = {
  width: 149.8,
  height: 149.85,
  offsetX: -84.2,
  offsetY: -78.15,
};

// Bounds from manifest animations[1] (sprite_4).
const SPRITE_4_BOUNDS = {
  width: 127.05,
  height: 506.7,
  offsetX: -108.95,
  offsetY: -493.5,
};

export class Spell1101 extends RuntimeSpell {
  readonly spellId = 1101;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite2Sym!: SymbolDefinition;
  private sprite4Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite2Anchor = calculateAnchor(SPRITE_2_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE_4_BOUNDS);

    // ---- sprite_2 — 486-frame primary impact timeline ------------
    // Canonical main-timeline frame scripts:
    //   frame_137/DoAction.as: this.end()            → signalHit
    //   frame_159/DoAction.as: this.removeMovieClip() → complete
    //
    // The authored main timeline has 159 AS keyframes; the dofasset
    // provides 486 frames of texture. We honour the canonical removal
    // at frame 159 (0-based: 158) so the spell terminates at the right
    // wall-clock time (≈2.6 s at 60 fps).
    this.sprite2Sym = {
      name: "sprite_2",
      totalFrames: 486,
      frames: textures.getFrames("sprite_2"),
      anchorX: sprite2Anchor.x,
      anchorY: sprite2Anchor.y,
      frameScripts: new Map([
        [
          136,
          (_clip) => {
            // AS scripts/frame_137/DoAction.as: this.end()
            this.runtime.signalHit();
          },
        ],
        [
          158,
          (clip) => {
            // AS scripts/frame_159/DoAction.as: this.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- sprite_4 — 144-frame looping secondary animation --------
    // AS DefineSprite_4/frame_1/DoAction.as:
    //   gotoAndPlay(random(60));   → jump to random frame in [0,59]
    // AS DefineSprite_4/frame_142/DoAction.as:
    //   gotoAndPlay(6);            → loop back to frame 6 (0-based: 5)
    this.sprite4Sym = {
      name: "sprite_4",
      totalFrames: 144,
      frames: textures.getFrames("sprite_4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_4/frame_1/DoAction.as:
            //   gotoAndPlay(random(60));
            clip.gotoAndPlay(Math.floor(Math.random() * 60));
          },
        ],
        [
          141,
          (clip) => {
            // AS DefineSprite_4/frame_142/DoAction.as:
            //   gotoAndPlay(6);
            clip.gotoAndPlay(5);
          },
        ],
      ]),
    };

    this.registry.register(this.sprite2Sym);
    this.registry.register(this.sprite4Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("autre_1101");
    callbacks.playSound("autre_1101");

    // Implicit main-timeline placement of sprite_2 and sprite_4.
    // sprite_2 is the primary visual and carries the hit + complete signals.
    // sprite_4 is the looping background element.
    this.root.attach(this.sprite2Sym, "sprite_2", 1, context);
    this.root.attach(this.sprite4Sym, "sprite_4", 2, context);
  }
}
