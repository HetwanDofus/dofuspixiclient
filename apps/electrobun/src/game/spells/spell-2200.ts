/**
 * Spell 2200 — Aspiration (Xelor / Sacrier style beam-like pull effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2200/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Evidence:
 *   - DefineSprite_28/frame_4/DoAction.as reads `_parent.cellFrom.x` and
 *     `_parent.cellFrom.y` to position itself, plus `_parent.angle` for
 *     rotation — the canonical dual-anchor / world-relative pattern.
 *   - No `move`/`shoot`/`duplicate` symbols; no ballistic / linear harness
 *     wiring needed. The spell positions its own children at world coords.
 *   - manifest.json has no `librarySymbols[]` entries — all three animations
 *     (sprite_15, sprite_26, sprite_28) are in `animations[]` only.
 *
 * AS layout:
 *   - Main timeline frame_2/DoAction.as: SOMA.playSound("aspiration"); stop();
 *     → `onSpellStart` plays the sound and attaches sprite_15 + sprite_28
 *       (the two authored timelines that run in parallel).
 *
 *   - sprite_28 (99-frame composite beam):
 *       frame_4  : position self at cellFrom (world coords), rotate to angle.
 *       frame_52 : this.end() → signalHit (damage popup).
 *       frame_97 : stop(); _parent.removeMovieClip() → spell complete.
 *
 *   - sprite_26 (48-frame particle streamer):
 *       frame_1  : random Y scatter ±10 px; 25% chance flip yscale.
 *       frame_48 : stop().
 *     Spawned inside sprite_28 (sprite_28 attaches it — but since we have no
 *     explicit attachMovie in the AS scripts for sprite_26 it is placed on
 *     the authored timeline of sprite_28 as a child; we model it as a
 *     sub-symbol registered and attached by sprite_28's frame_4 logic).
 *
 *   - sprite_15 (42-frame impact burst at target cell):
 *     No explicit frame scripts — plays through and removes itself.
 *     Positioned at cellTo by onSpellStart.
 *
 * Library symbols (all in animations[], NOT librarySymbols[]):
 *   - sprite_15 — 42-frame impact burst at target. No frame scripts.
 *   - sprite_26 — 48-frame particle streamer. frame_1 random scatter;
 *                  frame_48 stop().
 *   - sprite_28 — 99-frame composite beam. frame_4 positions at cellFrom;
 *                  frame_52 signalHit; frame_97 complete.
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

const SPRITE_15_BOUNDS = {
  width: 193.15,
  height: 169.75,
  offsetX: -88.4,
  offsetY: -132.3,
};

const SPRITE_26_BOUNDS = {
  width: 220.25,
  height: 34.55,
  offsetX: -140.95,
  offsetY: -20.3,
};

const SPRITE_28_BOUNDS = {
  width: 549.05,
  height: 52.95,
  offsetX: -63.6,
  offsetY: -27.8,
};

export class Spell2200 extends RuntimeSpell {
  readonly spellId = 2200;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite15Sym!: SymbolDefinition;
  private sprite26Sym!: SymbolDefinition;
  private sprite28Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite15Anchor = calculateAnchor(SPRITE_15_BOUNDS);
    const sprite26Anchor = calculateAnchor(SPRITE_26_BOUNDS);
    const sprite28Anchor = calculateAnchor(SPRITE_28_BOUNDS);

    // ---- sprite_15 — 42-frame impact burst at target cell --------
    // No frame scripts in canonical AS. Plays through its 42 frames
    // and then stops (no removeMovieClip — the outer spell completes
    // via sprite_28's frame_97). Positioned at cellTo in onSpellStart.
    this.sprite15Sym = {
      name: "sprite_15",
      totalFrames: 42,
      frames: textures.getFrames("sprite_15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
    };

    // ---- sprite_26 — 48-frame particle streamer ------------------
    // AS DefineSprite_26/frame_1/DoAction.as:
    //   _Y = 20 * (-0.5 + Math.random());
    //   if(random(4) == 1) { _yscale = -_yscale; }
    // AS DefineSprite_26/frame_48/DoAction.as:
    //   stop();
    this.sprite26Sym = {
      name: "sprite_26",
      totalFrames: 48,
      frames: textures.getFrames("sprite_26"),
      anchorX: sprite26Anchor.x,
      anchorY: sprite26Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_26/frame_1/DoAction.as
            clip.y = 20 * (-0.5 + Math.random());
            if (Math.floor(Math.random() * 4) === 1) {
              clip.scaleY = -clip.scaleY;
            }
          },
        ],
        [
          47,
          (clip) => {
            // AS DefineSprite_26/frame_48/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_28 — 99-frame composite beam --------------------
    // AS DefineSprite_28/frame_4/DoAction.as:
    //   _X = _parent.cellFrom.x;
    //   _Y = _parent.cellFrom.y - 20;
    //   _rotation = _parent.angle;
    // AS DefineSprite_28/frame_52/DoAction.as:
    //   this.end();   → signalHit
    // AS DefineSprite_28/frame_97/DoAction.as:
    //   stop();
    //   this._parent.removeMovieClip();  → spell complete
    //
    // sprite_28 is a composite that includes sprite_26 as an authored
    // child in its timeline. We attach sprite_26 at frame_4 alongside
    // the positioning logic so it starts playing from the same moment
    // the beam is positioned.
    this.sprite28Sym = {
      name: "sprite_28",
      totalFrames: 99,
      frames: textures.getFrames("sprite_28"),
      anchorX: sprite28Anchor.x,
      anchorY: sprite28Anchor.y,
      frameScripts: new Map([
        [
          3,
          (clip, ctx) => {
            // AS DefineSprite_28/frame_4/DoAction.as
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 20;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
            // Attach the sprite_26 particle streamer as an authored
            // child of the beam (it lives inside sprite_28's timeline).
            clip.attach(this.sprite26Sym, "sprite_26", 1, ctx);
          },
        ],
        [
          51,
          () => {
            // AS DefineSprite_28/frame_52/DoAction.as
            // this.end() → signalHit (damage popup at target)
            this.runtime.signalHit();
          },
        ],
        [
          96,
          (clip) => {
            // AS DefineSprite_28/frame_97/DoAction.as
            // stop(); this._parent.removeMovieClip();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite15Sym);
    this.registry.register(this.sprite26Sym);
    this.registry.register(this.sprite28Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS frame_2/DoAction.as: SOMA.playSound("aspiration"); stop();
    callbacks.playSound("aspiration");

    // Place sprite_15 (impact burst) at the target cell.
    // displayType=50: container is at world (0,0), so we use world coords.
    const sprite15 = this.root.attach(
      this.sprite15Sym,
      "sprite_15",
      1,
      context
    );
    sprite15.x = context.cellTo.x;
    sprite15.y = context.cellTo.y;

    // Place sprite_28 (beam) at the root. It will position itself at
    // cellFrom on its frame_4. Start it at (0,0) for now; frame_4
    // will override via _parent.cellFrom.
    this.root.attach(this.sprite28Sym, "sprite_28", 2, context);
  }
}
