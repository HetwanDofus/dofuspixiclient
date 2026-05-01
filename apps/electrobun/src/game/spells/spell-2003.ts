/**
 * Spell 2003 — (Projectile/Linear spell, Dofus 1.29).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2003/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). This spell has a single `anim1` animation
 * in the top-level `animations[]` list (no `librarySymbols[]`), which is the
 * canonical pattern for a linear projectile "shoot" symbol. The harness will
 * attach it as "shoot" at the target-relative offset inside the rotated container.
 * The only authored script is `DefineSprite_2/frame_52/DoAction.as` which calls
 * `_parent.removeMovieClip()` — this is the completion signal at frame 52 (0-based: 51).
 *
 * Library symbols: none (librarySymbols[] is empty).
 *
 * Main timeline: no explicit sound or child attaches on the main timeline beyond
 * the harness-driven "shoot" placement.
 *
 * The `anim1` animation (54 frames) is registered as the "shoot" symbol so the
 * ProjectileLinear harness can attach it at the target offset inside the rotated
 * container. Frame 51 (AS frame_52) calls `_parent.removeMovieClip()` which we
 * translate to `clip.parent?.remove()` + `this.runtime.complete()`.
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
  width: 118.3,
  height: 27.15,
  offsetX: 15.15,
  offsetY: -14,
};

export class Spell2003 extends RuntimeSpell {
  readonly spellId = 2003;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- shoot — 54-frame linear projectile animation ------------
    // The harness (ProjectileLinear) attaches this symbol as "shoot"
    // at the target-relative offset inside the container that is
    // rotated to face the target.
    //
    // AS DefineSprite_2/frame_52/DoAction.as:
    //   _parent.removeMovieClip();
    // → frame index 51 (0-based), removes outer mc + signals completion.
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 54,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          51,
          (clip) => {
            // AS DefineSprite_2/frame_52/DoAction.as: _parent.removeMovieClip()
            // "shoot"'s parent is the root container (outer mc).
            clip.parent?.remove();
            this.runtime.signalHit();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // No explicit sound or child attaches on the main timeline for this spell.
    // The harness handles attaching "shoot" at the target offset.
  }
}
