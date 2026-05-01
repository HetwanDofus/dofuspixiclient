/**
 * Spell 2113 — (Unknown name, likely a Cra/Iop earth or misc spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2113/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile, no caster reference, no
 * `move`/`shoot`/`duplicate` symbols. Two authored timelines:
 *   - anim9  (87 frames, composite): main impact animation at target cell.
 *             frame_73/DoAction.as → _parent.removeMovieClip(); stop();
 *             → spell complete + signalHit at the removal frame.
 *   - anim1  (18 frames): small sub-animation; frame_16/DoAction.as → stop().
 *   - anim5  (18 frames): identical bounds to anim1; stop() at frame 16.
 *   - anim59 (18 frames): identical bounds to anim1; (no explicit stop script
 *             in provided scripts — runs its full 18-frame loop by default).
 *
 * librarySymbols is empty in the manifest, so all four animations are
 * registered from the top-level animations[] list. textures.getFrames uses
 * the bare animation name (NO lib_ prefix).
 *
 * Main timeline: no SOMA.playSound call present in the provided scripts.
 * onSpellStart attaches anim9 (the long composite) at depth 1. anim1, anim5,
 * and anim59 are small decorative glyphs with identical bounds; they are
 * likely placed on anim9's timeline as authored children. Since anim9 is a
 * composite ("isComposite": true) and drives its own removal, we attach only
 * anim9 from onSpellStart and let it drive completion.
 *
 * signalHit is fired at frame_73 (index 72), the same frame that removes the
 * outer clip and signals completion.
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
  width: 204.55,
  height: 215.25,
  offsetX: -95,
  offsetY: -196.1,
};

const ANIM1_BOUNDS = {
  width: 25.6,
  height: 15.25,
  offsetX: -9.15,
  offsetY: -15.4,
};

export class Spell2113 extends RuntimeSpell {
  readonly spellId = 2113;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim9Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim9Anchor = calculateAnchor(ANIM9_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 18-frame small decorative glyph ----------------
    // AS DefineSprite_2/frame_16/DoAction.as: stop()
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 18,
      frames: textures.getFrames("anim1"),
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

    // ---- anim5 — 18-frame small decorative glyph (variant) ------
    // Same bounds and stop-frame as anim1. No separate script provided
    // beyond the shared stop() at frame_16 pattern.
    const anim5Sym: SymbolDefinition = {
      name: "anim5",
      totalFrames: 18,
      frames: textures.getFrames("anim5"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          15,
          (clip) => {
            // Mirrors DefineSprite_2/frame_16/DoAction.as pattern: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- anim59 — 18-frame small decorative glyph (variant) -----
    // Same bounds as anim1/anim5; no explicit stop script provided —
    // plays its full 18-frame loop naturally.
    const anim59Sym: SymbolDefinition = {
      name: "anim59",
      totalFrames: 18,
      frames: textures.getFrames("anim59"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
    };

    // ---- anim9 — 87-frame composite main impact ------------------
    // AS DefineSprite_34/frame_73/DoAction.as:
    //   _parent.removeMovieClip();
    //   stop();
    // This is the outermost clip driving the spell lifecycle.
    this.anim9Sym = {
      name: "anim9",
      totalFrames: 87,
      frames: textures.getFrames("anim9"),
      anchorX: anim9Anchor.x,
      anchorY: anim9Anchor.y,
      frameScripts: new Map([
        [
          72,
          (clip) => {
            // AS DefineSprite_34/frame_73/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            // anim9 is the outermost authored clip; its removal ends
            // the spell. Signal hit at the same canonical impact frame.
            this.runtime.signalHit();
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
    this.registry.register(anim5Sym);
    this.registry.register(anim59Sym);
    this.registry.register(this.anim9Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline places anim9 (the composite impact animation) at
    // depth 1 at the target cell (container is already at target for
    // displayType=11). No SOMA.playSound found in provided scripts.
    this.root.attach(this.anim9Sym, "anim9", 1, context);
  }
}
