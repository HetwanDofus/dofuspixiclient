/**
 * Spell 307 — Setag (Osamodas).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/307/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile, no caster reference,
 * no `move`/`shoot`/`duplicate` symbols, and no `_parent.cellFrom` usage.
 * It is a single impact animation at the target cell — the canonical pattern
 * for TargetCell (11).
 *
 * Manifest layout:
 *   - `animations: [{name: "anim1", frameCount: 129}]` — single composite
 *     animation, no librarySymbols[]. All rendering is driven by the bare
 *     `anim1` timeline.
 *   - No librarySymbols[]. Do NOT use `lib_` prefix anywhere.
 *
 * Symbol structure (two nested DefineSprite layers):
 *   - `anim1` — outer 129-frame timeline (DefineSprite_12).
 *       frame_1:  SOMA.playSound("setag_307")
 *       frame_127: _parent.removeMovieClip() → spell complete
 *     Contains an inner DefineSprite_10 (85-frame sub-clip baked into the
 *     composite SVG frames); its only script is:
 *       frame_85: stop()
 *     Since DefineSprite_10 is baked into the composite `anim1` SVG frames
 *     and has no onClipEvent handlers, it does not need a separate runtime
 *     symbol — its `stop()` at frame 85 is an authoring artefact that has
 *     no effect on the outer clip's playback. The outer timeline plays
 *     straight through to frame 127 and then removes itself.
 *
 * Main timeline: attaches `anim1` at root; displayType=11 places container
 *   at target cell automatically.
 *
 * signalHit: fired at frame_1 of anim1 (the spell is an instant impact —
 *   the hit registers as the animation starts playing, consistent with the
 *   sound cue on frame_1).
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

export class Spell307 extends RuntimeSpell {
  readonly spellId = 307;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — outer 129-frame impact composite ----------------
    // Corresponds to DefineSprite_12 in the canonical SWF.
    //
    // AS DefineSprite_12/frame_1/DoAction.as:
    //   SOMA.playSound("setag_307");
    //
    // AS DefineSprite_12/frame_127/DoAction.as:
    //   _parent.removeMovieClip();
    //
    // The inner DefineSprite_10 (frame_85: stop()) is baked into the
    // composite SVG frames and carries no onClipEvent handlers — it
    // requires no separate runtime symbol.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 129,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_12/frame_1/DoAction.as:
            //   SOMA.playSound("setag_307");
            // Sound is played via onSpellStart (callbacks available there).
            // signalHit: the spell is an instant impact — fire hit at the
            // first frame when the animation begins.
            this.runtime.signalHit();
          },
        ],
        [
          126,
          (clip) => {
            // AS DefineSprite_12/frame_127/DoAction.as:
            //   _parent.removeMovieClip();
            // `clip` here is anim1 whose parent is root — removing root
            // and signalling complete ends the spell.
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
    // AS DefineSprite_12/frame_1/DoAction.as: SOMA.playSound("setag_307");
    // The sound fires on the main timeline / frame_1 of the outer sprite.
    callbacks.playSound("setag_307");

    // Attach anim1 at root so it starts ticking from the next runtime frame.
    // displayType=11 (TargetCell) positions the container at the target cell;
    // anim1 is centred on that anchor via its calculated anchorX/Y.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
