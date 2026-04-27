/**
 * Spell 309 — Setag (Sram trap-style ground effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/309/scripts/scripts/
 *
 * displayType=11 (TargetCell). The single sprite_91 positions itself at
 * _parent.cellTo on frame_1 — that's an impact at the target cell, no
 * projectile, no caster reference beyond cellTo. Single authored timeline,
 * 144 frames, with four sound cues and a signalHit at frame_127, removal
 * at frame_142.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest). The sole
 * content is `sprite_91` which appears in `animations[]` and is attached
 * by the main timeline as a direct child.
 *
 * Main timeline: frame_2/DoAction.as → stop(). The implicit frame_1
 * placement of sprite_91 is reproduced by attaching it in onSpellStart.
 *
 * sprite_91 frame scripts (144 frames):
 *   frame_1   → position self at cellTo
 *   frame_16  → SOMA.playSound("setag_309a")
 *   frame_43  → SOMA.playSound("setag_309b")
 *   frame_70  → SOMA.playSound("setag_309b")
 *   frame_118 → SOMA.playSound("setag_309b")
 *   frame_127 → this.end() → signalHit
 *   frame_142 → _parent.removeMovieClip() → complete()
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

const SPRITE_91_BOUNDS = {
  width: 79.15,
  height: 240.45,
  offsetX: -45.4,
  offsetY: -228.95,
};

export class Spell309 extends RuntimeSpell {
  readonly spellId = 309;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite91Sym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite91Anchor = calculateAnchor(SPRITE_91_BOUNDS);

    // sprite_91 — 144-frame ground effect anchored at target cell.
    // No lib_ prefix: this symbol is in animations[] only, not librarySymbols[].
    this.sprite91Sym = {
      name: "sprite_91",
      totalFrames: 144,
      frames: textures.getFrames("sprite_91"),
      anchorX: sprite91Anchor.x,
      anchorY: sprite91Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_91/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
          },
        ],
        [
          15,
          () => {
            // AS DefineSprite_91/frame_16/DoAction.as
            // SOMA.playSound("setag_309a");
            this.soundCallback?.("setag_309a");
          },
        ],
        [
          42,
          () => {
            // AS DefineSprite_91/frame_43/DoAction.as
            // SOMA.playSound("setag_309b");
            this.soundCallback?.("setag_309b");
          },
        ],
        [
          69,
          () => {
            // AS DefineSprite_91/frame_70/DoAction.as
            // SOMA.playSound("setag_309b");
            this.soundCallback?.("setag_309b");
          },
        ],
        [
          117,
          () => {
            // AS DefineSprite_91/frame_118/DoAction.as
            // SOMA.playSound("setag_309b");
            this.soundCallback?.("setag_309b");
          },
        ],
        [
          126,
          () => {
            // AS DefineSprite_91/frame_127/DoAction.as
            // this.end() → damage popup at target.
            this.runtime.signalHit();
          },
        ],
        [
          141,
          (clip) => {
            // AS DefineSprite_91/frame_142/DoAction.as
            // _parent.removeMovieClip(); → spell complete.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite91Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use inside frame scripts.
    this.soundCallback = callbacks.playSound;

    // Main timeline implicit frame_1 placement of sprite_91.
    // frame_2/DoAction.as: stop(); — the main timeline stops after placing the child.
    this.root.attach(this.sprite91Sym, "sprite91", 1, context);
  }
}
