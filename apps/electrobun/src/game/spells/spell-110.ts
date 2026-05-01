/**
 * Spell 110 — Carapace (Feca shield).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/110/scripts/scripts/
 *
 * displayType=11 (TargetCell). Pure impact-at-target spell with no projectile
 * and no caster reference. The animation consists of two authored sprites:
 *
 *   - DefineSprite_7 (anim1, 129 frames) — the outer shield composite.
 *       frame_1:   SOMA.playSound("shield_cara")
 *       frame_127: _parent.removeMovieClip() → signalHit + spell complete
 *
 *   - DefineSprite_5 (sprite5, sub-composite inside anim1) — an inner layer.
 *       frame_67: stop() — halts its own timeline at frame 67.
 *
 * Main timeline: implicitly places DefineSprite_7 (anim1) at depth 1.
 * DefineSprite_7 in turn places DefineSprite_5 on its own timeline.
 *
 * signalHit: fired at frame 127 of anim1 (0-based: 126) for displayType 11.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 * Textures loaded via bare animation names (no lib_ prefix).
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

export class Spell110 extends RuntimeSpell {
  readonly spellId = 110;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;
  private sprite5Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite5 — inner sub-composite layer inside anim1 --------
    // AS DefineSprite_5/frame_67/DoAction.as:
    //   stop();
    // This inner sprite halts its own timeline at frame 67 (0-based: 66).
    // It has no authored frame textures of its own (container-only).
    this.sprite5Sym = {
      name: "sprite5",
      totalFrames: 67,
      frames: textures.getFrames("sprite5"),
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          66,
          (clip) => {
            // AS DefineSprite_5/frame_67/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- anim1 — 129-frame outer shield composite ----------------
    // Corresponds to DefineSprite_7 in canonical AS.
    //
    // AS DefineSprite_7/frame_1/DoAction.as:
    //   SOMA.playSound("shield_cara");
    // Sound is fired in onSpellStart when this clip is first attached.
    //
    // AS DefineSprite_7/frame_127/DoAction.as:
    //   _parent.removeMovieClip();
    // Signals hit and completes the spell.
    //
    // DefineSprite_7 also places DefineSprite_5 on its internal timeline
    // at depth 1. We attach sprite5 from anim1's frame_0 script so it
    // runs alongside the outer timeline.
    // anim1 has 129 logical frames in the SWF, but frames 100-128 are all
    // post-`_parent.removeMovieClip()` placeholder content. The
    // svg-spritesheet dedupes those trailing placeholder frames into a
    // single unique cell — but vello's strip layout + Pixi texture
    // sub-rectangle math don't agree on how to address them past the
    // unique-cell count, so logical frames 100-128 end up sampling the
    // strip's frame-0 cell at runtime (the "frame 1 re-displays after the
    // anim ends" symptom).
    //
    // Mirror the canonical visual end by terminating at the last frame
    // with real content (frame 99, AS frame_100) rather than at AS
    // frame_127. The user sees the same shield form-up, then the spell
    // completes — no broken-texture tail.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 100,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // DefineSprite_7 places DefineSprite_5 on its timeline at frame 1.
            // Attach sprite5 as a child of anim1 so its frame_67 stop() fires.
            clip.attach(this.sprite5Sym, "sprite5", 1, ctx);
          },
        ],
        [
          99,
          (clip) => {
            // Last visible frame — terminate before the placeholder tail
            // that the AS canonical script would have hit at frame_127.
            this.runtime.signalHit();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite5Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS DefineSprite_7/frame_1/DoAction.as: SOMA.playSound("shield_cara")
    // Fired as the anim1 clip is first placed on the main timeline.
    callbacks.playSound("shield_cara");

    // Attach anim1 at depth 1 on root — mirrors the implicit main-timeline
    // PlaceObject2 that places DefineSprite_7 at the start of the spell.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
