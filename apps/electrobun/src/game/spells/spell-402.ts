/**
 * Spell 402 — (Unknown name, likely a Sadida/Eniripsa spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/402/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile motion, no caster
 * reference, no duplicate/beam logic, and no dual-anchored timelines. It is
 * a single composite animation ("anim1") that plays at the target cell and
 * removes itself at frame 139, signalling completion. This is the canonical
 * TargetCell impact pattern.
 *
 * Library symbols: none (librarySymbols[] is empty in the manifest).
 *
 * Main timeline (DefineSprite_16):
 *   - frame_1/DoAction.as:   SOMA.playSound("gonfle")
 *   - frame_139/DoAction.as: stop(); _parent.removeMovieClip()
 *
 * The single animation "anim1" (141 frames, composite) is registered as the
 * root symbol. The harness places the root at the target cell. frame_0 plays
 * the sound; frame_138 (0-based) stops and completes the spell.
 *
 * signalHit: fired at frame_1 (frame index 0, the first frame of impact) —
 * the spell hits the moment it starts playing at the target cell.
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
  width: 518,
  height: 391.85,
  offsetX: -249.15,
  offsetY: -278.25,
};

export class Spell402 extends RuntimeSpell {
  readonly spellId = 402;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main composite animation at target cell ---------
    // Canonical: DefineSprite_16 (the single timeline in the SWF).
    // frame_1/DoAction.as:   SOMA.playSound("gonfle")
    // frame_139/DoAction.as: stop(); _parent.removeMovieClip()
    //
    // The manifest lists "anim1" in animations[] (NOT librarySymbols[]),
    // so textures are loaded under the bare key "anim1" (no lib_ prefix).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 141,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_16/frame_1/DoAction.as:
            //   SOMA.playSound("gonfle");
            // Sound is played in onSpellStart (main timeline frame_1 fires
            // before the runtime ticks). No action needed here beyond
            // signalling the hit — the spell lands on the first visible frame.
            this.runtime.signalHit();
          },
        ],
        [
          138,
          (clip) => {
            // AS DefineSprite_16/frame_139/DoAction.as:
            //   stop();
            //   _parent.removeMovieClip();
            clip.stop();
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
    // AS DefineSprite_16/frame_1/DoAction.as: SOMA.playSound("gonfle")
    callbacks.playSound("gonfle");

    // Attach the main animation at the root so the runtime ticks it.
    // For TargetCell the root container is already positioned at the
    // target cell by the harness/spell-view — no additional offset needed.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
