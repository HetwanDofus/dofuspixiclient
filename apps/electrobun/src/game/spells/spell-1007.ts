/**
 * Spell 1007 — Herbe (Sadida grass/nature spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1007/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no move/shoot/duplicate/projectile
 * symbols, no caster-reference positioning, and no dual-anchored timelines. It is
 * a single impact animation anchored at the target cell. The manifest has NO
 * librarySymbols[] entries — all content lives in `animations: ["anim1"]`. The
 * top-level outer sprite (DefineSprite_14) plays a 295-frame timeline at the
 * target, fires sounds at frames 1/58/121/184, signals hit at frame 178, and
 * removes itself at frame 295.
 *
 * Canonical AS layout:
 *
 *   DefineSprite_8 (grass particle, 55 frames):
 *     frame_1:  if (random(5) != 1) { gotoAndStop(20); }
 *     frame_55: stop();
 *
 *   DefineSprite_12 (background layer, 289+ frames):
 *     frame_1:   gotoAndPlay(random(40) + 1); _alpha = 30 + random(50); t = 30 + random(120);
 *                _xscale = t; _yscale = t / 2;
 *     frame_289: stop();
 *
 *   DefineSprite_14 (outer container, 295 frames — longest-lived):
 *     frame_1:   SOMA.playSound("herbe");
 *     frame_58:  SOMA.playSound("herbe");
 *     frame_121: SOMA.playSound("herbe");
 *     frame_178: this.end()  → signalHit
 *     frame_184: SOMA.playSound("herbe");
 *     frame_295: _parent.removeMovieClip(); stop(); → complete()
 *
 * The manifest `anim1` animation (297 frames) IS the composite baked output of
 * all three DefineSprite layers together. There are no separate library symbol
 * texture sets — all textures are under "anim1".
 *
 * Because the whole animation is baked into `anim1`, we model it as a single
 * top-level SymbolDefinition (name "anim1") registered and attached from
 * onSpellStart, with frameScripts carrying the canonical timing signals.
 * No particle sub-symbols are attached at runtime (the particle behaviour of
 * DefineSprite_8 and DefineSprite_12 is baked into the composite frames).
 *
 * Sounds at manifest-level frames 0/57/120/183 correspond to the canonical
 * DefineSprite_14 frame_1/58/121/184 (frame index shift: manifest is 0-based,
 * the outer wrapper shifts by 1). The canonical frame_1 sound is played from
 * onSpellStart; subsequent sounds are fired from frameScripts.
 *
 * Library symbols: none (librarySymbols[] is absent/empty in manifest).
 *
 * Main timeline: attaches anim1, plays at target cell.
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
  width: 95.1,
  height: 38.1,
  offsetX: -49.25,
  offsetY: -17.05,
};

export class Spell1007 extends RuntimeSpell {
  readonly spellId = 1007;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — composite baked timeline (295 active frames) ----
    // Canonical DefineSprite_14 outer container drives all timing.
    // The baked anim1 asset has 297 frames (frameCount in manifest);
    // the canonical removal fires at frame_295 (index 294).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 297,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS DefineSprite_14/frame_58/DoAction.as: SOMA.playSound("herbe")
          // frame_58 (1-based) → index 57
          57,
          (_clip) => {
            this.soundCallback?.("herbe");
          },
        ],
        [
          // AS DefineSprite_14/frame_121/DoAction.as: SOMA.playSound("herbe")
          // frame_121 → index 120
          120,
          (_clip) => {
            this.soundCallback?.("herbe");
          },
        ],
        [
          // AS DefineSprite_14/frame_178/DoAction.as: this.end()
          // frame_178 → index 177 — canonical hit signal
          177,
          (_clip) => {
            this.runtime.signalHit();
          },
        ],
        [
          // AS DefineSprite_14/frame_184/DoAction.as: SOMA.playSound("herbe")
          // frame_184 → index 183
          183,
          (_clip) => {
            this.soundCallback?.("herbe");
          },
        ],
        [
          // AS DefineSprite_14/frame_295/DoAction.as: _parent.removeMovieClip(); stop();
          // frame_295 → index 294
          294,
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
    // Capture sound callback for use inside frameScripts where only
    // `this` is available (no callbacks parameter passed to frame scripts).
    this.soundCallback = callbacks.playSound;

    // AS DefineSprite_14/frame_1/DoAction.as: SOMA.playSound("herbe")
    // The canonical frame_1 sound fires as the outer mc starts.
    callbacks.playSound("herbe");

    // Attach the composite anim1 timeline at the root (target cell anchor).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
