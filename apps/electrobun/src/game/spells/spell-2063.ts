/**
 * Spell 2063 — (Unknown name, likely a nature/thorn spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2063/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move`, `shoot`, or `duplicate`
 * symbol; no caster-side reference; no projectile logic. The spell is a
 * single impact animation at the target cell. The manifest has no
 * `librarySymbols[]` entries — all content lives in `animations[]` as
 * bare names (anim1, anim5, anim9, anim19, anim23). The main authored
 * sprite is DefineSprite_8, which drives sounds and a 61-frame timeline
 * that ends with `_parent.removeMovieClip()`. DefineSprite_2 (anim1 /
 * anim5 / anim19 / anim23) has a `stop()` at frame 16.
 *
 * Canonical AS layout:
 *   DefineSprite_8/frame_1:  SOMA.playSound("herbe")
 *   DefineSprite_8/frame_22: SOMA.playSound("pic")
 *   DefineSprite_8/frame_37: SOMA.playSound("pic")
 *   DefineSprite_8/frame_61: _parent.removeMovieClip(); stop()
 *   DefineSprite_2/frame_16: stop()
 *
 * The outer mc (DefineSprite_8 = "anim9") is the 75-frame main impact
 * animation. The anim1/5/19/23 variants (all 18 frames, same bounds)
 * are placed inside it and share DefineSprite_2's `stop()` at frame 16.
 *
 * signalHit is fired at frame_22 (first "pic" sound = first physical impact).
 * complete() is fired at frame_61 (_parent.removeMovieClip).
 *
 * Library symbols: none (librarySymbols[] is absent/empty in manifest).
 * Textures: bare animation names — "anim9", "anim1", "anim5", "anim19", "anim23".
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

// --- Bounds from manifest.json animations[] entries ---

const ANIM9_BOUNDS = {
  width: 85.3,
  height: 93,
  offsetX: -38.4,
  offsetY: -59.45,
};

const ANIM_SMALL_BOUNDS = {
  width: 25.6,
  height: 15.25,
  offsetX: -9.15,
  offsetY: -15.4,
};

export class Spell2063 extends RuntimeSpell {
  readonly spellId = 2063;
  readonly displayType = SpellDisplayType.TargetCell;

  private soundCallback: ((id: string) => void) | undefined;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // The manifest has no librarySymbols[]. All symbols come from animations[].
    // No lib_ prefix is used.

    const anim9Anchor = calculateAnchor(ANIM9_BOUNDS);
    const animSmallAnchor = calculateAnchor(ANIM_SMALL_BOUNDS);

    // ---- anim1 / anim5 / anim19 / anim23 — small sub-sprites ----
    // These share the same bounds/frame-count/stopFrame pattern.
    // DefineSprite_2/frame_16/DoAction.as: stop()
    // All four variants are identical in structure; only their texture
    // content differs. They are placed inside anim9's authored timeline.
    // We register them as container symbols driven by frame_16 stop().

    const makeSmallSym = (name: string): SymbolDefinition => ({
      name,
      totalFrames: 18,
      frames: textures.getFrames(name),
      anchorX: animSmallAnchor.x,
      anchorY: animSmallAnchor.y,
      frameScripts: new Map([
        [
          15,
          (clip) => {
            // AS: DefineSprite_2/frame_16/DoAction.as — stop()
            clip.stop();
          },
        ],
      ]),
    });

    const anim1Sym = makeSmallSym("anim1");
    const anim5Sym = makeSmallSym("anim5");
    const anim19Sym = makeSmallSym("anim19");
    const anim23Sym = makeSmallSym("anim23");

    // ---- anim9 — main 75-frame impact composite (DefineSprite_8) ----
    // frame_1:  SOMA.playSound("herbe")
    // frame_22: SOMA.playSound("pic")   → also signalHit
    // frame_37: SOMA.playSound("pic")
    // frame_61: _parent.removeMovieClip(); stop() → complete()
    //
    // The manifest shows sounds at frames 0, 21, 36 (0-indexed), matching
    // AS frame_1, frame_22, frame_37 (1-indexed). Frame_61 ends the spell.
    const anim9Sym: SymbolDefinition = {
      name: "anim9",
      totalFrames: 75,
      frames: textures.getFrames("anim9"),
      anchorX: anim9Anchor.x,
      anchorY: anim9Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS: DefineSprite_8/frame_1/DoAction.as — SOMA.playSound("herbe")
            this.soundCallback?.("herbe");
          },
        ],
        [
          21,
          (_clip) => {
            // AS: DefineSprite_8/frame_22/DoAction.as — SOMA.playSound("pic")
            this.soundCallback?.("pic");
            this.runtime.signalHit();
          },
        ],
        [
          36,
          (_clip) => {
            // AS: DefineSprite_8/frame_37/DoAction.as — SOMA.playSound("pic")
            this.soundCallback?.("pic");
          },
        ],
        [
          60,
          (clip) => {
            // AS: DefineSprite_8/frame_61/DoAction.as
            //   _parent.removeMovieClip(); stop()
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
    this.registry.register(anim5Sym);
    this.registry.register(anim19Sym);
    this.registry.register(anim23Sym);
    this.registry.register(anim9Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use from frame scripts.
    this.soundCallback = callbacks.playSound;

    // Attach the main impact animation (DefineSprite_8 = anim9) at the
    // root. The frame_1 script fires immediately on attach and plays
    // the "herbe" sound. The timeline drives the rest of the spell.
    const anim9Sym = this.registry.resolve("anim9");
    if (anim9Sym) {
      this.root.attach(anim9Sym, "anim9", 1, context);
    }
  }
}
