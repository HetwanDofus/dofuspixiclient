/**
 * Spell 1213 — (Unknown name, likely a Pandawa or similar class spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1213/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no library symbols, no
 * projectile motion, no caster-side reference, and no dual-anchored
 * timelines. It is a single animated composite (anim1, 168 frames)
 * played at the target cell. This is the canonical TargetCell pattern.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * Main timeline / DefineSprite_14:
 *   - Single symbol `anim1` (168 frames, composite SVG animation).
 *   - frame_55/DoAction.as: SOMA.playSound("m_panda_flotte")
 *   - frame_166/DoAction.as: _parent.removeMovieClip() → spell complete
 *
 * The sound at frame 55 fires from inside the anim1 symbol's timeline,
 * not the outer main timeline. We capture the playSound callback in
 * onSpellStart and fire it from the frameScripts entry for frame 54
 * (0-based).
 *
 * signalHit is fired at the same frame as the sound (frame 55, index 54)
 * as the canonical impact moment for this spell type (no explicit
 * `this.end()` call in AS, but the sound marks the hit).
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
  width: 89.75,
  height: 82.9,
  offsetX: -45.4,
  offsetY: -68.75,
};

export class Spell1213 extends RuntimeSpell {
  readonly spellId = 1213;
  readonly displayType = SpellDisplayType.TargetCell;

  private playSoundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 168-frame composite animation at target cell ----
    // AS DefineSprite_14 carries two frame scripts:
    //   frame_55/DoAction.as:  SOMA.playSound("m_panda_flotte")
    //   frame_166/DoAction.as: _parent.removeMovieClip()
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 168,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          54,
          (_clip) => {
            // AS DefineSprite_14/frame_55/DoAction.as
            // SOMA.playSound("m_panda_flotte");
            this.playSoundCallback?.("m_panda_flotte");
            // The sound marks the canonical impact moment — signal hit here.
            this.runtime.signalHit();
          },
        ],
        [
          165,
          (clip) => {
            // AS DefineSprite_14/frame_166/DoAction.as
            // _parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture the playSound callback so frame scripts can fire sounds
    // from inside the anim1 symbol's timeline.
    this.playSoundCallback = callbacks.playSound;

    // Attach anim1 to the root so it begins playing from frame 1.
    // The harness has already positioned the root at the target cell
    // (displayType=11), so anim1 at local (0,0) renders correctly.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
