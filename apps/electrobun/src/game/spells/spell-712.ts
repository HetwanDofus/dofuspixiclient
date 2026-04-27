/**
 * Spell 712 — Grina (likely a Sadida / earth-type spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/712/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has a single composite animation
 * (`anim1`) anchored at the target cell. There are no projectile symbols
 * (`move` / `shoot`), no `librarySymbols[]` entries, no caster-reference
 * children, and no `_parent.cellFrom` / `_parent.cellTo` world-absolute
 * positioning. The entire visual is a flat 135-frame authored timeline that
 * plays at the target cell. Default TargetCell is therefore correct.
 *
 * Canonical AS layout:
 *   - `frame_1/DoAction.as`: SOMA.playSound("grina_704") — main-timeline
 *     sound cue; no child attaches.
 *
 *   - `DefineSprite_9` — the primary composite sprite (anim1 in manifest).
 *     135 frames total (manifest stopFrame=132 → canonical stop at frame
 *     133 in AS, i.e. frameScripts index 132).
 *       frame_133 (index 132): stop(); _parent.removeMovieClip(); → complete.
 *       frame_82  (index 81):  a PlaceObject2 child (depth 26) carries
 *                              onClipEvent(enterFrame): _parent._alpha -= 2.3
 *                              — a fade-out effect applied to the whole
 *                              DefineSprite_9 container, starting at frame 82.
 *
 *   - `DefineSprite_3` — a sub-symbol that on frame_1 does
 *     gotoAndStop(random(3) + 1); — picks a random sub-frame (1-3) and
 *     stops. Used to add visual variation.
 *
 *   - `DefineSprite_5` — a sub-symbol with labelled frame groups
 *     ("traj1"). frame_1 picks random(2) (always 0 or 1) and jumps to
 *     "traj1" then plays. Stops at frames 58, 118, 178. All three branches
 *     land at "traj1" unconditionally — the random check is vestigial AS.
 *
 * Since librarySymbols[] is empty in the manifest, the entire animation is
 * driven by the single `anim1` timeline. The `DefineSprite_3` / `DefineSprite_5`
 * composites are baked into the anim1 SVG frames by the extractor, so we do
 * not need to register them as separate library symbols. We register `anim1`
 * as the root symbol, apply the fade onEnterFrame starting at the canonical
 * frame 82 via a frameScripts trigger, and fire complete() at frame 133
 * (index 132).
 *
 * signalHit: fired at the first meaningful impact frame. The canonical AS
 * does not have an explicit `end()` call, so we fire it at frame 1 (index 0)
 * when the animation starts playing at the target cell — matching the
 * typical TargetCell impact pattern where the effect IS the hit.
 * Alternatively, if there is a more specific impact sub-frame it would be
 * noted; absent AS evidence we fire signalHit at frame 0 (onset).
 *
 * Library symbols: none (librarySymbols[] is empty).
 * Main timeline: SOMA.playSound("grina_704").
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
  width: 390.9,
  height: 224.75,
  offsetX: -198.15,
  offsetY: -175.9,
};

export class Spell712 extends RuntimeSpell {
  readonly spellId = 712;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 135-frame composite impact animation at target ----
    // This is the sole visual: a flat authored timeline baked into SVG
    // frames by the extractor. No sub-attachments needed at runtime
    // because DefineSprite_3 and DefineSprite_5 composites are rendered
    // into the extracted frames.
    //
    // The canonical DefineSprite_9 carries:
    //   - frame_133 / DoAction.as: stop(); _parent.removeMovieClip();
    //   - frame_82  / PlaceObject2_8_26 / onClipEvent(enterFrame):
    //       _parent._alpha -= 2.3   (fade the whole composite)
    //
    // We model the fade as an onEnterFrame on the anim1 clip itself,
    // activated via a frameScripts entry at frame 82 (index 81). Before
    // that frame the handler is null, so we set it at 81 and it persists
    // thereafter. This mirrors the PlaceObject2 child whose enterFrame
    // mutates _parent (= DefineSprite_9 = our anim1 clip).

    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 135,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          // AS: frame_1/DoAction.as (main timeline already played sound;
          // this is the anim1 entry frame — signal hit at onset).
          (_clip, _ctx) => {
            // signalHit: no explicit AS "end()" call; fire at animation
            // onset (frame 1 = index 0) as this is the impact frame for
            // a TargetCell spell with no projectile.
            this.runtime.signalHit();
          },
        ],
        [
          81,
          // AS: DefineSprite_9/frame_82/PlaceObject2_8_26/
          //     CLIPACTIONRECORD onClipEvent(enterFrame).as
          // A placed child at depth 26 runs: _parent._alpha -= 2.3
          // Starting at frame 82 (index 81) the whole clip fades by
          // 2.3 (out of 100) per Flash frame. We activate the fade by
          // installing an onEnterFrame handler on the clip itself.
          (clip) => {
            // Install the per-frame fade handler starting now.
            clip.onEnterFrame = (c) => {
              // AS: _parent._alpha -= 2.3   (_alpha is 0-100 in AS,
              // runtime uses 0-1, so subtract 2.3/100 per frame).
              c.alpha -= 2.3 / 100;
            };
          },
        ],
        [
          132,
          // AS: DefineSprite_9/frame_133/DoAction.as
          //   stop();
          //   _parent.removeMovieClip();
          (clip) => {
            clip.stop();
            clip.remove();
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
    // AS: frame_1/DoAction.as — SOMA.playSound("grina_704");
    callbacks.playSound("grina_704");

    // Attach the anim1 composite at root so it starts ticking from the
    // next runtime frame. For TargetCell (displayType=11) the container
    // is already positioned at the target cell by the harness; anim1
    // lives at (0,0) inside that container.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
