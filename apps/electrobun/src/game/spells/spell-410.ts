/**
 * Spell 410 — Explosion (likely Iop/generic).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/410/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no projectile symbols (move/shoot),
 * no caster-side anchoring, no duplicate/beam logic, and no dual-anchored
 * timelines. The spell is a single impact animation at the target cell.
 * The manifest has no librarySymbols[] — only a single `animations[]` entry
 * named "anim1" (96 frames). The AS scripts reference DefineSprite_6 (the
 * anim1 inner sprite, 52 frames, auto-stop at frame 52) and DefineSprite_8
 * (the outer 96-frame shell whose frame_94 fires _parent.removeMovieClip).
 *
 * Library symbols:
 *   - "anim1" (DefineSprite_8, 96 frames) — outer shell. frame_1 is the
 *     entry point; frame_94 calls _parent.removeMovieClip() → spell complete.
 *     Contains an inner DefineSprite_6 sub-sprite (anim1_inner, 52 frames)
 *     that sets a random rotation + scale on frame_1 and stops at frame_52.
 *
 * Wait — re-reading the manifest more carefully: there is only ONE animations
 * entry ("anim1") with 96 frames, and NO librarySymbols. The scripts folder
 * has DefineSprite_6 (52-frame sub-sprite behaviour) and DefineSprite_8
 * (94-frame outer). Since there are no librarySymbols[] and no attachMovie
 * calls visible in the AS, the anim1 animation IS the main content and its
 * frame textures drive the visual. DefineSprite_8 is the container for anim1
 * frames.
 *
 * Given no librarySymbols and no attachMovie, the cleanest 1:1 mapping is:
 *   - Register "anim1" as a SymbolDefinition using textures.getFrames("anim1")
 *     (no lib_ prefix — it's in animations[], not librarySymbols[]).
 *   - frame_1 (index 0): port DefineSprite_6/frame_1 — random rotation,
 *     random scale 30–79.
 *   - frame_52 (index 51): port DefineSprite_6/frame_52 — stop().
 *   - frame_94 (index 93): port DefineSprite_8/frame_94 — _parent.removeMovieClip
 *     → complete(). Also signal hit here (TargetCell — harness does NOT do it).
 *   - onSpellStart attaches anim1 at root and plays the "explosion" sound.
 *
 * Main timeline: frame_1/DoAction.as → SOMA.playSound("explosion").
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
  width: 221,
  height: 58.45,
  offsetX: -54.85,
  offsetY: -50.05,
};

export class Spell410 extends RuntimeSpell {
  readonly spellId = 410;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // "anim1" is in animations[] only (no librarySymbols[]) so we use
    // textures.getFrames("anim1") — NO lib_ prefix.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 96,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS DefineSprite_6/frame_1/DoAction.as
          // _rotation = random(360);
          // t = random(50) + 30;
          // _xscale = t;
          // _yscale = t;
          0,
          (clip) => {
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            const t = Math.floor(Math.random() * 50) + 30;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
          },
        ],
        [
          // AS DefineSprite_6/frame_52/DoAction.as
          // stop();
          51,
          (clip) => {
            clip.stop();
          },
        ],
        [
          // AS DefineSprite_8/frame_94/DoAction.as
          // _parent.removeMovieClip();
          // For TargetCell displayType, we signal hit at the impact frame
          // and complete here (this IS the outer mc removal).
          93,
          (clip) => {
            clip.remove();
            this.runtime.signalHit();
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
    // AS frame_1/DoAction.as: SOMA.playSound("explosion");
    callbacks.playSound("explosion");

    // Attach anim1 at root so it starts playing at the target cell.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
