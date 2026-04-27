/**
 * Spell 2042 — (unknown name, likely a nature/earth impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2042/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move`/`shoot`/`duplicate` symbol,
 * no caster-rotation logic, no dual-anchored world-absolute placement. The spell
 * is a single impact animation at the target cell. This is the classic TargetCell
 * pattern.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * Animations:
 *   - anim9  — 75-frame main impact composite (DefineSprite_8). Plays at target.
 *              frame_1:  SOMA.playSound("herbe")
 *              frame_22: SOMA.playSound("pic")   → signalHit
 *              frame_37: SOMA.playSound("pic")
 *              frame_61: _parent.removeMovieClip(); stop() → spell complete
 *   - anim1, anim5, anim19, anim23 — 18-frame sub-animations (DefineSprite_2-style,
 *              stopFrame=15; frame_16: stop()). These are authored sub-sprites
 *              placed on DefineSprite_8's timeline. Without explicit AS placing
 *              them via attachMovie (they are PlaceObject children of DefineSprite_8,
 *              not library-attached at runtime), they are baked into the anim9
 *              composite frames. We do NOT need to register or attach them
 *              separately — they are visual content of anim9's texture frames.
 *
 * Main timeline: implied `stop()` after placing DefineSprite_8 (anim9) at root.
 * The sounds list in manifest mirrors DefineSprite_8's frame scripts:
 *   frame 0 (AS frame_1): "herbe"
 *   frame 21 (AS frame_22): "pic"
 *   frame 36 (AS frame_37): "pic"
 *
 * The anim1/anim5/anim19/anim23 animations share the same bounds as each other
 * (18 frames, 25.6×15.25) — they are likely the small "leaf puff" sub-elements
 * placed at fixed positions inside DefineSprite_8. Since manifest has no
 * librarySymbols[], they are baked into anim9's SVG frames, NOT runtime-attached.
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

const ANIM9_BOUNDS = {
  width: 76.95,
  height: 96.1,
  offsetX: -39.6,
  offsetY: -61.15,
};

export class Spell2042 extends RuntimeSpell {
  readonly spellId = 2042;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim9Sym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim9Anchor = calculateAnchor(ANIM9_BOUNDS);

    // ---- anim9 — 75-frame main impact timeline (DefineSprite_8) ----
    // Canonical scripts:
    //   DefineSprite_8/frame_1/DoAction.as  → SOMA.playSound("herbe")
    //   DefineSprite_8/frame_22/DoAction.as → SOMA.playSound("pic") + signalHit
    //   DefineSprite_8/frame_37/DoAction.as → SOMA.playSound("pic")
    //   DefineSprite_8/frame_61/DoAction.as → _parent.removeMovieClip(); stop()
    this.anim9Sym = {
      name: "anim9",
      totalFrames: 75,
      frames: textures.getFrames("anim9"),
      anchorX: anim9Anchor.x,
      anchorY: anim9Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_8/frame_1/DoAction.as: SOMA.playSound("herbe")
            this.soundCallback?.("herbe");
          },
        ],
        [
          21,
          (_clip) => {
            // AS DefineSprite_8/frame_22/DoAction.as: SOMA.playSound("pic")
            // This is the first impact frame — signal hit here.
            this.soundCallback?.("pic");
            this.runtime.signalHit();
          },
        ],
        [
          36,
          (_clip) => {
            // AS DefineSprite_8/frame_37/DoAction.as: SOMA.playSound("pic")
            this.soundCallback?.("pic");
          },
        ],
        [
          60,
          (clip) => {
            // AS DefineSprite_8/frame_61/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim9Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use inside frameScripts.
    this.soundCallback = callbacks.playSound;

    // Main timeline implicitly places DefineSprite_8 (anim9) at the root.
    // Attach it so it starts ticking from the first runtime frame.
    this.root.attach(this.anim9Sym, "anim9", 1, context);
  }
}
