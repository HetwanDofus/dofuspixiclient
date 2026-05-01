/**
 * Spell 1107 — (Cra spell, displayType=11 TargetCell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1107/scripts/scripts/
 *
 * displayType=11 (TargetCell). Single impact animation at the target cell.
 * No projectile motion, no caster reference, no library symbols via attachMovie —
 * the main timeline hosts sprite_5 (210-frame main animation) and the
 * DefineSprite_18 (39-frame looping sub-sprite) as authored timeline content.
 *
 * Manifest layout:
 *   - animations["sprite_5"]  — 210-frame main visual (no lib_ prefix; in
 *                               animations[] only, not librarySymbols[]).
 *   - animations["sprite_18"] — 39-frame sub-sprite with looping frame scripts.
 *                               DefineSprite_18/frame_1: gotoAndPlay(random(30))
 *                               DefineSprite_18/frame_37: gotoAndPlay(6)
 *
 * Main timeline scripts:
 *   - frame_1/DoAction.as:   SOMA.playSound("autre_1107")
 *   - frame_205/DoAction.as: this.end()  → signalHit
 *   - frame_238/DoAction.as: this.removeMovieClip() → complete
 *
 * Since sprite_5 (210 frames) and sprite_18 (39 frames) appear in animations[]
 * but NOT in librarySymbols[], they are authored main-timeline content. They
 * are registered as SymbolDefinitions with frames loaded via their bare name
 * (no lib_ prefix) and attached from onSpellStart.
 *
 * The main timeline runs to 238 frames on the root clip. We model this by
 * attaching sprite_5 (the primary animation driver) and sprite_18 at root,
 * then placing the hit/complete signals on sprite_5's frame scripts at the
 * canonical frames (205 → signalHit, 210 → remove; the outer mc's frame_238
 * is driven by the root timeline which we model as sprite_5's termination
 * causing complete()).
 *
 * Concretely:
 *   - frame_205 (0-based: 204): this.end() → runtime.signalHit()
 *   - frame_238 corresponds to the root; we fire complete() when sprite_5
 *     ends (frame 209, the last frame of the 210-frame animation) since the
 *     root timeline frame_238 removal is the outer mc disposal. The sprite_5
 *     clip is the outer-mc-equivalent for this spell.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
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

const SPRITE_5_BOUNDS = {
  width: 125.7,
  height: 125.7,
  offsetX: -72.15,
  offsetY: -66.05,
};

const SPRITE_18_BOUNDS = {
  width: 63.55,
  height: 43.9,
  offsetX: -28.55,
  offsetY: -25.6,
};

export class Spell1107 extends RuntimeSpell {
  readonly spellId = 1107;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite5Sym!: SymbolDefinition;
  private sprite18Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite5Anchor = calculateAnchor(SPRITE_5_BOUNDS);
    const sprite18Anchor = calculateAnchor(SPRITE_18_BOUNDS);

    // ---- sprite_18 — 39-frame looping sub-sprite ----------------
    // AS DefineSprite_18/frame_1/DoAction.as:
    //   gotoAndPlay(random(30));  → start at a random frame [0,29]
    // AS DefineSprite_18/frame_37/DoAction.as:
    //   gotoAndPlay(6);           → loop back to frame 6 (0-based: 5)
    this.sprite18Sym = {
      name: "sprite_18",
      totalFrames: 39,
      frames: textures.getFrames("sprite_18"),
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_18/frame_1/DoAction.as:
            //   gotoAndPlay(random(30));
            // AS gotoAndPlay(N) is 1-based; random(30) → [0,29]
            // so target frame is [1,30] in AS → [0,29] in 0-based.
            const target = Math.floor(Math.random() * 30);
            clip.gotoAndPlay(target);
          },
        ],
        [
          36,
          (clip) => {
            // AS DefineSprite_18/frame_37/DoAction.as:
            //   gotoAndPlay(6);  → AS frame 6 = 0-based frame 5
            clip.gotoAndPlay(5);
          },
        ],
      ]),
    };

    // ---- sprite_5 — 210-frame main visual -----------------------
    // AS main timeline frame_205/DoAction.as:
    //   this.end();  → signalHit (damage popup at target)
    // AS main timeline frame_238/DoAction.as:
    //   this.removeMovieClip();  → spell complete
    //
    // sprite_5 has 210 frames (indices 0-209). The main timeline's
    // frame_238 is beyond sprite_5's own length; it belongs to the
    // outer root timeline. We model the root timeline completion via
    // sprite_5's last frame (209) firing complete(), since sprite_5
    // is the sole driving animation and its end corresponds to the
    // outer mc removal at frame_238.
    //
    // frame_205 (0-based: 204) → signalHit
    // frame_210 (0-based: 209) → remove + complete (outer mc disposal)
    this.sprite5Sym = {
      name: "sprite_5",
      totalFrames: 210,
      frames: textures.getFrames("sprite_5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
      frameScripts: new Map([
        [
          204,
          (_clip) => {
            // AS scripts/frame_205/DoAction.as: this.end();
            this.runtime.signalHit();
          },
        ],
        [
          209,
          (clip) => {
            // AS scripts/frame_238/DoAction.as: this.removeMovieClip();
            // sprite_5 ends at frame 209 (its last frame); this drives
            // the outer mc removal and spell completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite18Sym);
    this.registry.register(this.sprite5Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("autre_1107");
    callbacks.playSound("autre_1107");

    // Attach the main animation sprite_5 at depth 1.
    // Attach sprite_18 as a secondary looping sub-animation at depth 2.
    this.root.attach(this.sprite5Sym, "sprite5", 1, context);
    this.root.attach(this.sprite18Sym, "sprite18", 2, context);
  }
}
