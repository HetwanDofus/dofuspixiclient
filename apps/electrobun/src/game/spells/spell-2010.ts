/**
 * Spell 2010 — Shield (Carapace / Cara shield effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2010/scripts/scripts/
 *
 * displayType=11 (TargetCell). This is a single-animation impact spell anchored
 * at the target cell. There are no projectile symbols, no `move`/`shoot`/`duplicate`
 * symbols, and no library symbols with clip events. The entire visual is a single
 * 129-frame composite animation (`anim1`) that plays at the target cell.
 *
 * The manifest has NO `librarySymbols[]` entries — only one `animations[]` entry
 * (`anim1`). So textures are accessed with `textures.getFrames("anim1")` (no `lib_`
 * prefix), and bounds come from `animations[0].{width, height, offsetX, offsetY}`.
 *
 * AS layout:
 *   - DefineSprite_6/frame_1/DoAction.as:   SOMA.playSound("shield_cara")
 *   - DefineSprite_6/frame_127/DoAction.as: _parent.removeMovieClip()
 *   - DefineSprite_4/frame_67/DoAction.as:  stop()
 *
 * DefineSprite_6 is the outer wrapper (129 frames). It plays the sound on frame 1
 * and removes its parent (the outer mc) at frame 127 → `this.runtime.complete()`.
 *
 * DefineSprite_4 is an inner sub-sprite that stops at frame 67, the canonical
 * impact point. Since the manifest contains no CLIPACTIONRECORD entries for either
 * sprite, there are no onClipEvent(load) or onClipEvent(enterFrame) handlers to
 * port — the only runtime behaviour is the two frame scripts above.
 *
 * We model the entire animation as a single `anim1` SymbolDefinition attached at
 * root with:
 *   - signalHit at frame 67 (mirrors DefineSprite_4/frame_67 stop — canonical hit
 *     point for the shield landing; displayType=11 requires manual signalHit).
 *   - complete() at frame 127 (mirrors DefineSprite_6/frame_127
 *     _parent.removeMovieClip()).
 *
 * Main timeline: sound `shield_cara` fired in onSpellStart (mirrors
 * DefineSprite_6/frame_1/DoAction.as).
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
  width: 113.3,
  height: 95.9,
  offsetX: -47.6,
  offsetY: -58.8,
};

export class Spell2010 extends RuntimeSpell {
  readonly spellId = 2010;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 — 129-frame composite animation at target cell.
    // No CLIPACTIONRECORD handlers exist in the manifest for this spell,
    // so no onLoad or onEnterFrame are required.
    //
    // Frame scripts ported from canonical AS:
    //   frame_67  → DefineSprite_4/frame_67/DoAction.as:  stop()
    //               Used as the canonical hit signal frame.
    //   frame_127 → DefineSprite_6/frame_127/DoAction.as: _parent.removeMovieClip()
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 129,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          66,
          (_clip) => {
            // AS: DefineSprite_4/frame_67/DoAction.as → stop()
            // Canonical impact frame — signal hit so damage popups fire.
            this.runtime.signalHit();
          },
        ],
        [
          126,
          (clip) => {
            // AS: DefineSprite_6/frame_127/DoAction.as → _parent.removeMovieClip()
            // Outer sprite removes the parent mc, ending the spell.
            clip.remove();
            this.runtime.complete();
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
    // AS: DefineSprite_6/frame_1/DoAction.as → SOMA.playSound("shield_cara")
    callbacks.playSound("shield_cara");

    // Attach anim1 at root so it starts ticking on the next runtime frame.
    // Mirrors the implicit main-timeline placement of DefineSprite_6
    // (the outer wrapper sprite) at depth 1.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
