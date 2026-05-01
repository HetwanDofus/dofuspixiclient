/**
 * Spell 1211 — (Heavy Impact / Falling Weight).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1211/scripts/scripts/
 *
 * displayType=11 (TargetCell). Single impact animation at the target cell.
 * No projectile, no caster reference — just the "anim1" composite anchored
 * at the target.
 *
 * Canonical AS layout:
 *   - DefineSprite_22 (main timeline): frame_1 plays "impact_lourd" sound.
 *   - DefineSprite_28 (anim1 outer container, 81 frames composite):
 *       frame_79: stop(); _parent.removeMovieClip() — signals completion.
 *   - sprite27 (lib_sprite27, 1 frame, directlyDynamic: false):
 *       A wrapper that contains a "fumee" named child of sprite26 at depth 11.
 *       Placed by DefineSprite_28 at various frames with different depths/offsets.
 *       frame_1/DoAction.as: seeds random scale, bounce physics (h, g, vy, hit),
 *       alpha ramp-up/ramp-down, and wires onEnterFrame for gravity bounce.
 *       Calls `poids.gotoAndPlay(random(24)+1)` — but "poids" is sprite26.
 *   - sprite26 (lib_sprite26, 411 frames, directlyDynamic: false):
 *       Named "fumee" inside sprite27 (placed via placements[] at depth 11).
 *       frame_1/DoAction.as: stop(). So it sits still until sprite27 calls
 *       fumee.play() on the bounce.
 *   - sprite25 (lib_sprite25, 1 frame, directlyDynamic: true):
 *       A smoke/particle chip placed inside sprite26 at frame 3 (5 instances).
 *       onClipEvent(load): vx = 1.67 + random(1.67)
 *       onClipEvent(enterFrame): _X += vx; vx *= 0.97
 *       frame_1/DoAction.as: seeds va, t (scale), rotation, onEnterFrame alpha fade.
 *
 * The outer "anim1" is the pre-rendered composite (81 frames). sprite27 instances
 * are attached by DefineSprite_28 at frames 0, 3, 6, 9, 12 (×2) with staggered
 * depths/positions — these are the live bouncing weight clips. sprite25 particles
 * are attached inside sprite26 at its frame 3 (after fumee.play()).
 *
 * Since DefineSprite_28 is the outermost container (parentSpriteId=28 in
 * sprite27 placements), we attach anim1 (sprite28) from onSpellStart, and
 * sprite27 instances are attached by anim1's frameScripts at the canonical frames.
 *
 * signalHit: fired at the first sprite27 attachment (frame 0 of DefineSprite_28),
 * which is the impact moment.
 * complete: fired at DefineSprite_28 frame_79 (index 78).
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

// --- Manifest bounds for library symbols ---

const SPRITE25_BOUNDS = {
  width: 19.6,
  height: 19.6,
  offsetX: -9.8,
  offsetY: -9.8,
};

const SPRITE26_BOUNDS = {
  width: 41.9,
  height: 33.95,
  offsetX: -18.95,
  offsetY: -19.9,
};

const SPRITE27_BOUNDS = {
  width: 41.9,
  height: 43.85,
  offsetX: -17.45,
  offsetY: -19.3,
};

const ANIM1_BOUNDS = {
  width: 87.9,
  height: 78.95,
  offsetX: -43.15,
  offsetY: -173.05,
};

export class Spell1211 extends RuntimeSpell {
  readonly spellId = 1211;
  readonly displayType = SpellDisplayType.TargetCell;

  // We hold references so onSpellStart can attach them.
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite25Anchor = calculateAnchor(SPRITE25_BOUNDS);
    const sprite26Anchor = calculateAnchor(SPRITE26_BOUNDS);
    const sprite27Anchor = calculateAnchor(SPRITE27_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite25 — smoke chip particle (directlyDynamic: true) --
    // AS DefineSprite_25/frame_1/PlaceObject2_24_1/CLIPACTIONRECORD onClipEvent(load):
    //   vx = 1.67 + random(1.67)
    // AS DefineSprite_25/frame_1/PlaceObject2_24_1/CLIPACTIONRECORD onClipEvent(enterFrame):
    //   _X = _X + vx;  vx *= 0.97
    // AS DefineSprite_25/frame_1/DoAction.as:
    //   va = 1.67 + random(1.67)
    //   t = 50 + random(50)
    //   _xscale = t;  _yscale = t
    //   _rotation = random(360)
    //   this.onEnterFrame = function() { _alpha = _alpha - va; }
    // NOTE: The DoAction.as wires its OWN onEnterFrame for alpha fade.
    // The CLIPACTIONRECORD's onClipEvent(enterFrame) drives X-drift.
    // Both run every frame — we combine them in a single onEnterFrame handler,
    // and seed vars in onLoad.
    const sprite25Sym: SymbolDefinition = {
      name: "sprite25",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite25"),
      anchorX: sprite25Anchor.x,
      anchorY: sprite25Anchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load): vx = 1.67 + random(1.67)
        clip.vars.vx = 1.67 + Math.floor(Math.random() * 1.67);
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_25/frame_1/DoAction.as
            const va = 1.67 + Math.floor(Math.random() * 1.67);
            clip.vars.va = va;
            const t = 50 + Math.floor(Math.random() * 50);
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame): _X += vx; vx *= 0.97
        // + DoAction's onEnterFrame: _alpha -= va
        const vx = clip.vars.vx as number;
        clip.x += vx;
        clip.vars.vx = vx * 0.97;

        const va = clip.vars.va as number;
        clip.alpha = clip.alpha - va / 100;
      },
    };

    // ---- sprite26 — "poids/fumee" smoke puff (directlyDynamic: false) --
    // AS DefineSprite_26/frame_1/DoAction.as: stop()
    // 411-frame animation. Placed inside sprite27 with name "fumee" at depth 11.
    // Starts stopped; sprite27 calls fumee.play() on the bounce.
    // At frame 3 (index 2), 5 sprite25 instances are placed via placements[].
    const sprite25SymRef = sprite25Sym; // capture for use in frameScripts closure
    const sprite26Sym: SymbolDefinition = {
      name: "sprite26",
      totalFrames: 411,
      frames: textures.getFrames("lib_sprite26"),
      anchorX: sprite26Anchor.x,
      anchorY: sprite26Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_26/frame_1/DoAction.as: stop()
            clip.stop();
          },
        ],
        [
          2,
          (clip, ctx) => {
            // Canonical placements of sprite25 inside sprite26 at frame 3 (index 2).
            // 5 instances at depths 1, 3, 5, 7, 9 with different offsets.
            // AS placements from manifest sprite25.placements[] where parentSpriteId=26, frame=3:
            //   depth 1: x=13.15, y=-0.3
            //   depth 3: x=3.35,  y=-10.1
            //   depth 5: x=-9.15, y=-5.55
            //   depth 7: x=0.65,  y=4.25
            //   depth 9: x=-9.15, y=4.25
            clip.attach(sprite25SymRef, "p1", 1, ctx, { x: 13.15, y: -0.3 });
            clip.attach(sprite25SymRef, "p3", 3, ctx, { x: 3.35, y: -10.1 });
            clip.attach(sprite25SymRef, "p5", 5, ctx, { x: -9.15, y: -5.55 });
            clip.attach(sprite25SymRef, "p7", 7, ctx, { x: 0.65, y: 4.25 });
            clip.attach(sprite25SymRef, "p9", 9, ctx, { x: -9.15, y: 4.25 });
          },
        ],
      ]),
    };

    // ---- sprite27 — bouncing weight container (directlyDynamic: false) --
    // AS DefineSprite_27/frame_1/DoAction.as:
    //   t = 50 + random(50)
    //   _xscale = _xscale * (t/100);  _yscale = _yscale * (t/100)
    //   h = -20 + random(40)
    //   g = 0.5
    //   _alpha = 1.67
    //   vy = 0
    //   hit = 0
    //   poids.gotoAndPlay(random(24) + 1)
    //   this.onEnterFrame: alpha ramp, gravity bounce, fumee.play() on land
    // "poids" in the AS refers to a child named "poids" inside sprite27.
    // Looking at placements: sprite26 is placed inside sprite27 at depth 11 named "fumee".
    // The AS calls `poids.gotoAndPlay(...)` but the placed child is named "fumee" in placements.
    // In canonical AS, "poids" would be the sprite26 child. We treat fumee as poids.
    const sprite26SymRef = sprite26Sym; // capture for closure
    const sprite27Sym: SymbolDefinition = {
      name: "sprite27",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite27"),
      anchorX: sprite27Anchor.x,
      anchorY: sprite27Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_27/frame_1/DoAction.as
            // First attach the "fumee" child (sprite26) at depth 11.
            // Canonical placement: parentSpriteId=27, frame=0, depth=11, x=1.5, y=10.5, name="fumee"
            const fumee = clip.attach(sprite26SymRef, "fumee", 11, ctx, {
              x: 1.5,
              y: 10.5,
            });

            const t = 50 + Math.floor(Math.random() * 50);
            clip.scaleX = clip.scaleX * (t / 100);
            clip.scaleY = clip.scaleY * (t / 100);
            const h = -20 + Math.floor(Math.random() * 40);
            clip.vars.h = h;
            clip.vars.g = 0.5;
            clip.alpha = 1.67 / 100;
            clip.vars.vy = 0;
            clip.vars.hit = 0;

            // poids.gotoAndPlay(random(24) + 1) — "poids" is fumee (sprite26)
            const frame = Math.floor(Math.random() * 24) + 1;
            fumee.gotoAndPlay(frame - 1); // AS 1-based → 0-based

            clip.onEnterFrame = (self, _ctx) => {
              // AS DefineSprite_27/frame_1 onEnterFrame:
              //   if (hit != 1) { _alpha += 5 } else { _alpha -= 3.34 }
              //   _Y += vy
              //   if (_Y > h) { hit=1; fumee.play(); poids.stop(); _Y=h; vy=(-vy)*0.3 }
              //   vy += g
              const hit = self.vars.hit as number;
              const vy = self.vars.vy as number;
              const g2 = self.vars.g as number;
              const hVal = self.vars.h as number;

              if (hit !== 1) {
                self.alpha = self.alpha + 5 / 100;
              } else {
                self.alpha = self.alpha - 3.34 / 100;
              }

              self.y += vy;

              if (self.y > hVal) {
                self.vars.hit = 1;
                // fumee.play() — resume the smoke animation
                const fumeeClip = self.children.get("fumee");
                if (fumeeClip) {
                  fumeeClip.play();
                  fumeeClip.stop(); // poids.stop() — stop after triggering
                }
                self.y = hVal;
                self.vars.vy = -vy * 0.3;
              } else {
                self.vars.vy = vy + g2;
              }
            };
          },
        ],
      ]),
    };

    // ---- anim1 — outer DefineSprite_28, 81-frame composite container --
    // AS DefineSprite_28/frame_79/DoAction.as: stop(); _parent.removeMovieClip()
    // Also places sprite27 instances at frames 0, 3, 6, 9, 12 (×2) per placements[].
    // signalHit at frame 0 (first weight drops = impact moment).
    const sprite27SymRef = sprite27Sym; // capture for closure
    const self1211 = this; // capture for runtime access
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 81,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Canonical: sprite27 placed at DefineSprite_28 frame 0 (index 0), depth 1
            // placement: parentSpriteId=28, frame=0, depth=1, x=1.5, y=-153.75
            clip.attach(sprite27SymRef, "w1", 1, ctx, {
              x: 1.5,
              y: -153.75,
            });
            // First weight lands = hit moment
            self1211.runtime.signalHit();
          },
        ],
        [
          2,
          (clip, ctx) => {
            // Canonical: sprite27 placed at DefineSprite_28 frame 3 (index 2), depth 13
            // placement: parentSpriteId=28, frame=3, depth=13, x=-25.7, y=-137.75
            clip.attach(sprite27SymRef, "w13", 13, ctx, {
              x: -25.7,
              y: -137.75,
            });
          },
        ],
        [
          5,
          (clip, ctx) => {
            // Canonical: sprite27 placed at DefineSprite_28 frame 6 (index 5), depth 25
            // placement: parentSpriteId=28, frame=6, depth=25, x=-4.1, y=-136.15
            clip.attach(sprite27SymRef, "w25", 25, ctx, {
              x: -4.1,
              y: -136.15,
            });
          },
        ],
        [
          8,
          (clip, ctx) => {
            // Canonical: sprite27 placed at DefineSprite_28 frame 9 (index 8), depth 37
            // placement: parentSpriteId=28, frame=9, depth=37, x=20.3, y=-140.15
            clip.attach(sprite27SymRef, "w37", 37, ctx, {
              x: 20.3,
              y: -140.15,
            });
          },
        ],
        [
          11,
          (clip, ctx) => {
            // Canonical: sprite27 placed at DefineSprite_28 frame 12 (index 11), depth 49 and 61
            // placement depth 49: x=-17.7, y=-118.65
            // placement depth 61: x=9.5,   y=-118.65
            clip.attach(sprite27SymRef, "w49", 49, ctx, {
              x: -17.7,
              y: -118.65,
            });
            clip.attach(sprite27SymRef, "w61", 61, ctx, {
              x: 9.5,
              y: -118.65,
            });
          },
        ],
        [
          78,
          (clip) => {
            // AS DefineSprite_28/frame_79/DoAction.as: stop(); _parent.removeMovieClip()
            clip.stop();
            clip.remove();
            self1211.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite25Sym);
    this.registry.register(sprite26Sym);
    this.registry.register(sprite27Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS DefineSprite_22/frame_1/DoAction.as: SOMA.playSound("impact_lourd")
    callbacks.playSound("impact_lourd");

    // Attach the outer anim1 container at root (it IS the main timeline content).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
