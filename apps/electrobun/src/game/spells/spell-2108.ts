/**
 * Spell 2108 — Grina (Sram poison/needle spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2108/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move`/`shoot`/`duplicate` symbol,
 * no caster-relative positioning, no projectile arc — the animation is a single
 * composite impact at the target cell. The top-level `anim1` animation (105 frames)
 * is driven by a chain of nested DefineSprite clips placed on the main timeline.
 *
 * Canonical AS layout:
 *
 *   - `DefineSprite_21` — single-frame sub-symbol. frame_1: `_rotation = -random(180)`.
 *     Used as the spinning needle/shard. Three instances are placed by DefineSprite_22
 *     at depths 3, 7, 11, each with an onClipEvent(load) that randomises their start
 *     frame via `gotoAndPlay(random(_totalframes + 1))`.
 *
 *   - `DefineSprite_13` — 52-frame looping sub-symbol.
 *       frame_1: `gotoAndPlay(random(47) + 2)` — randomises start in [2..48].
 *       frame_52: `gotoAndPlay(2)` — loops back from frame 52 to frame 2 (skipping
 *                 the randomise-only frame_1 on subsequent loops).
 *
 *   - `DefineSprite_15` — contains a sub-clip with onClipEvent(enterFrame):
 *       `_rotation = _rotation + 1.6` (degrees per frame → radians per frame).
 *       This drives a continuously-rotating child element.
 *
 *   - `DefineSprite_22` — composite container. Places three DefineSprite_21 instances
 *       at depths 3, 7, 11. Each one's onClipEvent(load) calls
 *       `gotoAndPlay(random(_totalframes + 1))` to stagger their rotation phase.
 *
 *   - `DefineSprite_23` — outermost composite clip, 103 frames of authored content.
 *       frame_103: `_parent.removeMovieClip()` → spell complete + signalHit.
 *
 *   - Main timeline frame_1: `SOMA.playSound("grina_701")`.
 *
 * The manifest has a single `animations` entry `anim1` (105 frames, isComposite=true)
 * and no `librarySymbols` entries. All nested sprites are sub-symbols rendered inside
 * `anim1`. We register the composite animation as a single `SymbolDefinition` named
 * `anim1` and drive its timeline to frame 104 (AS frame_105 ≈ end), triggering
 * signalHit at the impact frame and complete at the removal frame.
 *
 * Because `librarySymbols` is empty in the manifest, we use `textures.getFrames("anim1")`
 * (NO `lib_` prefix). The rotation/looping sub-symbol behaviours (DefineSprite_21,
 * DefineSprite_13, DefineSprite_15, DefineSprite_22) are baked into the pre-rendered
 * composite SVG frames — we do not need to instantiate them separately at runtime.
 * The only frame-script behaviour we must reproduce is:
 *   - frame_103 of DefineSprite_23: `_parent.removeMovieClip()` → complete().
 *
 * signalHit: fired at the same frame as completion (frame 103 / index 102) since there
 * is no earlier explicit hit signal in the AS source.
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
  width: 143.5,
  height: 68.1,
  offsetX: -64.35,
  offsetY: -34.05,
};

export class Spell2108 extends RuntimeSpell {
  readonly spellId = 2108;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 105-frame composite impact at target cell -------
    // The composite bakes in all sub-symbol behaviour (DefineSprite_21
    // random rotation, DefineSprite_13 looping, DefineSprite_15 spinning
    // child, DefineSprite_22 staggered instances). The only canonical
    // script we must reproduce at the TS level is DefineSprite_23/
    // frame_103/DoAction.as: `_parent.removeMovieClip()` which ends the
    // spell. We fire signalHit at the same moment since there is no
    // earlier explicit hit frame in the AS source.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 105,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS DefineSprite_23/frame_103/DoAction.as: _parent.removeMovieClip()
          // 0-based index: frame_103 → index 102
          102,
          (clip) => {
            clip.remove();
            this.runtime.signalHit();
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
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("grina_701");
    callbacks.playSound("grina_701");

    // Attach the composite anim1 clip so it starts ticking immediately.
    // The main timeline implicitly places it at frame_1; we replicate
    // that by attaching it at depth 1 on the root.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
