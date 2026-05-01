/**
 * Spell 111 — Artillerie (Feca earth spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/111/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no projectile motion, no caster reference,
 * no `move`/`shoot`/`duplicate` pattern — a single composite animation plays at
 * the target cell. This matches the TargetCell pattern.
 *
 * AS layout:
 *   - DefineSprite_3 — random-offset helper (1 frame).
 *       frame_1: gotoAndPlay(random(60) + 2) → jumps to a random frame [2..61]
 *       so instances start at different points in the cycle (stagger effect).
 *
 *   - DefineSprite_13 — main animation body (at least 31 frames shown in scripts).
 *       frame_1:  SOMA.playSound("arty_111")
 *       frame_10: SOMA.playSound("arty_111")
 *       frame_19: SOMA.playSound("arty_111")
 *       frame_31: SOMA.playSound("arty_111")
 *
 *   - DefineSprite_14 — outer container / root timeline (67 frames).
 *       frame_67: _parent.removeMovieClip(); stop() → spell complete
 *
 * The manifest has no `librarySymbols[]` — all content is in `animations: ["anim1"]`.
 * The anim1 animation (69 frames, isComposite) is the pre-rendered composite of the
 * whole spell. The AS scripts above are embedded in the authored timeline sub-sprites.
 *
 * Since there are no separate library symbols to attach at runtime, and the manifest
 * has a single `anim1` animation entry, we register `anim1` as a container symbol
 * with its frame textures and embed the canonical frame scripts from DefineSprite_13
 * (sounds) and DefineSprite_14 (removal / completion). The sounds listed in
 * manifest.json at frames 0, 9, 18, 30 correspond 1:1 with AS frames 1, 10, 19, 31.
 *
 * DefineSprite_3's random gotoAndPlay would stagger a looping sub-sprite; since the
 * exporter has baked all authored sub-sprites into the composite anim1 frames, the
 * stagger is already represented visually. We register the symbol but its frame_1
 * script is a no-op here (no sub-sprite to redirect).
 *
 * Completion: DefineSprite_14/frame_67 calls `_parent.removeMovieClip()` — this is
 * the outermost removal, so we map it to `this.runtime.complete()` at frame index 66.
 * signalHit is fired at the canonical impact frame (frame_1 / index 0, first sound).
 *
 * Library symbols: none (librarySymbols[] is absent from manifest).
 * Main animation: anim1 (textures.getFrames("anim1"), 69 frames).
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
  width: 158,
  height: 168.15,
  offsetX: -82.55,
  offsetY: -162.05,
};

export class Spell111 extends RuntimeSpell {
  readonly spellId = 111;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — composite animation at target cell ---------------
    // Combines DefineSprite_13 (sound triggers) and DefineSprite_14
    // (removal) into a single symbol driven by frame scripts.
    //
    // AS DefineSprite_13/frame_1/DoAction.as:  SOMA.playSound("arty_111")
    // AS DefineSprite_13/frame_10/DoAction.as: SOMA.playSound("arty_111")
    // AS DefineSprite_13/frame_19/DoAction.as: SOMA.playSound("arty_111")
    // AS DefineSprite_13/frame_31/DoAction.as: SOMA.playSound("arty_111")
    // AS DefineSprite_14/frame_67/DoAction.as: _parent.removeMovieClip(); stop();
    //
    // Frame mapping (AS 1-based → runtime 0-based):
    //   AS frame_1  → index 0  (first sound + signalHit)
    //   AS frame_10 → index 9
    //   AS frame_19 → index 18
    //   AS frame_31 → index 30
    //   AS frame_67 → index 66 (removal + complete)
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 69,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_13/frame_1/DoAction.as
            this.soundCallback?.("arty_111");
            // First frame = canonical hit (impact lands at target cell).
            this.runtime.signalHit();
          },
        ],
        [
          9,
          (_clip) => {
            // AS DefineSprite_13/frame_10/DoAction.as
            this.soundCallback?.("arty_111");
          },
        ],
        [
          18,
          (_clip) => {
            // AS DefineSprite_13/frame_19/DoAction.as
            this.soundCallback?.("arty_111");
          },
        ],
        [
          30,
          (_clip) => {
            // AS DefineSprite_13/frame_31/DoAction.as
            this.soundCallback?.("arty_111");
          },
        ],
        [
          66,
          (clip) => {
            // AS DefineSprite_14/frame_67/DoAction.as
            // _parent.removeMovieClip(); stop();
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
    // Capture sound callback so frame scripts can use it.
    this.soundCallback = callbacks.playSound;

    // Attach the composite anim1 at root (depth 1).
    // The harness positions root at target cell (TargetCell displayType).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
