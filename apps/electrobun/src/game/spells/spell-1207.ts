/**
 * Spell 1207 — unknown name (Sadida/nature impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1207/scripts/scripts/
 *
 * displayType=11 (TargetCell). The main-timeline frame_2 onClipEvent(load)
 * positions sprite_30 at _parent.cellTo. No move/shoot/duplicate symbols
 * are present; the harness applies no special motion.
 *
 * Library symbols (all in animations[] only — NO lib_ prefix):
 *   - sprite_10 (75 frames): looping flicker particle. frame_1 jumps to a
 *     random frame in [1..60]; frame_73 loops back to frame_3. Two instances
 *     placed as authored children of sprite_30.
 *   - sprite_29 (63 frames): flickering alpha halo. frame_1 installs an
 *     onEnterFrame randomising _alpha in [20,40]. frame_61 stops. Two
 *     instances placed inside sprite_30 at depths 1 and 39 with different
 *     start frames via onClipEvent(load) overrides.
 *   - sprite_30 (96 frames): outer impact composite placed at cellTo.
 *     frame_1 optionally mirrors _xscale and attaches all child sprites.
 *     frame_43: this.end() → signalHit.
 *     frame_94: _parent.removeMovieClip() → complete.
 *
 * Main timeline frame_2:
 *   PlaceObject2_30_1 onClipEvent(load): _X = _parent.cellTo.x; _Y = _parent.cellTo.y
 *   DoAction: stop()
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

const SPRITE_10_BOUNDS = {
  width: 18.2,
  height: 28.9,
  offsetX: -8,
  offsetY: -16.5,
};

const SPRITE_29_BOUNDS = {
  width: 177.4,
  height: 166.8,
  offsetX: -77.5,
  offsetY: -102.8,
};

const SPRITE_30_BOUNDS = {
  width: 144.05,
  height: 135.2,
  offsetX: -33.25,
  offsetY: -94.05,
};

export class Spell1207 extends RuntimeSpell {
  readonly spellId = 1207;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite10Anchor = calculateAnchor(SPRITE_10_BOUNDS);
    const sprite29Anchor = calculateAnchor(SPRITE_29_BOUNDS);
    const sprite30Anchor = calculateAnchor(SPRITE_30_BOUNDS);

    // ---- sprite_10 — looping flicker particle --------------------
    // AS DefineSprite_10/frame_1/DoAction.as:
    //   gotoAndPlay(random(60) + 1);
    // AS DefineSprite_10/frame_73/DoAction.as:
    //   gotoAndPlay(3);
    const sprite10Sym: SymbolDefinition = {
      name: "sprite_10",
      totalFrames: 75,
      frames: textures.getFrames("sprite_10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_10/frame_1/DoAction.as
            // gotoAndPlay(random(60) + 1) → 0-based: [0, 59]
            clip.gotoAndPlay(Math.floor(Math.random() * 60));
          },
        ],
        [
          72,
          (clip) => {
            // AS DefineSprite_10/frame_73/DoAction.as
            // gotoAndPlay(3) → 0-based frame 2
            clip.gotoAndPlay(2);
          },
        ],
      ]),
    };

    // ---- sprite_29 — flickering alpha halo -----------------------
    // AS DefineSprite_29/frame_1/DoAction.as:
    //   f = -1;
    //   this.onEnterFrame = function() { _alpha = 20 + random(20); };
    // AS DefineSprite_29/frame_61/DoAction.as:
    //   stop();
    const sprite29Sym: SymbolDefinition = {
      name: "sprite_29",
      totalFrames: 63,
      frames: textures.getFrames("sprite_29"),
      anchorX: sprite29Anchor.x,
      anchorY: sprite29Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_29/frame_1/DoAction.as
            clip.vars.f = -1;
            clip.onEnterFrame = (c) => {
              // _alpha = 20 + random(20) — Flash 0-100 → TS 0-1
              c.alpha = (20 + Math.floor(Math.random() * 20)) / 100;
            };
          },
        ],
        [
          60,
          (clip) => {
            // AS DefineSprite_29/frame_61/DoAction.as
            // stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_30 — outer impact composite ----------------------
    // AS DefineSprite_30/frame_1/DoAction.as:
    //   if (random(2) == 1) { _xscale = -_xscale; }
    //
    // Authored PlaceObject2 children in DefineSprite_30 frame_1:
    //   PlaceObject2_29_1  (depth 1):  sprite_29
    //     onClipEvent(load) → gotoAndPlay(4)
    //   PlaceObject2_29_39 (depth 39): sprite_29
    //     onClipEvent(load) → gotoAndPlay(3)
    //
    // AS DefineSprite_30/frame_43/DoAction.as:
    //   this.end();
    //
    // AS DefineSprite_30/frame_94/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    const sprite30Sym: SymbolDefinition = {
      name: "sprite_30",
      totalFrames: 96,
      frames: textures.getFrames("sprite_30"),
      anchorX: sprite30Anchor.x,
      anchorY: sprite30Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_30/frame_1/DoAction.as
            // if (random(2) == 1) { _xscale = -_xscale; }
            if (Math.floor(Math.random() * 2) === 1) {
              clip.scaleX = -clip.scaleX;
            }

            // AS DefineSprite_30/frame_1/PlaceObject2_29_1/onClipEvent(load):
            //   gotoAndPlay(4);
            // Attach sprite_29 at depth 1, then immediately jump to
            // frame 4 (0-based: 3) per the canonical load override.
            const child29d1 = clip.attach(
              sprite29Sym,
              "sprite_29_d1",
              1,
              ctx,
            );
            child29d1.gotoAndPlay(3); // AS gotoAndPlay(4) → 0-based 3

            // Authored sprite_10 at depth 2 (first flicker instance).
            clip.attach(sprite10Sym, "sprite_10_d2", 2, ctx);

            // AS DefineSprite_30/frame_1/PlaceObject2_29_39/onClipEvent(load):
            //   gotoAndPlay(3);
            // Attach sprite_29 at depth 39, then jump to frame 3
            // (0-based: 2) per the canonical load override.
            const child29d39 = clip.attach(
              sprite29Sym,
              "sprite_29_d39",
              39,
              ctx,
            );
            child29d39.gotoAndPlay(2); // AS gotoAndPlay(3) → 0-based 2

            // Authored sprite_10 at depth 40 (second flicker instance).
            clip.attach(sprite10Sym, "sprite_10_d40", 40, ctx);
          },
        ],
        [
          42,
          () => {
            // AS DefineSprite_30/frame_43/DoAction.as
            // this.end() — canonical hit signal (damage popup at target)
            this.runtime.signalHit();
          },
        ],
        [
          93,
          (clip) => {
            // AS DefineSprite_30/frame_94/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite10Sym);
    this.registry.register(sprite29Sym);
    this.registry.register(sprite30Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_2/DoAction.as: stop()
    // AS scripts/frame_2/PlaceObject2_30_1/onClipEvent(load):
    //   _X = _parent.cellTo.x;
    //   _Y = _parent.cellTo.y;
    //
    // displayType=11 (TargetCell): the root container is already anchored
    // at cellTo in world coords. Attaching sprite_30 at local (0,0) places
    // it at that world position, matching the canonical load script.
    this.root.attach(
      this.registry.resolve("sprite_30")!,
      "sprite_30",
      1,
      context,
      { x: 0, y: 0 },
    );
  }
}
