/**
 * Spell 2915 — (Unknown name, likely a buff/self-anim spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2915/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no library symbols, no projectile
 * symbols (move/shoot/duplicate), no caster-reference logic, and no
 * WorldAbsolute dual-anchor pattern. The single animation `anim1` plays
 * entirely at the target cell. This matches the most common impact pattern.
 *
 * Canonical AS layout:
 *   - DefineSprite_15 — 141-frame composite (anim1).
 *       frame_1:  SOMA.playSound("gonfle")
 *       frame_139 (0-based: 138): stop(); _parent.removeMovieClip()
 *
 * librarySymbols: none. The manifest has a single `animations[]` entry
 * `anim1` with 141 frames. No `lib_` prefix is needed anywhere.
 *
 * Main timeline: plays `anim1` as the root content. The `anim1` symbol
 * is registered as the sole symbol; its frame_1 plays the sound and its
 * frame_139 stops + completes the spell.
 *
 * signalHit: fired at frame_1 (frame index 0) — the impact is instantaneous
 * (no projectile; displayType TargetCell).
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
  width: 336.15,
  height: 340.95,
  offsetX: -174,
  offsetY: -278.25,
};

export class Spell2915 extends RuntimeSpell {
  readonly spellId = 2915;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 141-frame composite impact animation ------------
    // AS: DefineSprite_15/frame_1/DoAction.as  → playSound("gonfle")
    // AS: DefineSprite_15/frame_139/DoAction.as → stop(); _parent.removeMovieClip()
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 141,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, _ctx) => {
            // AS: DefineSprite_15/frame_1/DoAction.as
            // Sound is played via onSpellStart; signal hit at impact frame.
            this.runtime.signalHit();
          },
        ],
        [
          138,
          (clip) => {
            // AS: DefineSprite_15/frame_139/DoAction.as
            // stop(); _parent.removeMovieClip();
            clip.stop();
            clip.parent?.remove();
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
    // AS: DefineSprite_15/frame_1/DoAction.as — SOMA.playSound("gonfle")
    callbacks.playSound("gonfle");
    // Attach anim1 as the root content at the target cell (displayType=11).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
