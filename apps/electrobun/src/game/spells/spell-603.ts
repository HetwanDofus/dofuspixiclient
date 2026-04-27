/**
 * Spell 603 — Esquive (Dodge / Sram dodge visual).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/603/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile, no caster reference,
 * no _parent.cellFrom usage — a single impact animation plays at the target cell.
 * No librarySymbols[] in the manifest; all content lives in the top-level
 * animations[] entry ("anim1", 222 frames, isComposite).
 *
 * The anim1 timeline IS the outer sprite (DefineSprite_20). It:
 *   - frame_145: this.end() → signalHit
 *   - frame_220: _parent.removeMovieClip(); stop() → complete
 *
 * Internal sub-symbols (DefineSprite_18, DefineSprite_19, DefineSprite_16,
 * DefineSprite_3) are authored INTO the composite anim1 frames — their
 * visual content is baked into the per-frame SVGs by the exporter. The
 * clip-event scripts they carried (lemniscate spiral, rotation oscillation,
 * etc.) are irrelevant since the composite SVG frames already capture
 * their visual state. We only need to drive the outer timeline and fire
 * the two canonical signals at the correct frames.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("dodge_603")
 *
 * Library symbols: none (manifest.librarySymbols is absent / empty).
 *
 * Symbol registered:
 *   - "anim1" — 222-frame composite impact animation. Plays at target cell.
 *     frame_145 (index 144): this.end() → runtime.signalHit()
 *     frame_220 (index 219): _parent.removeMovieClip() → runtime.complete()
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
  width: 43.25,
  height: 34.75,
  offsetX: -22.6,
  offsetY: -15.8,
};

export class Spell603 extends RuntimeSpell {
  readonly spellId = 603;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 222-frame composite impact animation ------------
    // Canonical outer sprite: DefineSprite_20
    // No librarySymbols[] in manifest — use bare "anim1" key (no lib_ prefix).
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 222,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          144,
          (_clip) => {
            // AS DefineSprite_20/frame_145/DoAction.as: this.end();
            // Signals the hit / damage popup at the target.
            this.runtime.signalHit();
          },
        ],
        [
          219,
          (clip) => {
            // AS DefineSprite_20/frame_220/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            clip.remove();
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
    // AS frame_1/DoAction.as: SOMA.playSound("dodge_603");
    callbacks.playSound("dodge_603");

    // Attach the main composite animation at the root so it starts
    // ticking from the next runtime frame.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
