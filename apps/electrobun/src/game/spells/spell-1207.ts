/**
 * Spell 1207 — (unknown name, likely a summoning/earth spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1207/scripts/scripts/
 *
 * displayType=11 (TargetCell). The main timeline frame_2 positions sprite_30
 * at _parent.cellTo — i.e. the root is anchored at the target cell. No
 * projectile motion, no caster reference. Classic impact spell.
 *
 * Library symbols (from animations[] — no librarySymbols[] entries):
 *   - sprite_10  — looping smoke/particle sprite (75 frames). frame_1 jumps
 *                  to a random frame in [1,60]; frame_73 loops back to frame 3.
 *   - sprite_29  — flickering alpha "shimmer" layer (63 frames). frame_1 sets
 *                  f=-1 and installs an onEnterFrame that randomises alpha
 *                  each tick. frame_61 stops.
 *                  Two variants with differing onLoad start frames:
 *                    sprite_29_d1  (depth  1): onLoad → gotoAndPlay(4) [0-based 3]
 *                    sprite_29_d39 (depth 39): onLoad → gotoAndPlay(3) [0-based 2]
 *   - sprite_30  — outer composite impact animation (96 frames). onLoad
 *                  positions self at _parent.cellTo world coords. frame_1
 *                  randomly mirrors xscale; frame_43 signals hit; frame_94
 *                  removes parent and signals completion.
 *
 * Main timeline (frame_2/DoAction.as): stop(). PlaceObject2_30_1 onLoad
 * positions sprite_30 at cellTo (ported as sprite_30's onLoad handler).
 *
 * CLIPACTIONRECORD inventory (all three ported as onLoad handlers):
 *   1. frame_2/PlaceObject2_30_1/onClipEvent(load):
 *        _X = _parent.cellTo.x; _Y = _parent.cellTo.y
 *        → sprite_30 SymbolDefinition onLoad
 *   2. DefineSprite_30/frame_1/PlaceObject2_29_1/onClipEvent(load):
 *        gotoAndPlay(4)  [0-based 3]
 *        → sprite_29_d1 SymbolDefinition onLoad
 *   3. DefineSprite_30/frame_1/PlaceObject2_29_39/onClipEvent(load):
 *        gotoAndPlay(3)  [0-based 2]
 *        → sprite_29_d39 SymbolDefinition onLoad
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

// Bounds from manifest animations[] entries (no librarySymbols[] in this spell).
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

  private sprite30Sym!: SymbolDefinition;
  private sprite29D1Sym!: SymbolDefinition;
  private sprite29D39Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite10Anchor = calculateAnchor(SPRITE_10_BOUNDS);
    const sprite29Anchor = calculateAnchor(SPRITE_29_BOUNDS);
    const sprite30Anchor = calculateAnchor(SPRITE_30_BOUNDS);

    // ---- sprite_10 — looping smoke/particle (75 frames) ----------
    // AS DefineSprite_10/frame_1/DoAction.as:  gotoAndPlay(random(60) + 1)
    // AS DefineSprite_10/frame_73/DoAction.as: gotoAndPlay(3)
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
            // gotoAndPlay(random(60) + 1) → 0-based: random(60) + 0
            clip.gotoAndPlay(Math.floor(Math.random() * 60));
          },
        ],
        [
          72,
          (clip) => {
            // AS DefineSprite_10/frame_73/DoAction.as
            // gotoAndPlay(3) → 0-based: 2
            clip.gotoAndPlay(2);
          },
        ],
      ]),
    };

    // ---- sprite_29 variant at depth 1 ----------------------------
    // Shares the sprite_29 timeline / textures / onEnterFrame, but its
    // onLoad mirrors PlaceObject2_29_1/onClipEvent(load): gotoAndPlay(4)
    //
    // AS DefineSprite_29/frame_1/DoAction.as:
    //   f = -1;
    //   this.onEnterFrame = function() { _alpha = 20 + random(20); };
    // AS DefineSprite_29/frame_61/DoAction.as: stop()
    this.sprite29D1Sym = {
      name: "sprite_29_d1",
      totalFrames: 63,
      frames: textures.getFrames("sprite_29"),
      anchorX: sprite29Anchor.x,
      anchorY: sprite29Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_30/frame_1/PlaceObject2_29_1/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndPlay(4) → 0-based: 3
        clip.gotoAndPlay(3);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_29/frame_1/DoAction.as — inline onEnterFrame
        // _alpha = 20 + random(20)  →  (20 + random(20)) / 100
        clip.alpha = (20 + Math.floor(Math.random() * 20)) / 100;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_29/frame_1/DoAction.as
            // f = -1 (phase flag, stored for canonical fidelity)
            clip.vars.f = -1;
            // onEnterFrame is wired via SymbolDefinition.onEnterFrame above.
          },
        ],
        [
          60,
          (clip) => {
            // AS DefineSprite_29/frame_61/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_29 variant at depth 39 ---------------------------
    // Same symbol timeline / textures / onEnterFrame as depth-1 variant,
    // but its onLoad mirrors PlaceObject2_29_39/onClipEvent(load): gotoAndPlay(3)
    this.sprite29D39Sym = {
      name: "sprite_29_d39",
      totalFrames: 63,
      frames: textures.getFrames("sprite_29"),
      anchorX: sprite29Anchor.x,
      anchorY: sprite29Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_30/frame_1/PlaceObject2_29_39/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndPlay(3) → 0-based: 2
        clip.gotoAndPlay(2);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_29/frame_1/DoAction.as — inline onEnterFrame
        // _alpha = 20 + random(20)  →  (20 + random(20)) / 100
        clip.alpha = (20 + Math.floor(Math.random() * 20)) / 100;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_29/frame_1/DoAction.as
            clip.vars.f = -1;
          },
        ],
        [
          60,
          (clip) => {
            // AS DefineSprite_29/frame_61/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_30 — outer composite impact (96 frames) ----------
    // AS frame_2/PlaceObject2_30_1/onClipEvent(load):
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y
    //   → ported as this symbol's onLoad.
    //
    // AS DefineSprite_30/frame_1/DoAction.as:
    //   if (random(2) == 1) { _xscale = -_xscale; }
    // AS DefineSprite_30/frame_43/DoAction.as: this.end()   → signalHit
    // AS DefineSprite_30/frame_94/DoAction.as: _parent.removeMovieClip(); stop() → complete
    //
    // displayType=11 (TargetCell): root container is placed AT cellTo by the
    // spell-view. The canonical AS uses absolute world coords (_parent.cellTo.x/y)
    // to position sprite_30. Since the container origin IS cellTo, the world
    // coords equal (cellTo.x, cellTo.y) and the LOCAL offset within the container
    // is (cellTo.x - anchor.x, cellTo.y - anchor.y). We read cellTo from
    // root.vars (set by the harness) so the onLoad can resolve it at runtime.
    this.sprite30Sym = {
      name: "sprite_30",
      totalFrames: 96,
      frames: textures.getFrames("sprite_30"),
      anchorX: sprite30Anchor.x,
      anchorY: sprite30Anchor.y,
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_30_1/CLIPACTIONRECORD onClipEvent(load).as
        // _X = _parent.cellTo.x; _Y = _parent.cellTo.y
        // clip.parent is root; root.vars.cellTo holds world coords set by harness.
        const root = clip.parent;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
        const anchor = root?.vars.anchor as { x: number; y: number } | undefined;
        // The container's world origin equals the displayType anchor (cellTo for
        // TargetCell). World → local: subtract the container's world position.
        const anchorX = anchor?.x ?? cellTo?.x ?? 0;
        const anchorY = anchor?.y ?? cellTo?.y ?? 0;
        clip.x = (cellTo?.x ?? 0) - anchorX;
        clip.y = (cellTo?.y ?? 0) - anchorY;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_30/frame_1/DoAction.as
            // if (random(2) == 1) { _xscale = -_xscale; }
            if (Math.floor(Math.random() * 2) === 1) {
              clip.scaleX = -clip.scaleX;
            }

            // AS DefineSprite_30/frame_1/PlaceObject2_29_1 placement (depth 1).
            // onLoad on sprite_29_d1 handles gotoAndPlay(4).
            clip.attach(this.sprite29D1Sym, "sprite29_1", 1, ctx);

            // AS DefineSprite_30/frame_1/PlaceObject2_29_39 placement (depth 39).
            // onLoad on sprite_29_d39 handles gotoAndPlay(3).
            clip.attach(this.sprite29D39Sym, "sprite29_39", 39, ctx);
          },
        ],
        [
          42,
          () => {
            // AS DefineSprite_30/frame_43/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          93,
          (clip) => {
            // AS DefineSprite_30/frame_94/DoAction.as:
            // _parent.removeMovieClip(); stop()
            // sprite_30's parent is root → complete the spell.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite10Sym);
    this.registry.register(this.sprite29D1Sym);
    this.registry.register(this.sprite29D39Sym);
    this.registry.register(this.sprite30Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_2/DoAction.as: stop()
    // The main timeline stops on frame 2. sprite_30 is placed via
    // PlaceObject2_30_1 whose onLoad positions it at cellTo — that
    // onLoad is now wired into sprite_30Sym.onLoad above.
    // No sound in canonical main-timeline scripts for this spell.
    this.root.attach(this.sprite30Sym, "sprite30", 1, context);
  }
}
