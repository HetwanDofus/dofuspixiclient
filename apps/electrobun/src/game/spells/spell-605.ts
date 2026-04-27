/**
 * Spell 605 — Esquive (Dodge/Sidestep, likely Iop or Sacrier).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/605/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no move/shoot/duplicate
 * symbols, no projectile motion, no dual-anchor. It is a single
 * self-contained animated sprite (anim1, 135 frames) that plays at the
 * target cell. The canonical structure is:
 *
 *   - DefineSprite_29 (the outer authored timeline, 135 frames):
 *       frame_28:  plays "dodge_605" + "pas_homme_normal" sounds.
 *       frame_37:  has a placed child (PlaceObject2_17_1) whose
 *                  onEnterFrame randomly flickers _alpha ∈ [20,90).
 *       frame_40:  plays "pas_homme_normal" again.
 *       frame_133: _parent.removeMovieClip() → spell complete.
 *
 *   - DefineSprite_21 (a sub-sprite placed at some earlier frame,
 *     referenced by PlaceObject2_19_1 in its frame_1 clip event):
 *       onEnterFrame: _alpha = 20 + random(70) — same flicker pattern.
 *
 * The manifest has no librarySymbols[] — only animations: ["anim1"].
 * All content is driven by the single anim1 timeline; no attachMovie
 * calls exist. We model DefineSprite_29 as the "anim1" symbol and
 * embed all frame scripts + clip event handlers inside it.
 *
 * Since DefineSprite_29 and DefineSprite_21 both have the same
 * _alpha flicker pattern on placed children, and since the manifest
 * exposes only a single composite "anim1" timeline (not separate
 * per-sub-sprite textures), we treat the full 135-frame composite as
 * one symbol. The two onEnterFrame flickering instances are modelled
 * as a single repeating alpha jitter on the anim1 clip itself — the
 * visual result is identical to what a viewer sees (the composite
 * already bakes both layers). Sound cues and completion timing are
 * the load-bearing parts and are ported exactly.
 *
 * signalHit: fired at frame_28 (first footstep + dodge sound → the
 * dodge is the hit moment). No harness auto-signal because displayType
 * is TargetCell (11), not ProjectileBallistic.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 * The sole symbol registered is "anim1" from animations[].
 *
 * Main timeline: attaches anim1 in onSpellStart.
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
  width: 59.5,
  height: 60.85,
  offsetX: -31.25,
  offsetY: -108.2,
};

export class Spell605 extends RuntimeSpell {
  readonly spellId = 605;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;
  private soundCallbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 135-frame composite timeline at target cell ----
    // Models DefineSprite_29 (the outer 135-frame sprite) plus the
    // embedded flicker behaviour from DefineSprite_21/PlaceObject2_19_1
    // and DefineSprite_29/frame_37/PlaceObject2_17_1.
    //
    // Both placed children share the same onClipEvent(enterFrame):
    //   _alpha = 20 + random(70)
    // Since the manifest bakes them into the composite frames, we
    // apply the flicker to the anim1 clip itself as an onEnterFrame
    // so the rendered result matches the canonical visual output.
    //
    // AS DefineSprite_21/frame_1/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // AS DefineSprite_29/frame_37/PlaceObject2_17_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 135,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      onEnterFrame: (clip) => {
        // AS: _alpha = 20 + random(70)  (both placed-child flickerers)
        clip.alpha = (20 + Math.floor(Math.random() * 70)) / 100;
      },

      frameScripts: new Map([
        [
          27,
          (_clip) => {
            // AS DefineSprite_29/frame_28/DoAction.as
            // SOMA.playSound("dodge_605");
            // SOMA.playSound("pas_homme_normal");
            this.soundCallbacks?.playSound("dodge_605");
            this.soundCallbacks?.playSound("pas_homme_normal");
            // frame_28 is the dodge impact — signal hit here.
            this.runtime.signalHit();
          },
        ],
        [
          39,
          (_clip) => {
            // AS DefineSprite_29/frame_40/DoAction.as
            // SOMA.playSound("pas_homme_normal");
            this.soundCallbacks?.playSound("pas_homme_normal");
          },
        ],
        [
          132,
          (clip) => {
            // AS DefineSprite_29/frame_133/DoAction.as
            // _parent.removeMovieClip();
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
    // Capture callbacks so frame scripts can fire sounds.
    this.soundCallbacks = callbacks;

    // Attach the main composite timeline at depth 1.
    // DisplayType=11 (TargetCell): the root container is already
    // positioned at the target cell by the harness; anim1 sits at
    // local (0,0) which is the canonical target-cell origin.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
