/**
 * Spell 2053 — (Unknown spell name).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 *
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2053/scripts/scripts/
 *
 * This spell has a single animation "shoot" in animations[] (no librarySymbols[]).
 * The harness uses displayType=30 (ProjectileBallistic): the harness attaches
 * "move" and "shoot" at the target. Since there is no "move" symbol authored in
 * the manifest (only "shoot"), we register a minimal 1-frame move container and
 * the full 84-frame shoot.
 *
 * Wait — re-examining: manifest has only "shoot" in animations[], no librarySymbols[],
 * and the scripts are only on DefineSprite_18_shoot. The AS for shoot/frame_1 does:
 *   _rotation = 0;
 *   SOMA.playSound("flamme_2022");
 *   SOMA.playSound("pet");
 * And shoot/frame_70:
 *   _parent.removeMovieClip();
 *   stop();
 *
 * The sounds are played inside shoot/frame_1, not on the main timeline. The manifest
 * also lists them as frame 0 sounds (consistent with frame_1 of shoot).
 *
 * displayType detection: Only a "shoot" symbol exists — no "move", no "duplicate",
 * no dual-cell positioning. The spell has a "shoot" symbol that is attached at the
 * target, consistent with ProjectileBallistic (30) or ProjectileLinear (20) pattern.
 * However, without a "move" symbol and without explicit caster-rotation logic, and
 * given that many single-"shoot" impact spells in 1.29 are simply TargetCell (11),
 * we check: the harness for ProjectileBallistic attaches "move" first and expects it
 * in the registry. Since there is no authored "move" here, and since the spell's
 * shoot/frame_1 resets `_rotation = 0` (which is the canonical override pattern for
 * ballistic shoots that receive a velocity-angle rotation), this strongly suggests
 * displayType=30 (ProjectileBallistic). The `_rotation = 0` line only makes sense
 * if the harness applied a rotation prior to frame_1 executing — which is exactly
 * what the ballistic harness does. We register a minimal empty "move" symbol to
 * satisfy the harness.
 *
 * Library symbols:
 *   - shoot — 84-frame fire impact animation. frame_1 resets rotation + plays sounds.
 *              frame_70 removes parent and signals completion.
 *   - move  — minimal 1-frame container (no content); satisfies ballistic harness.
 *
 * Main timeline: no explicit main-timeline DoAction.as — sounds are inside shoot/frame_1.
 *
 * signalHit: handled automatically by the harness (displayType 30 fires it on landing).
 * complete(): fired from shoot's frame_70 script.
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
  width: 293.85,
  height: 231.75,
  offsetX: -161.2,
  offsetY: -148.85,
};

export class Spell2053 extends RuntimeSpell {
  readonly spellId = 2053;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- move — minimal 1-frame container to satisfy ballistic harness ----
    // No authored content; the harness attaches "move" at root and drives it
    // along the parabolic arc before attaching "shoot" at landing.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
    };

    // ---- shoot — 84-frame fire impact animation --------------------------
    // AS DefineSprite_18_shoot/frame_1/DoAction.as:
    //   _rotation = 0;
    //   SOMA.playSound("flamme_2022");
    //   SOMA.playSound("pet");
    //
    // AS DefineSprite_18_shoot/frame_70/DoAction.as:
    //   _parent.removeMovieClip();
    //   stop();
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
            // AS DefineSprite_18_shoot/frame_1/DoAction.as
            // Reset any velocity-angle rotation applied by the ballistic harness.
            clip.rotation = 0;
            // Play sounds — captured from onSpellStart callback reference.
            if (this.playSound) {
              this.playSound("flamme_2022");
              this.playSound("pet");
            }
          },
        ],
        [
          69,
          (clip) => {
            // AS DefineSprite_18_shoot/frame_70/DoAction.as
            // _parent.removeMovieClip() → remove the shoot clip and signal completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // Capture the playSound callback for use inside shoot's frameScripts,
    // since shoot/frame_1 plays the sounds (not the main timeline).
    this.playSound = callbacks.playSound;
  }
}
