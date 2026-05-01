/**
 * Spell 1104 — (Unknown name, likely a Sacrieur/misc spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1104/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile, no caster reference,
 * no `move`/`shoot`/`duplicate` symbols, and no `_parent.cellFrom`/`cellTo` usage.
 * It is a single impact animation at the target cell. The animation is driven by
 * a single `anim1` entry in animations[] (no librarySymbols), so this is the
 * simplest pattern: one authored timeline placed on the root, playing to
 * completion.
 *
 * Canonical AS layout:
 *   - scripts/frame_1/DoAction.as        → SOMA.playSound("autre_1104")
 *   - scripts/frame_137/DoAction.as      → this.end()  → signalHit
 *   - scripts/frame_159/DoAction.as      → this.removeMovieClip() → complete
 *   - scripts/DefineSprite_4/frame_1/DoAction.as   → gotoAndPlay(random(40) + 2)
 *   - scripts/DefineSprite_4/frame_95/DoAction.as  → gotoAndPlay(44)
 *   - scripts/DefineSprite_5/frame_1/DoAction.as   → gotoAndPlay(random(40) + 2)
 *   - scripts/DefineSprite_5/frame_85/DoAction.as  → gotoAndPlay(56)
 *
 * DefineSprite_4 and DefineSprite_5 are sub-sprites of anim1. Their timelines
 * loop internally: frame_1 jumps to a random offset in [2..41], and frame_95
 * (DS4) / frame_85 (DS5) loop back to frame 44 / frame 56 respectively.
 * These looping sub-sprites are part of the pre-rendered composite `anim1`
 * frames but the outer timeline (frame_137 → signalHit, frame_159 → complete)
 * drives the spell lifecycle.
 *
 * Because anim1 is an `isComposite: true` animation with 98 frames but the
 * outer main timeline runs to frame 159, we register `anim1` as the sole
 * symbol and drive the lifecycle signals from the main-timeline frame scripts.
 * The `anim1` symbol's 98-frame loop covers the visual; the outer frame_137
 * and frame_159 scripts fire from the root clip's own frameScripts (which we
 * attach via the anim1Sym definition used for the root, or via the root's
 * own frameScripts in onSpellStart — we use the root directly via a
 * dedicated rootSym whose frameScripts carry the outer timeline scripts).
 *
 * Implementation approach:
 *   - Register `anim1` symbol (98 frames, from textures.getFrames("anim1")).
 *   - The root clip IS the outer timeline (159 frames). We give root a symbol
 *     with totalFrames=159 and the two lifecycle frameScripts (136 and 158).
 *     The root has no frames of its own (frames: []); the visual is provided
 *     by an attached child `anim1` clip.
 *   - onSpellStart attaches the anim1 child at depth 1.
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
  width: 99.95,
  height: 59.05,
  offsetX: -49.95,
  offsetY: -20.25,
};

export class Spell1104 extends RuntimeSpell {
  readonly spellId = 1104;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 98-frame composite impact animation at target cell ----
    // The visual content of the spell. Plays through its 98 frames and loops.
    // The outer main timeline (via root frameScripts) drives signalHit at
    // frame 137 and complete at frame 159.
    //
    // DefineSprite_4 and DefineSprite_5 are internal sub-sprites of anim1
    // whose looping behavior (frame_1 → random offset, frame_95/frame_85 →
    // loop back) is baked into the pre-rendered composite SVG frames.
    // The outer lifecycle signals (frame_137 / frame_159) are what matter
    // for the runtime.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 98,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("autre_1104");
    callbacks.playSound("autre_1104");

    // Attach the anim1 child on the root. The outer main-timeline lifecycle
    // scripts (frame_137 = signalHit, frame_159 = complete) are driven by
    // root-level frameScripts which we install here by patching the root
    // clip's own tickOneFrame via a thin wrapper symbol attached as the
    // primary visual.
    //
    // We attach anim1 as a child so it plays its 98-frame loop while the
    // root's own timeline (driven by root.vars and frameScripts set below)
    // counts to 159.
    this.root.attach(this.anim1Sym, "anim1", 1, context);

    // Install the outer main-timeline frame scripts on the root clip directly.
    // The root is a SpellClip with totalFrames=1 by default (symbol: null).
    // We need it to count to 159, so we override its timeline by attaching
    // a container symbol to the root. Since we cannot directly modify
    // root's totalFrames (it was constructed with symbol=null, giving
    // totalFrames=1), we use a dedicated "outer timeline" approach:
    // a second container symbol on the root that drives the lifecycle.
    //
    // Simpler: attach a lifecycle clip at depth 0 that has totalFrames=159
    // and carries the two frame scripts.
    const lifecycleSym: SymbolDefinition = {
      name: "_lifecycle",
      totalFrames: 159,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          // AS scripts/frame_137/DoAction.as: this.end() → signalHit
          136,
          (_clip) => {
            this.runtime.signalHit();
          },
        ],
        [
          // AS scripts/frame_159/DoAction.as: this.removeMovieClip() → complete
          158,
          (clip) => {
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(lifecycleSym);
    this.root.attach(lifecycleSym, "_lifecycle", 0, context);
  }
}
