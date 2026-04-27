/**
 * Spell 1213 — Unknown (likely a Pandawa or support spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1213/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no library symbols, no
 * projectile motion, no duplicate beam, and no dual-anchor pattern.
 * It is a single authored animation (`anim1`, 168 frames) placed at
 * the target cell. The only authored scripts are:
 *
 *   - DefineSprite_14/frame_55/DoAction.as  → SOMA.playSound("m_panda_flotte")
 *   - DefineSprite_14/frame_166/DoAction.as → _parent.removeMovieClip()
 *
 * `DefineSprite_14` maps to the `anim1` animation (the sole entry in
 * `animations[]`, no `librarySymbols[]`). It has 168 authored frames.
 * Frame 55 plays a sound; frame 166 removes the parent (outer mc) and
 * signals spell completion.
 *
 * signalHit is fired at the impact frame (frame 55, coinciding with the
 * sound cue) — the canonical pattern for impact-at-target spells where
 * no explicit `this.end()` or hit-callback exists but a sound marks
 * the moment of effect.
 *
 * Library symbols: none (librarySymbols[] is absent/empty).
 *
 * Main timeline: anim1 is the sole authored content; onSpellStart
 * attaches it to root so it starts ticking from the next runtime frame.
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

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 168-frame impact animation at target cell -------
    // No librarySymbols[] entry; exposed by animations[] only.
    // Use bare "anim1" key (no lib_ prefix).
    //
    // Frame scripts:
    //   AS DefineSprite_14/frame_55/DoAction.as  → playSound + signalHit
    //   AS DefineSprite_14/frame_166/DoAction.as → _parent.removeMovieClip()
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 168,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          54,
          (_clip) => {
            // AS DefineSprite_14/frame_55/DoAction.as:
            //   SOMA.playSound("m_panda_flotte");
            // Also the canonical moment the spell hits — signal hit here.
            this.runtime.signalHit();
            // Sound is played from onSpellStart's captured reference;
            // store the callback so we can call it from inside this closure.
            if (this._soundCallback) {
              this._soundCallback("m_panda_flotte");
            }
          },
        ],
        [
          165,
          (clip) => {
            // AS DefineSprite_14/frame_166/DoAction.as:
            //   _parent.removeMovieClip();
            // clip is anim1; its parent is root (the outer mc).
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  private _soundCallback: ((id: string) => void) | undefined;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture the sound callback so frameScripts can use it.
    this._soundCallback = callbacks.playSound;

    // Attach anim1 to root so it begins ticking on the next runtime frame.
    // The container is already positioned at the target cell by the harness
    // (TargetCell anchor), so anim1 at local (0,0) lands at the target.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
