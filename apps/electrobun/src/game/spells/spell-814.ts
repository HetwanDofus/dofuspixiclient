/**
 * Spell 814 — Vlad (Sacrieur / Sram area).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/814/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The spell has a single `shoot` symbol
 * whose frame_1 sets `_rotation = _parent.angle` — the canonical indicator
 * of a linear projectile that points from caster toward target. The harness
 * attaches `shoot` at the target-relative offset inside a container rotated
 * to face the target; the frame_1 script then overrides rotation to
 * `_parent.angle` (degrees → radians) to align the visual.
 *
 * Library symbols:
 *   - shoot — 90-frame linear projectile animation. frame_1 sets rotation
 *     to match caster→target angle. frame_88 calls _parent.removeMovieClip()
 *     which signals spell completion (the outer mc dies).
 *     NOTE: This symbol appears only in `animations[]`, NOT in
 *     `librarySymbols[]` — the manifest has no librarySymbols entries —
 *     so textures are loaded via `textures.getFrames("shoot")` (no lib_ prefix)
 *     and bounds come from the `animations[]` entry.
 *
 * Main timeline: SOMA.playSound("vlad_805") on frame_1.
 *
 * Hit signal: fired at frame_1 of shoot (the projectile has "arrived" since
 * the harness places shoot at the target offset for ProjectileLinear). The
 * canonical pattern for ProjectileLinear is to signal hit at the start of
 * the shoot animation since the impact is immediate at placement.
 * For displayType 20 the harness does NOT auto-signal hit, so we fire it
 * from shoot's frame_1.
 *
 * Completion: fired from shoot's frame_88 script (AS frame_88 →
 * frameScripts.set(87, …)) which mirrors `_parent.removeMovieClip()`.
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

// Bounds from manifest animations[] entry for "shoot"
const SHOOT_BOUNDS = {
  width: 509.1,
  height: 70.1,
  offsetX: -5,
  offsetY: -37.6,
};

export class Spell814 extends RuntimeSpell {
  readonly spellId = 814;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 90-frame linear projectile ----------------------
    // "shoot" only appears in animations[], NOT in librarySymbols[],
    // so we use textures.getFrames("shoot") — no lib_ prefix.
    //
    // AS DefineSprite_7_shoot/frame_1/DoAction.as:
    //   _rotation = _parent.angle;
    //
    // AS DefineSprite_7_shoot/frame_88/DoAction.as:
    //   _parent.removeMovieClip();
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 90,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_7_shoot/frame_1/DoAction.as:
            //   _rotation = _parent.angle;
            // _parent.angle is in degrees (set by the harness on root.vars).
            const root = clip.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            clip.rotation = (angleDeg * Math.PI) / 180;
            // For ProjectileLinear the harness does not auto-signal hit —
            // the shoot clip is placed at the target offset at attach time,
            // so the impact is immediate. Signal hit here.
            this.runtime.signalHit();
          },
        ],
        [
          87,
          (clip) => {
            // AS DefineSprite_7_shoot/frame_88/DoAction.as:
            //   _parent.removeMovieClip();
            // This removes the outer mc, ending the spell.
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
    // AS scripts/frame_1/DoAction.as:
    //   SOMA.playSound("vlad_805");
    callbacks.playSound("vlad_805");
  }
}
