/**
 * Spell 1105 — (Unknown name, likely a Sacrieur/misc spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1105/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile motion, no dual anchors, no
 * beam logic. The spell is a single animated composite (`sprite_2`) placed
 * at the target cell, with a small looping overlay (`sprite_4`) placed
 * inside it. The main timeline is 238 frames:
 *   - frame_1:   SOMA.playSound("autre_1105")
 *   - frame_205: this.end() → signalHit
 *   - frame_238: this.removeMovieClip() → spell complete
 *
 * Library symbols: none (manifest has no librarySymbols[] entries).
 * The two animation sets (`sprite_2`, `sprite_4`) are top-level
 * `animations[]` entries only. `sprite_2` is the main 622-frame visual
 * anchored at the target. `sprite_4` is a 648-frame looping overlay
 * embedded inside `sprite_2`'s authored timeline — in canonical AS,
 * frame_1 of DefineSprite_4 jumps to a random start frame (random(270)+3)
 * and frame_640 loops back to 315. We model it as a child attached to
 * the sprite_2 clip.
 *
 * Main timeline (sprite_2 is the outer mc whose frame scripts drive timing):
 *   frame_1   (index 0):  gotoAndPlay(random(270) + 3) on sprite_4 child
 *   frame_640 (index 639): gotoAndPlay(315) loop on sprite_4 child
 *
 * The outer `sprite_2` timeline itself has:
 *   frame_205 (index 204): signalHit
 *   frame_238 (index 237): removeMovieClip → complete
 *
 * Since librarySymbols is empty, we use bare texture key names (no lib_ prefix).
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

const SPRITE_2_BOUNDS = {
  width: 143,
  height: 143,
  offsetX: -80.8,
  offsetY: -74.7,
};

const SPRITE_4_BOUNDS = {
  width: 48.6,
  height: 48.6,
  offsetX: -24.3,
  offsetY: -24.3,
};

export class Spell1105 extends RuntimeSpell {
  readonly spellId = 1105;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite2Sym!: SymbolDefinition;
  private sprite4Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite2Anchor = calculateAnchor(SPRITE_2_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE_4_BOUNDS);

    // ---- sprite_4 — looping overlay animation -------------------
    // Canonical AS: DefineSprite_4/frame_1/DoAction.as
    //   gotoAndPlay(random(270) + 3)
    // Canonical AS: DefineSprite_4/frame_640/DoAction.as
    //   gotoAndPlay(315)
    this.sprite4Sym = {
      name: "sprite_4",
      totalFrames: 648,
      frames: textures.getFrames("sprite_4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_4/frame_1/DoAction.as: gotoAndPlay(random(270) + 3)
            const target = Math.floor(Math.random() * 270) + 3;
            clip.gotoAndPlay(target - 1);
          },
        ],
        [
          639,
          (clip) => {
            // AS DefineSprite_4/frame_640/DoAction.as: gotoAndPlay(315)
            clip.gotoAndPlay(315 - 1);
          },
        ],
      ]),
    };

    // ---- sprite_2 — main visual timeline (622 frames used) ------
    // The outer mc drives hit and completion signals.
    // frame_205 (index 204): this.end() → signalHit
    // frame_238 (index 237): this.removeMovieClip() → complete
    //
    // frame_1 (index 0) attaches sprite_4 as a child overlay.
    this.sprite2Sym = {
      name: "sprite_2",
      totalFrames: 622,
      frames: textures.getFrames("sprite_2"),
      anchorX: sprite2Anchor.x,
      anchorY: sprite2Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS (implicit placement) — attach the looping overlay sprite_4
            // as a child inside sprite_2 at depth 1.
            clip.attach(this.sprite4Sym, "sprite_4", 1, ctx);
          },
        ],
        [
          204,
          () => {
            // AS scripts/frame_205/DoAction.as: this.end() → damage popup
            this.runtime.signalHit();
          },
        ],
        [
          237,
          (clip) => {
            // AS scripts/frame_238/DoAction.as: this.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite4Sym);
    this.registry.register(this.sprite2Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("autre_1105")
    callbacks.playSound("autre_1105");

    // Attach the main visual sprite_2 at the root (target cell anchor).
    this.root.attach(this.sprite2Sym, "sprite_2", 1, context);
  }
}
