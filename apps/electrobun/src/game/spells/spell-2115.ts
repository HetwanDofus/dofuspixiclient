/**
 * Spell 2115 — (Carapace / Shield, Sacrieur or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2115/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile, no caster reference,
 * no dual-anchored timelines — it is a pure impact animation at the target cell.
 * The manifest has no `librarySymbols[]` entries, only a single `animations[]` entry
 * (`anim1`, 129 frames). All rendering is driven by that authored timeline.
 *
 * Canonical AS layout:
 *
 *   - DefineSprite_17 — outermost container (129 frames):
 *       frame_1:  SOMA.playSound("shield_cara")
 *       frame_127: _parent.removeMovieClip()  → spell complete
 *
 *   - DefineSprite_13 — child sprite with random initial rotation (28 frames):
 *       frame_1:  _rotation = random(360)
 *       frame_28: stop()
 *
 *   - DefineSprite_14 — child sprite with continuously spinning rotation:
 *       frame_1 / PlaceObject2_3_2 / onClipEvent(enterFrame): _rotation += 10
 *
 *   - DefineSprite_15 — child sprite (55 frames):
 *       frame_55: stop()
 *
 * The manifest has no librarySymbols. The single `anim1` animation IS the composite
 * rendering of the whole spell — it is registered as a symbol whose frameScripts
 * carry the canonical AS actions. The four DefineSprite_* blocks are sub-timelines
 * baked into the `anim1` composite; they are modelled here as the single `anim1`
 * SymbolDefinition with frame scripts at the key frames.
 *
 * Because `librarySymbols` is empty, we use `textures.getFrames("anim1")` (no lib_ prefix).
 *
 * signalHit: fired at frame_1 of the anim (immediate impact at target — the canonical
 * "shield_cara" sound on frame_1 marks the moment of effect application).
 * complete: fired at frame_127 (AS frame_127 → frameScripts index 126).
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
  width: 113.3,
  height: 95.9,
  offsetX: -47.6,
  offsetY: -58.8,
};

export class Spell2115 extends RuntimeSpell {
  readonly spellId = 2115;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — full 129-frame composite at target cell --------
    // No librarySymbols in manifest → textures.getFrames("anim1") (no lib_ prefix).
    //
    // Sub-timeline semantics baked into the composite frames:
    //
    //   DefineSprite_17/frame_1/DoAction.as:  SOMA.playSound("shield_cara")
    //     → handled in onSpellStart (main-timeline sound + signalHit)
    //
    //   DefineSprite_13/frame_1/DoAction.as:  _rotation = random(360)
    //     → baked into composite; no runtime particle needed
    //
    //   DefineSprite_14/frame_1/…/onClipEvent(enterFrame): _rotation += 10
    //     → baked into composite; visual spinning is in the SVG frames
    //
    //   DefineSprite_15/frame_55/DoAction.as: stop()
    //     → sub-timeline holds at frame 55; baked into composite
    //
    //   DefineSprite_17/frame_127/DoAction.as: _parent.removeMovieClip()
    //     → frameScripts index 126: clip.remove() + this.runtime.complete()
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 129,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          126,
          (clip) => {
            // AS DefineSprite_17/frame_127/DoAction.as: _parent.removeMovieClip()
            // This is the outermost container's removal — signal completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS DefineSprite_17/frame_1/DoAction.as: SOMA.playSound("shield_cara")
    callbacks.playSound("shield_cara");

    // Attach the anim1 composite at root so it starts playing immediately.
    // This mirrors the implicit main-timeline placement of DefineSprite_17
    // on the authored SWF main timeline.
    this.root.attach(this.anim1Sym, "anim1", 1, context);

    // Signal hit at the start of the animation — the impact (shield application)
    // coincides with the sound on frame_1. For TargetCell spells without an
    // explicit per-frame "this.end()" call, the canonical moment is frame_1.
    this.runtime.signalHit();
  }
}
