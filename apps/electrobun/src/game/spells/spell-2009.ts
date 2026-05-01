/**
 * Spell 2009 — (Unknown name, projectile impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2009/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The spell has a single `shoot` symbol
 * (84-frame impact animation) with no `move` symbol and no library symbols.
 * The harness attaches `shoot` at the target-relative offset inside the
 * rotated container. The shoot symbol's frame_1 resets rotation to 0
 * (canonical `_rotation = 0`), frame_7 plays the explosion sound, and
 * frame_70 calls `_parent.removeMovieClip()` + `stop()` to complete the spell.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * Main timeline: no explicit frame_1/DoAction.as — only the harness-driven
 * `shoot` attachment. No onSpellStart sound (the sound fires from inside the
 * shoot symbol at frame_7).
 *
 * Symbols:
 *   - `shoot` — 84-frame rendered impact animation (full SVG frames).
 *     frame_1 (index 0): `_rotation = 0` — cancel harness-applied angle.
 *     frame_7 (index 6): `SOMA.playSound("explosion")`.
 *     frame_70 (index 69): `_parent.removeMovieClip(); stop()` → spell complete + signalHit.
 *
 * Signal hit: fired at frame_70 (the canonical impact/removal frame), since
 * the harness does NOT automatically call signalHit for ProjectileLinear.
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

const SHOOT_BOUNDS = {
  width: 204.8,
  height: 129.6,
  offsetX: -102.35,
  offsetY: -68.1,
};

export class Spell2009 extends RuntimeSpell {
  readonly spellId = 2009;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 84-frame rendered impact animation --------------
    // No lib_ prefix: `shoot` is in animations[] only, not librarySymbols[].
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 84,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_18_shoot/frame_1/DoAction.as
            // _rotation = 0; — cancel the velocity-angle rotation applied
            // by the harness when attaching shoot.
            clip.rotation = (0 * Math.PI) / 180;
          },
        ],
        [
          6,
          () => {
            // AS: DefineSprite_18_shoot/frame_7/DoAction.as
            // SOMA.playSound("explosion");
            this.soundCallback?.("explosion");
          },
        ],
        [
          69,
          (clip) => {
            // AS: DefineSprite_18_shoot/frame_70/DoAction.as
            // _parent.removeMovieClip(); stop();
            // _parent here is the outer mc (root), so signal hit + complete.
            this.runtime.signalHit();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // Capture sound callback so frame_7 inside shoot can call it.
    this.soundCallback = callbacks.playSound;
    // No main-timeline sound or explicit child attaches — the harness
    // attaches shoot automatically for ProjectileLinear.
  }
}
