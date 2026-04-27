/**
 * Spell 2067 — (Unknown name, likely a lance/projectile spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2067/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). Evidence:
 *   - Has a `shoot` symbol (DefineSprite_10_shoot, 42 frames) — the canonical
 *     ballistic landing clip.
 *   - Has a `DefineSprite_20` (121 frames) that positions itself at
 *     `_parent.cellTo` (= WorldAbsolute pattern), BUT also has a `shoot` with
 *     `_parent.removeMovieClip()` at frame 36 and a `DefineSprite_18` sub-particle.
 *   - The manifest has only ONE animations entry: "shoot" — no "move" animation
 *     is exported, suggesting `move` is a container-only placeholder driven by
 *     the harness.
 *   - `DefineSprite_20` positions itself at cellTo on frame_1 and plays a sound —
 *     this is the outer mc / harness container, NOT a per-spell library symbol
 *     the spell itself attaches. It is the container that VisualEffectHandler
 *     manages; we are implementing its frame scripts in the context of our
 *     shoot symbol's parent.
 *
 * Re-reading the scripts more carefully:
 *   - `DefineSprite_20` is the outer/harness mc (121 frames). It:
 *       frame_1: plays sound "lance02", positions self at cellTo.
 *       frame_7: calls `this.end()` → signalHit.
 *       frame_121: `_parent.removeMovieClip()` → complete.
 *   - `DefineSprite_10_shoot` (42 frames) is a library symbol:
 *       frame_1: `_rotation = 0` (overrides any harness-applied rotation).
 *       frame_36: `_parent.removeMovieClip(); stop();` — removes its parent
 *                 (the outer mc = harness root), signals complete.
 *   - `DefineSprite_18` is a sub-particle inside shoot:
 *       frame_1: seeds rotation velocity `v`, random scale, sets up onEnterFrame
 *                to spin.
 *
 * The overall structure: outer container (DefineSprite_20) is at target cell,
 * plays sound + signals hit at frame 7, then at frame 121 removes itself.
 * Inside it, a `shoot` clip (DefineSprite_10_shoot) runs a 42-frame impact
 * animation; shoot's frame_36 removes the parent (outer mc) and completes.
 * DefineSprite_18 is a spinning particle sub-symbol attached inside shoot.
 *
 * Since there is no projectile arc / "move" symbol and the entire animation
 * is anchored at the target cell, this is actually displayType=11 (TargetCell).
 * The outer mc (DefineSprite_20) IS our root, positioned at cellTo by the harness.
 * We implement its timeline as the `shoot` symbol (the only exported animation).
 *
 * Final classification: displayType=11 (TargetCell).
 *   - Root anchored at target cell.
 *   - `shoot` (42 frames) is the main impact clip, attached from onSpellStart.
 *   - `DefineSprite_18` is a spinning particle inside shoot.
 *   - frame_7 (0-based: 6) of the outer timeline → signalHit.
 *   - frame_36 (0-based: 35) of shoot → remove parent, complete.
 *   - frame_121 (0-based: 120) of outer timeline → complete (fallback).
 *
 * Since DefineSprite_20 IS the outer mc (its frame scripts reference _parent
 * to remove itself), we model its timeline directly:
 *   - onSpellStart: play sound, attach shoot at depth 1.
 *   - The outer root runs 121 frames; frame 6 = signalHit; frame 120 = complete.
 *   - shoot runs 42 frames; frame 35 = remove parent + complete.
 *
 * Library symbols:
 *   - shoot (DefineSprite_10_shoot, 42 frames) — main impact animation.
 *     frame_1: _rotation = 0.
 *     frame_36: _parent.removeMovieClip(); stop() → complete.
 *   - sprite_18 (DefineSprite_18) — spinning particle inside shoot.
 *     frame_1: seeds v (spin speed), random scale, onEnterFrame spins.
 *
 * Main timeline (DefineSprite_20 = our root):
 *   frame_1: SOMA.playSound("lance02"); position at cellTo (harness handles
 *            cellTo anchor for displayType=11).
 *   frame_7: this.end() → signalHit.
 *   frame_121: _parent.removeMovieClip() → complete.
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
  width: 205.65,
  height: 149.2,
  offsetX: -103.2,
  offsetY: -87.7,
};

export class Spell2067 extends RuntimeSpell {
  readonly spellId = 2067;
  readonly displayType = SpellDisplayType.TargetCell;

  private shootSym!: SymbolDefinition;
  private sprite18Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- DefineSprite_18 — spinning particle inside shoot --------
    // AS: scripts/DefineSprite_18/frame_1/DoAction.as
    // v = 10 + random(15);
    // _xscale = random(50) + 50;
    // _yscale = random(50) + 50;
    // this.onEnterFrame = function() { _rotation = _rotation + v; };
    this.sprite18Sym = {
      name: "sprite_18",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_18/frame_1/DoAction.as
        const v = 10 + Math.floor(Math.random() * 15);
        clip.vars.v = v;
        clip.scaleX = (Math.floor(Math.random() * 50) + 50) / 100;
        clip.scaleY = (Math.floor(Math.random() * 50) + 50) / 100;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_18/frame_1/DoAction.as — onEnterFrame
        // _rotation = _rotation + v;  (v in degrees)
        const v = clip.vars.v as number;
        clip.rotation += (v * Math.PI) / 180;
      },
    };

    // ---- DefineSprite_10_shoot — 42-frame impact animation -------
    // AS: DefineSprite_10_shoot/frame_1/DoAction.as → _rotation = 0
    // AS: DefineSprite_10_shoot/frame_36/DoAction.as → _parent.removeMovieClip(); stop()
    this.shootSym = {
      name: "shoot",
      totalFrames: 42,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_10_shoot/frame_1/DoAction.as
            // _rotation = 0;
            clip.rotation = 0;
          },
        ],
        [
          35,
          (clip) => {
            // AS: DefineSprite_10_shoot/frame_36/DoAction.as
            // _parent.removeMovieClip(); stop();
            // shoot's parent is our root — remove it and signal complete.
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite18Sym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: DefineSprite_20/frame_1/DoAction.as → SOMA.playSound("lance02")
    callbacks.playSound("lance02");

    // AS: DefineSprite_20/frame_1/DoAction_2.as
    // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    // For displayType=11 (TargetCell), the harness already anchors the
    // container at cellTo — the root is at (0,0) in container-local coords,
    // which equals cellTo in world coords. No extra positioning needed.

    // Attach shoot at depth 1. Mirrors the implicit PlaceObject2 for
    // DefineSprite_10_shoot inside DefineSprite_20.
    this.root.attach(this.shootSym, "shoot", 1, context);

    // Wire up the outer-timeline frame scripts on the root clip.
    // DefineSprite_20/frame_7: this.end() → signalHit
    // DefineSprite_20/frame_121: _parent.removeMovieClip() → complete
    // We inject these via the root's onEnterFrame loop by tracking frame count,
    // since the root SpellClip is created with symbol=null (no frameScripts).
    // Instead, we use a lightweight per-frame counter attached to root.vars.
    this.root.vars._outerFrame = 0;
    this.root.onEnterFrame = (_clip) => {
      const f = (this.root.vars._outerFrame as number) + 1;
      this.root.vars._outerFrame = f;

      if (f === 7) {
        // AS: DefineSprite_20/frame_7/DoAction.as → this.end()
        this.runtime.signalHit();
      } else if (f === 121) {
        // AS: DefineSprite_20/frame_121/DoAction.as → _parent.removeMovieClip()
        this.runtime.complete();
      }
    };
  }
}
