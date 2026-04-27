/**
 * Spell 2030 — Crockette (Sadida frog projectile).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2030/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has `move` (6-frame animated
 * frog projectile) and `shoot` (108-frame impact with a burn timeline) — the
 * classic ballistic pattern. The harness attaches `move` at caster, drives it
 * along a parabolic arc, then attaches `shoot` at the target on landing and
 * calls signalHit automatically.
 *
 * Library symbols / sprite timelines:
 *
 *   - `move`  — 6-frame animated frog in flight. No authored frame scripts
 *               other than the loop implied by totalFrames=6. The harness
 *               positions this along the arc.
 *
 *   - `shoot` — 108-frame impact composite (isComposite=true). Contains
 *               authored child sprites driven by DefineSprite_8, _12, _14.
 *               frame_4: `_rotation = 0` (canonical override of velocity angle).
 *               frame_106: `_parent.removeMovieClip(); stop()` → complete().
 *               The harness fires signalHit() automatically at landing for
 *               displayType=30, so we do NOT call it again here.
 *
 *   - DefineSprite_8 — a sub-symbol used inside `shoot`. 34+ frames.
 *               frame_1: `if(random(5) != 1) { gotoAndStop(60); }` — most
 *                        instances jump to frame 60 (looping decoration).
 *               frame_34: `stop()`.
 *               This symbol is referenced as a child inside the `shoot`
 *               composite but is not directly attachMovie'd by per-spell AS.
 *               Since the manifest only provides `shoot` and `move` in
 *               animations[] (no librarySymbols[]), DefineSprite_8 is an
 *               internal authored child within the `shoot` composite frames.
 *               We do not need to register it separately — the composite
 *               frame textures already bake its appearance.
 *
 *   - DefineSprite_12 — sub-symbol inside `shoot` composite.
 *               frame_1: gotoAndPlay(random(30)+1); _alpha=30+random(50);
 *                        t=30+random(120); _xscale=t; _yscale=t/2.
 *               frame_97: stop().
 *               Like DefineSprite_8, this is baked into the `shoot` composite.
 *
 *   - DefineSprite_14 — sub-symbol inside `shoot` composite.
 *               frame_295: stop(). Long fade-out.
 *               Also baked into composite.
 *
 * Because `librarySymbols` is empty in the manifest, `move` and `shoot` are
 * the only registered symbols. Their textures are loaded with the bare name
 * (no `lib_` prefix). The `shoot` composite is 108 frames; only frame_4
 * (_rotation=0 override) and frame_106 (removal/completion) need explicit
 * frameScripts. All internal sub-sprite animation is baked into the composite
 * frame textures.
 *
 * Main timeline: SOMA.playSound("crockette_206") — no stop(), no child attaches.
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

const MOVE_BOUNDS = {
  width: 15.5,
  height: 5.3,
  offsetX: -9.7,
  offsetY: -2.7,
};

const SHOOT_BOUNDS = {
  width: 63.6,
  height: 30.2,
  offsetX: -31.8,
  offsetY: -14.75,
};

export class Spell2030 extends RuntimeSpell {
  readonly spellId = 2030;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const moveAnchor = calculateAnchor(MOVE_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- move — 6-frame animated frog projectile in flight -------
    // No authored frame scripts. The harness drives motion along the
    // parabolic arc and removes this clip at landing.
    // Texture key uses bare "move" (no lib_ prefix — not in librarySymbols[]).
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 6,
      frames: textures.getFrames("move"),
      anchorX: moveAnchor.x,
      anchorY: moveAnchor.y,
    };

    // ---- shoot — 108-frame impact composite ----------------------
    // AS scripts/DefineSprite_15_shoot/:
    //   frame_4/DoAction.as:   _rotation = 0;
    //   frame_106/DoAction.as: _parent.removeMovieClip(); stop();
    //
    // frame_4 overrides the harness-applied velocity-angle rotation so
    // the impact frog lands upright (canonical pattern also seen in
    // spell-103's shoot). frame_106 triggers spell completion.
    //
    // Note: harness fires signalHit() automatically at landing for
    // displayType=30 — we must NOT call it here.
    //
    // Texture key uses bare "shoot" (no lib_ prefix — not in librarySymbols[]).
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 108,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS DefineSprite_15_shoot/frame_4/DoAction.as:
            //   _rotation = 0;
            // Cancels the velocity-angle rotation applied by the harness
            // when attaching shoot, so the impact visual stands upright.
            clip.rotation = 0;
          },
        ],
        [
          105,
          (clip) => {
            // AS DefineSprite_15_shoot/frame_106/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
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
    _context: SpellContext
  ): void {
    // AS scripts/frame_1/DoAction.as:
    //   SOMA.playSound("crockette_206");
    callbacks.playSound("crockette_206");
  }
}
