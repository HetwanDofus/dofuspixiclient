/**
 * Spell 608 — Esquive (Dodge/Sidestep).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/608/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion, no library
 * symbols that are attached at runtime via attachMovie, and no dual-anchored
 * timelines. It is a single authored animation (anim1, 168 frames) played at
 * the target cell, driven entirely by the DefineSprite_24 timeline. No
 * librarySymbols entries exist in the manifest — the entire animation is
 * pre-rendered in anim1. The AS scripts live on DefineSprite_24 which IS anim1.
 *
 * The manifest has no `librarySymbols` array, so there are no attachMovie calls
 * to worry about. The spell uses a single symbol (anim1) registered as the
 * top-level content clip.
 *
 * DefineSprite_24 timeline scripts:
 *   frame_1   (index 0):  SOMA.playSound("dodge_608")
 *   frame_28  (index 27): SOMA.playSound("dodge_608")
 *   frame_49  (index 48): SOMA.playSound("dodge_608")
 *   frame_70  (index 69): SOMA.playSound("dodge_608")
 *   frame_97  (index 96): SOMA.playSound("dodge_608")
 *   frame_145 (index 144): _parent.removeMovieClip() → complete()
 *
 * signalHit is fired at frame_28 (index 27), which is the first post-entry
 * sound cue and corresponds to the first dodge impact in the canonical anim.
 *
 * Main timeline: attaches the anim1 clip at root; the clip drives itself.
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
  width: 96.45,
  height: 66.2,
  offsetX: -47.7,
  offsetY: -54.85,
};

export class Spell608 extends RuntimeSpell {
  readonly spellId = 608;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — full 168-frame dodge animation at target cell ---
    // AS: DefineSprite_24 is the sole symbol; its frame scripts drive
    // sound playback and completion. The anim1 animation in the
    // manifest corresponds directly to this sprite.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 168,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip, _ctx) => {
            // AS: DefineSprite_24/frame_1/DoAction.as
            // SOMA.playSound("dodge_608");
            // (sound emitted from onSpellStart for frame 0 to avoid
            // needing a captured callback; subsequent frames use the
            // stored reference below)
          },
        ],
        [
          27,
          (_clip, _ctx) => {
            // AS: DefineSprite_24/frame_28/DoAction.as
            // SOMA.playSound("dodge_608");
            this.soundCallback?.("dodge_608");
            // First impact cue — signal hit here.
            this.runtime.signalHit();
          },
        ],
        [
          48,
          (_clip, _ctx) => {
            // AS: DefineSprite_24/frame_49/DoAction.as
            // SOMA.playSound("dodge_608");
            this.soundCallback?.("dodge_608");
          },
        ],
        [
          69,
          (_clip, _ctx) => {
            // AS: DefineSprite_24/frame_70/DoAction.as
            // SOMA.playSound("dodge_608");
            this.soundCallback?.("dodge_608");
          },
        ],
        [
          96,
          (_clip, _ctx) => {
            // AS: DefineSprite_24/frame_97/DoAction.as
            // SOMA.playSound("dodge_608");
            this.soundCallback?.("dodge_608");
          },
        ],
        [
          144,
          (clip, _ctx) => {
            // AS: DefineSprite_24/frame_145/DoAction.as
            // _parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture the sound callback so frame scripts can call it.
    this.soundCallback = callbacks.playSound;

    // AS: DefineSprite_24/frame_1/DoAction.as — SOMA.playSound("dodge_608")
    // Play the entry sound immediately.
    callbacks.playSound("dodge_608");

    // Attach the anim1 clip at the root (target cell anchor).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
