/**
 * Spell 2119 — (Unknown name, likely a Sacrieur/Sram-style impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2119/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single authored timeline
 * (sprite_14, 144 frames) that positions itself at _parent.cellTo on
 * frame_1, fires this.end() (signalHit) at frame_85, and calls
 * _parent.removeMovieClip() at frame_136. No projectile, no caster
 * reference, no move/shoot/duplicate — classic TargetCell impact.
 *
 * The sprite_14 symbol also contains a rotating sub-sprite (DefineSprite_3)
 * whose onClipEvent(enterFrame) increments _rotation by 23.3 degrees each
 * frame. That sub-sprite is placed statically on sprite_14's authored
 * timeline (not via attachMovie), so its rotation is entirely driven by
 * the composite frames baked into the "sprite_14" animation asset. No
 * explicit symbol registration is needed for DefineSprite_3 — it is
 * embedded in the sprite_14 composite frames.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * Main timeline (frame_2/DoAction.as): stop().
 * — No SOMA.playSound call found; onSpellStart is a no-op.
 *
 * Authored animations:
 *   - sprite_14 (144 frames, isComposite=true) — the full impact anim.
 *     frame_1:   _X = _parent.cellTo.x; _Y = _parent.cellTo.y; _rotation = 0
 *     frame_85:  this.end()  → signalHit
 *     frame_136: _parent.removeMovieClip() + stop() → runtime.complete()
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

const SPRITE_14_BOUNDS = {
  width: 186.7,
  height: 220.2,
  offsetX: -92.65,
  offsetY: -173.7,
};

export class Spell2119 extends RuntimeSpell {
  readonly spellId = 2119;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite14Anchor = calculateAnchor(SPRITE_14_BOUNDS);

    // ---- sprite_14 — main impact timeline (144 frames) ----------
    // The manifest lists this under animations[] (not librarySymbols[]),
    // so we use textures.getFrames("sprite_14") (no lib_ prefix).
    //
    // This symbol is placed directly on the root by onSpellStart (mirrors
    // the implicit main-timeline placement from the canonical SWF).
    //
    // frame_1  (index 0): AS DefineSprite_14/frame_1/DoAction.as
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y; _rotation = 0;
    //
    // frame_85 (index 84): AS DefineSprite_14/frame_85/DoAction.as
    //   this.end() → signalHit
    //
    // frame_136 (index 135): AS DefineSprite_14/frame_136/DoAction.as
    //   _parent.removeMovieClip(); stop(); → runtime.complete()
    const sprite14Sym: SymbolDefinition = {
      name: "sprite_14",
      totalFrames: 144,
      frames: textures.getFrames("sprite_14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_14/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y; _rotation = 0;
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
            clip.rotation = 0;
          },
        ],
        [
          84,
          () => {
            // AS: DefineSprite_14/frame_85/DoAction.as
            // this.end() → damage popup at target
            this.runtime.signalHit();
          },
        ],
        [
          135,
          (clip) => {
            // AS: DefineSprite_14/frame_136/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite14Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: frame_2/DoAction.as → stop()
    // No SOMA.playSound in the canonical main timeline.
    // The canonical SWF places sprite_14 implicitly on the main timeline.
    // We attach it here so it starts ticking from the next runtime frame.
    const sprite14Sym = this.registry.resolve("sprite_14");
    if (sprite14Sym) {
      this.root.attach(sprite14Sym, "sprite14", 1, context);
    }
  }
}
