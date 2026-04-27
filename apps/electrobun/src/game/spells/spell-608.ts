/**
 * Spell 608 — Dodge (esquive, self-buff style).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/608/scripts/scripts/
 *
 * Layout:
 *   - Single animation `anim1` (168 frames). No library symbols, no
 *     `attachMovie` calls anywhere. The manifest has no `librarySymbols[]`
 *     entries and `requiresTypeScript: false`.
 *   - One authored sprite, `DefineSprite_24`, whose frame scripts are:
 *       frame_1   → SOMA.playSound("dodge_608")
 *       frame_28  → SOMA.playSound("dodge_608")
 *       frame_49  → SOMA.playSound("dodge_608")
 *       frame_70  → SOMA.playSound("dodge_608")
 *       frame_97  → SOMA.playSound("dodge_608")
 *       frame_145 → _parent.removeMovieClip()  ← spell complete
 *
 * displayType = TargetCell (11).
 *   The spell has no caster reference, no projectile, no beam. It is a
 *   single animated impact placed at the target cell. This is the
 *   canonical TargetCell pattern.
 *
 * Because `librarySymbols` is empty, the whole animation is delivered
 * as the `anim1` top-level entry. We register a single symbol whose
 * textures come from `textures.getFrames("anim1")` (no `lib_` prefix).
 *
 * signalHit: fired at frame_28 (first repeat of the dodge sound after
 * the initial impact), matching the canonical "something landed" moment.
 * complete: fired at frame_145 mirroring `_parent.removeMovieClip()`.
 *
 * Main timeline: onSpellStart plays the entry sound and attaches the
 * anim1 symbol, since the top-level SWF merely places DefineSprite_24
 * on its stage.
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

  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 (= DefineSprite_24) — 168-frame dodge animation ----
    // No librarySymbols[] in the manifest; textures come from the bare
    // "anim1" animation entry.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 168,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS: DefineSprite_24/frame_1/DoAction.as → SOMA.playSound("dodge_608")
          // (frame_1 entry sound is fired via onSpellStart / attach entry-frame;
          //  we include it here as well so re-attaches also play it)
          0,
          (_clip) => {
            this.playSound?.("dodge_608");
          },
        ],
        [
          // AS: DefineSprite_24/frame_28/DoAction.as → SOMA.playSound("dodge_608")
          27,
          (_clip) => {
            this.playSound?.("dodge_608");
            // First repeat of the dodge sound — canonical hit moment.
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_24/frame_49/DoAction.as → SOMA.playSound("dodge_608")
          48,
          (_clip) => {
            this.playSound?.("dodge_608");
          },
        ],
        [
          // AS: DefineSprite_24/frame_70/DoAction.as → SOMA.playSound("dodge_608")
          69,
          (_clip) => {
            this.playSound?.("dodge_608");
          },
        ],
        [
          // AS: DefineSprite_24/frame_97/DoAction.as → SOMA.playSound("dodge_608")
          96,
          (_clip) => {
            this.playSound?.("dodge_608");
          },
        ],
        [
          // AS: DefineSprite_24/frame_145/DoAction.as → _parent.removeMovieClip()
          144,
          (clip) => {
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
    // Capture the sound callback so frame scripts (which don't receive
    // callbacks directly) can play sounds.
    this.playSound = callbacks.playSound;

    // Main timeline frame_1: play the entry sound and place
    // DefineSprite_24 (anim1) on the stage. The attach call fires the
    // entry-frame script (frame_1 / index 0) which also calls
    // playSound, matching canonical AS behaviour where the symbol's
    // own frame_1 DoAction fires immediately on placement.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
