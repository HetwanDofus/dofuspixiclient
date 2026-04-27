/**
 * Spell 1010 — (Cra/Sadida grass/sling spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1010/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move`, `shoot`, `duplicate`, or
 * caster-reference in any AS file. DefineSprite_15/frame_1 positions itself at
 * `_parent.cellTo`, which is exactly TargetCell behaviour. No projectile arc,
 * no beam — single impact at target cell.
 *
 * The manifest has NO librarySymbols[] entries. Both animated symbols
 * (sprite_14 and sprite_15) live only in the top-level `animations[]` list,
 * so textures are fetched WITHOUT the `lib_` prefix.
 *
 * Library symbols (from animations[] — no lib_ prefix):
 *   - sprite_14 — 261-frame composite (background/grass swirl). frame_1 plays
 *     sound "herbe" then jumps to a random frame in [1,30] to stagger the loop.
 *     frame_151 plays sound "fronde". frame_259 stops.
 *   - sprite_15 — 204-frame composite (impact visual). frame_1 positions self
 *     at cellTo. frame_163 fires signalHit (this.end()). frame_202 removes
 *     parent → spell complete.
 *
 * Main timeline (frame_2/DoAction.as): stop(). The outer SWF pauses at frame 2;
 * sprite_14 and sprite_15 are placed on the timeline implicitly (frame 1), so
 * we attach them from onSpellStart. Sound "herbe" is fired from sprite_14's own
 * frame_1 script, not the main timeline directly (though the manifest's sounds[]
 * hints at it too — canonical script wins).
 *
 * NOTE: sprite_11 appears in animations[] (6-frame small particle) but no AS
 * script ever calls attachMovie("sprite_11") — it is a sub-component composited
 * into sprite_14/sprite_15 by the exporter and does not need a SymbolDefinition.
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

// Bounds from manifest animations[] entries (no lib_ prefix applies here).
const SPRITE_14_BOUNDS = {
  width: 71.45,
  height: 107.85,
  offsetX: -36.9,
  offsetY: -78.3,
};

const SPRITE_15_BOUNDS = {
  width: 90.85,
  height: 142,
  offsetX: -44.1,
  offsetY: -95.65,
};

export class Spell1010 extends RuntimeSpell {
  readonly spellId = 1010;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite14Sym!: SymbolDefinition;
  private sprite15Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite14Anchor = calculateAnchor(SPRITE_14_BOUNDS);
    const sprite15Anchor = calculateAnchor(SPRITE_15_BOUNDS);

    // ---- sprite_14 — background / grass swirl, 261 frames ----------
    // The symbol starts playing, jumps to a random stagger point in [1,30],
    // plays sound "fronde" at frame 151, and stops at frame 259.
    //
    // AS DefineSprite_14/frame_1/DoAction.as:   SOMA.playSound("herbe");
    // AS DefineSprite_14/frame_1/DoAction_2.as: gotoAndPlay(random(30) + 1);
    // AS DefineSprite_14/frame_151/DoAction.as: SOMA.playSound("fronde");
    // AS DefineSprite_14/frame_259/DoAction.as: stop();
    //
    // Sounds inside symbol frame scripts need the callbacks reference captured
    // from onSpellStart, since the SymbolDefinition handlers don't receive it.
    this.sprite14Sym = {
      name: "sprite_14",
      totalFrames: 261,
      // No lib_ prefix — sprite_14 is in animations[], not librarySymbols[].
      frames: textures.getFrames("sprite_14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_14/frame_1/DoAction.as + DoAction_2.as
            // Sound "herbe" is fired here; we use the captured callback.
            this.soundCallback?.("herbe");
            // gotoAndPlay(random(30) + 1) — AS 1-based → 0-based
            const target = Math.floor(Math.random() * 30); // random(30) gives 0..29; +1 → 1..30; -1 for 0-based → 0..29
            clip.gotoAndPlay(target);
          },
        ],
        [
          150,
          () => {
            // AS DefineSprite_14/frame_151/DoAction.as
            this.soundCallback?.("fronde");
          },
        ],
        [
          258,
          (clip) => {
            // AS DefineSprite_14/frame_259/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_15 — impact visual, 204 frames ---------------------
    // frame_1 positions self at cellTo (world absolute coords stored on root.vars).
    // frame_163 signals hit (this.end()).
    // frame_202 removes the outer mc → spell complete.
    //
    // AS DefineSprite_15/frame_1/DoAction.as:   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    // AS DefineSprite_15/frame_163/DoAction.as: this.end();
    // AS DefineSprite_15/frame_202/DoAction.as: _parent.removeMovieClip();
    this.sprite15Sym = {
      name: "sprite_15",
      totalFrames: 204,
      // No lib_ prefix — sprite_15 is in animations[], not librarySymbols[].
      frames: textures.getFrames("sprite_15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_15/frame_1/DoAction.as
            // _parent is the root clip. For displayType=11 (TargetCell) the
            // container origin IS the target cell, so cellTo in local coords
            // IS (0, 0). However, canonical AS stores absolute world coords on
            // root.vars.cellTo and the script reads them directly. We mirror
            // that exactly: position clip at the world coords of cellTo.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
          },
        ],
        [
          162,
          () => {
            // AS DefineSprite_15/frame_163/DoAction.as — this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          201,
          (clip) => {
            // AS DefineSprite_15/frame_202/DoAction.as — _parent.removeMovieClip()
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite14Sym);
    this.registry.register(this.sprite15Sym);
  }

  // Captured in onSpellStart so symbol frame scripts can play sounds.
  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use inside frame scripts (sprite_14 fires
    // "herbe" and "fronde" from its own timeline, not the main timeline).
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_2/DoAction.as: stop()
    // sprite_14 and sprite_15 are placed implicitly on the main timeline at
    // frame_1 in canonical Flash. We attach them here so they begin ticking
    // from the next runtime frame.
    this.root.attach(this.sprite14Sym, "sprite14", 1, context);
    this.root.attach(this.sprite15Sym, "sprite15", 2, context);
  }
}
