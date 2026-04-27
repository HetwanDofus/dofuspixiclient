/**
 * Spell 609 — (Unknown name, likely a self-buff/aura on target cell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/609/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile, no caster
 * reference, no `move`/`shoot`/`duplicate` symbols, and no `_parent.cellFrom`
 * / `_parent.cellTo` world-absolute positioning. The single animated composite
 * `anim1` plays at the target cell. Default TargetCell is correct.
 *
 * Manifest analysis:
 *   - `librarySymbols`: none (empty). The manifest has ONE `animations[]`
 *     entry: `anim1` (150 frames, isComposite). No `lib_` prefix.
 *   - `DefineSprite_13` (= anim1, the main composite sprite, 150 frames):
 *       frame_148/DoAction.as: `_parent.removeMovieClip()` → complete().
 *       frame_76 has a placed child (PlaceObject2_6_2) with onClipEvent(enterFrame):
 *         `_alpha = random(20) + 80; _rotation = random(360);`
 *       (This child is authored/placed by the SWF timeline, not by AS
 *        attachMovie, so its clip-event behaviour is baked into the anim1
 *        composite frames. We treat anim1 as a single-sprite symbol.)
 *   - `DefineSprite_7` has a placed child (PlaceObject2_6_1) with
 *     onClipEvent(enterFrame):
 *         `_alpha = random(20) + 80; _rotation = random(360);`
 *       DefineSprite_7 is a sub-symbol inside the anim1 composite; it also
 *       appears as authored content baked into the composite frames.
 *
 * Because neither DefineSprite_7 nor the inner child of DefineSprite_13 are
 * ever `attachMovie`-d (no DoAction.as calls attachMovie anywhere in the
 * script set), we do NOT need to register them as library symbols. The visual
 * content is fully expressed by the 150-frame `anim1` composite texture strip.
 *
 * signalHit: fired at the canonical first visual impact. For a simple
 * self-contained composite like this, frame 0 (the very start) is the
 * impact moment — there is no separate projectile landing event. We fire
 * signalHit on frame 0 of anim1.
 *
 * complete(): fired from the canonical frame_148 script (`_parent.removeMovieClip()`
 * → frameScripts.set(147, ...)).
 *
 * Main timeline: no SOMA.playSound was decompiled; onSpellStart is a no-op.
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
  width: 67.15,
  height: 144.5,
  offsetX: -28.95,
  offsetY: -134.35,
};

export class Spell609 extends RuntimeSpell {
  readonly spellId = 609;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 150-frame composite impact animation -----------
    // Corresponds to DefineSprite_13 in the SWF (the outer composite).
    // The inner DefineSprite_7 and its placed child flicker effects are
    // baked into the composite texture frames — no runtime attachMovie needed.
    //
    // frame_0:  signal hit (impact starts immediately).
    // frame_147 (AS frame_148): _parent.removeMovieClip() → complete().
    //   AS: scripts/DefineSprite_13/frame_148/DoAction.as
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 150,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // First frame of the impact composite — signal hit immediately.
            this.runtime.signalHit();
          },
        ],
        [
          147,
          (clip) => {
            // AS: DefineSprite_13/frame_148/DoAction.as
            // `_parent.removeMovieClip();`
            // anim1 is a direct child of root; removing its parent (root)
            // ends the spell.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // The main timeline places anim1 at root on frame_1 (implicit authored
    // placement). Attach it explicitly so it starts ticking from the next
    // runtime frame.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
