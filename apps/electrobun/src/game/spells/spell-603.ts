/**
 * Spell 603 — Dodge (Iop / generic dodge animation).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/603/scripts/scripts/
 *
 * displayType=11 (TargetCell). The animation is a self-contained 222-frame
 * composite anchored at the target cell. No projectile, no caster reference,
 * no dual-anchor — just an impact/dodge visual that plays out at the target.
 *
 * Library symbols (all kind:"clipEvent" — their clip-event handlers MUST run at runtime):
 *
 *   sprite19 (characterId 19) — directlyDynamic:true. A spiralling orb particle.
 *     The inner sprite18 clip placed inside it has:
 *       - PlaceObject2_16_1: sprite16 clone with onLoad → gotoAndPlay(random(60))
 *       - PlaceObject2_17_19: sprite3 clone with onLoad → rotation/alpha seed,
 *                              onEnterFrame → xscale oscillation
 *     sprite19 is attached inside DefineSprite_20 at depth 13 (frame 0),
 *     depth 15 (frame 21), depth 17 (frame 45).
 *
 *   sprite18 (characterId 18) — directlyDynamic:true. Contains:
 *       - PlaceObject2_16_1: sprite16 at depth 1, onLoad → gotoAndPlay(random(60))
 *       - PlaceObject2_17_19: sprite3 at depth 19, onLoad → _rotation/alpha/phase,
 *                              onEnterFrame → _xscale = 100 * sin(i += 0.5)
 *     sprite18 is attached inside sprite19 at depth 1 (frame 0 of sprite19).
 *
 *   sprite4 (characterId 4) — directlyDynamic:false. A small cluster of sprite3
 *     dots placed at static offsets. Its placements in DefineSprite_20 carry
 *     alphaMult color-transform keyframes from near-transparent → opaque →
 *     transparent again. We interpolate alpha linearly in the parent timeline.
 *
 *   sprite3 (characterId 3) — directlyDynamic:true. A tiny dot with gravity
 *     bounce physics (onLoad seeds v=0; onEnterFrame: y+=v; v+=0.6; bounce at y>0).
 *     Placed 6 times inside sprite4 at fixed offsets with varying scales.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("dodge_603").
 *
 * DefineSprite_20 (the outer composite — maps to "anim1" in animations[]):
 *   frame_145 (0-based 144): this.end() → signalHit
 *   frame_220 (0-based 219): _parent.removeMovieClip(); stop() → complete
 *
 * Note: DefineSprite_16 carries a self-accelerating playback script
 * (frame_1/DoAction.as: speed-up loop via onEnterFrame). This is captured
 * on sprite16Sym. sprite16 is placed inside sprite18 at depth 1 (and inside
 * sprite19 indirectly). Since sprite16 is not in librarySymbols (no direct
 * attachMovie) but is referenced from DefineSprite_18's placements, we treat
 * it as a nested container symbol registered for completeness.
 *
 * The overall structure is:
 *   root
 *   └── anim1 (DefineSprite_20, 222 frames, main composite — attached in onSpellStart)
 *       ├── sprite4 at depth 1 (frame 0, color-tweened across frames 0-126)
 *       │   ├── sprite3 at depths 1,3,5,7,9,11 (static offsets, bounce physics)
 *       ├── sprite19 at depth 13 (frame 0)
 *       │   └── sprite18 at depth 1
 *       │       ├── sprite16 at depth 1 (accelerating loop)
 *       │       └── sprite3_osc at depth 19 (oscillating xscale)
 *       ├── sprite19 at depth 15 (frame 21)
 *       └── sprite19 at depth 17 (frame 45)
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

// ---------------------------------------------------------------------------
// Manifest bounds
// ---------------------------------------------------------------------------

const SPRITE3_BOUNDS = {
  width: 5.75,
  height: 4.5,
  offsetX: -2.85,
  offsetY: -2.25,
};

const SPRITE4_BOUNDS = {
  width: 39.55,
  height: 11.25,
  offsetX: -22,
  offsetY: -5.9,
};

const SPRITE18_BOUNDS = {
  width: 46.9,
  height: 46.9,
  offsetX: -18.9,
  offsetY: -21.05,
};

const SPRITE19_BOUNDS = {
  width: 34.75,
  height: 34.75,
  offsetX: -14.05,
  offsetY: -15.7,
};

// anim1 bounds from animations[]
const ANIM1_BOUNDS = {
  width: 43.25,
  height: 34.75,
  offsetX: -22.6,
  offsetY: -15.8,
};

export class Spell603 extends RuntimeSpell {
  readonly spellId = 603;
  readonly displayType = SpellDisplayType.TargetCell;

  // Keep references so onSpellStart can attach anim1 and inner symbols
  // can reference each other.
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE3_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE4_BOUNDS);
    const sprite18Anchor = calculateAnchor(SPRITE18_BOUNDS);
    const sprite19Anchor = calculateAnchor(SPRITE19_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // -----------------------------------------------------------------------
    // sprite3 — tiny dot with gravity bounce
    // AS: DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // -----------------------------------------------------------------------
    const sprite3Sym: SymbolDefinition = {
      name: "sprite3",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,

      // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.v = 0;
        // vx is NOT seeded in onLoad — it's set during the first bounce
        // in onEnterFrame. We initialise to 0 so the cast is safe.
        clip.vars.vx = 0;
      },

      // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        let v = clip.vars.v as number;
        let vx = clip.vars.vx as number;
        clip.y += v;
        clip.x += vx;
        v += 0.6;
        if (clip.y > 0) {
          clip.y = 0;
          v = -5 * Math.random();
          vx = -2.5 * Math.random() + 1.25;
        }
        clip.vars.v = v;
        clip.vars.vx = vx;
      },
    };

    // -----------------------------------------------------------------------
    // sprite16 — accelerating self-playback loop (DefineSprite_16)
    // Not in librarySymbols directly but placed inside sprite18.
    // AS: DefineSprite_16/frame_1/DoAction.as
    // This symbol has authored frames driven by the anim1 composite;
    // we use the anim1 frames as a proxy since sprite16 is not
    // independently exported. We treat it as a container that drives
    // its own timeline acceleration.
    // -----------------------------------------------------------------------
    const sprite16Sym: SymbolDefinition = {
      name: "sprite16",
      // sprite16 is placed inside sprite18 which has 1 authored frame;
      // use anim1 frames as the visual content (closest available asset).
      totalFrames: 222,
      frames: textures.getFrames("anim1"),
      anchorX: 0.5,
      anchorY: 0.5,

      // AS DefineSprite_16/frame_1/DoAction.as
      // Sets up onEnterFrame that accelerates playback speed over time.
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: a = 0; t = 0; this.onEnterFrame = function() { ... }
            clip.vars.a = 0;
            clip.vars.t = 0;
            clip.onEnterFrame = (self) => {
              let a = self.vars.a as number;
              let t = self.vars.t as number;
              // f = _currentframe + t (1-based in AS; runtime uses 0-based)
              let f = self.currentFrame + 1 + t; // convert to 1-based, add t
              const total = self.totalFrames;
              if (f > total) {
                f -= total;
              }
              // gotoAndPlay(f) — f is 1-based in AS → 0-based for runtime
              self.gotoAndPlay(Math.max(0, Math.floor(f) - 1));
              a++;
              if (a % 20 === 1) {
                t += 1;
              }
              self.vars.a = a;
              self.vars.t = t;
            };
          },
        ],
      ]),
    };

    // -----------------------------------------------------------------------
    // sprite18 — orb wrapper containing sprite16 + sprite3 oscillator
    // AS: DefineSprite_18/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_18/frame_1/PlaceObject2_17_19/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_18/frame_1/PlaceObject2_17_19/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // PlaceObject2_16_1 → places sprite16 at depth 1 with onLoad → gotoAndPlay(random(60))
    // PlaceObject2_17_19 → places sprite3 at depth 19 with oscillating xscale
    // -----------------------------------------------------------------------
    const sprite18Sym: SymbolDefinition = {
      name: "sprite18",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite18"),
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // --- PlaceObject2_16_1: place sprite16 at depth 1 ---
            // AS DefineSprite_18/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(load).as:
            //   gotoAndPlay(random(60))
            const s16 = clip.attach(sprite16Sym, "sprite16_inner", 1, ctx);
            s16.gotoAndPlay(Math.floor(Math.random() * 60));

            // --- PlaceObject2_17_19: place sprite3 at depth 19 ---
            // AS DefineSprite_18/frame_1/PlaceObject2_17_19/CLIPACTIONRECORD onClipEvent(load).as:
            //   _rotation = random(360) - 90
            //   _alpha = random(50) + 40
            //   i = Math.random() * 6
            const s3osc = clip.attach(sprite3Sym, "sprite3_osc", 19, ctx);
            s3osc.rotation =
              ((Math.floor(Math.random() * 360) - 90) * Math.PI) / 180;
            s3osc.alpha = (Math.floor(Math.random() * 50) + 40) / 100;
            s3osc.vars.i = Math.random() * 6;

            // AS DefineSprite_18/frame_1/PlaceObject2_17_19/CLIPACTIONRECORD onClipEvent(enterFrame).as:
            //   _xscale = 100 * Math.sin(i += 0.5)
            // Override the default onEnterFrame for this specific instance.
            s3osc.onEnterFrame = (self) => {
              let i = self.vars.i as number;
              i += 0.5;
              // AS _xscale = 100 * sin(i) → decimal scale
              self.scaleX = Math.sin(i);
              self.vars.i = i;
            };
          },
        ],
      ]),
    };

    // -----------------------------------------------------------------------
    // sprite19 — spiralling orb particle
    // Contains sprite18 (placed at depth 1, frame 0, matrix ≈ identity).
    // AS: DefineSprite_19/frame_1/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_19/frame_1/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // Note: sprite19 itself is the "parent" referenced as `this._parent` in
    // the inner sprite18 clip-event handlers. The handlers live on sprite18
    // placed inside sprite19. We model this by:
    //   - sprite19's frameScripts[0]: attach sprite18, then set up the
    //     sprite18 clip's onLoad/onEnterFrame to mirror the canonical
    //     PlaceObject2_18_1 CLIPACTIONRECORD (which fires on the sprite18
    //     instance placed within sprite19).
    //
    // Canonical onLoad (on the sprite18 instance inside sprite19):
    //   p=0; i=0; v2=0.04+0.046*Math.random(); _rotation=random(360);
    //   _alpha=120; r=0.8; _parent._alpha=10; v=0.6+0.6*Math.random()
    //
    // Canonical onEnterFrame (on the sprite18 instance):
    //   if(this._y > -100 & this._parent._alpha < 100) _parent._alpha += 6.6
    //   if(this._y < -100) { _parent._alpha -= 6.6; if(_parent._alpha<0)
    //     { _parent._visible=0; this.stop=1; _parent.removeMovieClip() } }
    //   _rotation = _rotation   (no-op)
    //   this._y = 5*(r+=0.01)*cos(i) + (p -= v)
    //   this._x = 25*r*sin(i += v2)
    //   if(sin(i)>0) _alpha -= 1.3 else _alpha += 1.3
    // -----------------------------------------------------------------------
    const sprite19Sym: SymbolDefinition = {
      name: "sprite19",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite19"),
      anchorX: sprite19Anchor.x,
      anchorY: sprite19Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place sprite18 at depth 1 with canonical matrix (≈ identity, tiny offset)
            // from manifest: placements[0] parentSpriteId=19, frame=0, depth=1,
            // matrix: translateX=-0.05, translateY=-0.1, scale=0.7413
            const s18 = clip.attach(sprite18Sym, "sprite18_inner", 1, ctx, {
              x: -0.05,
              y: -0.1,
            });
            s18.scaleX = 0.7413330078125;
            s18.scaleY = 0.7413330078125;

            // Now seed the CLIPACTIONRECORD onClipEvent(load) state on s18.
            // AS: DefineSprite_19/frame_1/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(load).as
            // These vars are scoped to the sprite18 instance (= s18 here).
            s18.vars.p = 0;
            s18.vars.i = 0;
            s18.vars.v2 = 0.04 + 0.046 * Math.random();
            s18.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            s18.alpha = 120 / 100;
            s18.vars.r = 0.8;
            // _parent._alpha = 10 → sprite19 (= clip) alpha
            clip.alpha = 10 / 100;
            s18.vars.v = 0.6 + 0.6 * Math.random();

            // AS: DefineSprite_19/frame_1/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
            // Override s18's onEnterFrame (replaces the default sprite18Sym handler
            // for this specific instance — per-instance override is correct).
            s18.onEnterFrame = (self) => {
              let p = self.vars.p as number;
              let i_var = self.vars.i as number;
              const v2 = self.vars.v2 as number;
              const v = self.vars.v as number;
              let r = self.vars.r as number;
              const parent = self.parent; // sprite19

              // if(this._y > -100 & this._parent._alpha < 100) _parent._alpha += 6.6
              if (self.y > -100 && (parent?.alpha ?? 0) * 100 < 100) {
                if (parent) {
                  parent.alpha = Math.min(1, parent.alpha + 6.6 / 100);
                }
              }
              // if(this._y < -100) { _parent._alpha -= 6.6; ... }
              if (self.y < -100) {
                if (parent) {
                  parent.alpha = parent.alpha - 6.6 / 100;
                  if (parent.alpha < 0) {
                    parent.visible = false;
                    self.vars.stop = 1;
                    parent.remove();
                    return;
                  }
                }
              }
              // _rotation = _rotation  (no-op — skip)
              // this._y = 5*(r+=0.01)*cos(i) + (p -= v)
              r += 0.01;
              p -= v;
              self.y = 5 * r * Math.cos(i_var) + p;
              // this._x = 25*r*sin(i += v2)
              i_var += v2;
              self.x = 25 * r * Math.sin(i_var);
              // if(sin(i)>0) _alpha -= 1.3 else _alpha += 1.3
              if (Math.sin(i_var) > 0) {
                self.alpha = Math.max(0, self.alpha - 1.3 / 100);
              } else {
                self.alpha = Math.min(1, self.alpha + 1.3 / 100);
              }
              self.vars.p = p;
              self.vars.i = i_var;
              self.vars.r = r;
            };
          },
        ],
      ]),
    };

    // -----------------------------------------------------------------------
    // sprite4 — static cluster of sprite3 dots, directlyDynamic:false
    // Placed in DefineSprite_20 at depth 1, with alpha tween from frame 0–126.
    // Internally holds 6 sprite3 instances at fixed offsets/scales.
    //
    // The manifest's placements[] for sprite4 in DefineSprite_20 show:
    //   frame 0:   alphaMult=13  (alpha ≈ 0.05)
    //   frame 9:   alphaMult=256 (alpha = 1.0)
    //   frame 115: alphaMult=236 (starts fading)
    //   frame 126: alphaMult=13  (nearly gone)
    // We interpolate alpha linearly in anim1Sym's onEnterFrame (or per
    // frameScripts key-frames). For simplicity we key the canonical
    // keyframes; the runtime will tween between them via the parent
    // onEnterFrame approach for the sprite4 child.
    //
    // sprite3 placements inside sprite4 (from manifest librarySymbols[0].placements,
    // all at frame 0 of parentSpriteId=4):
    //   depth 1:  translateX=-8.9,  translateY=3.95,   scale=0.619
    //   depth 3:  translateX=-15.7, translateY=-1.8,   scale=0.395
    //   depth 5:  translateX=7.35,  translateY=1.8,    scale=0.619
    //   depth 7:  translateX=16.4,  translateY=1.9,    scale=0.395
    //   depth 9:  translateX=-21.15,translateY=1.9,    scale=0.293
    //   depth 11: translateX=13.95, translateY=-5.25,  scale=0.293
    // -----------------------------------------------------------------------
    const sprite4Sym: SymbolDefinition = {
      name: "sprite4",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,

      // frameScripts[0]: attach all 6 sprite3 dots at their canonical offsets
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: PlaceObject2 placements inside sprite4 (parentSpriteId=4, frame=0)
            // Each sprite3 instance has independent vars (v, vx) seeded by onLoad.

            // depth 1: translateX=-8.9, translateY=3.95, scale=0.619
            const s3a = clip.attach(sprite3Sym, "dot1", 1, ctx);
            s3a.x = -8.9;
            s3a.y = 3.95;
            s3a.scaleX = 0.6192626953125;
            s3a.scaleY = 0.6192626953125;

            // depth 3: translateX=-15.7, translateY=-1.8, scale=0.395
            const s3b = clip.attach(sprite3Sym, "dot3", 3, ctx);
            s3b.x = -15.7;
            s3b.y = -1.8;
            s3b.scaleX = 0.395050048828125;
            s3b.scaleY = 0.395050048828125;

            // depth 5: translateX=7.35, translateY=1.8, scale=0.619
            const s3c = clip.attach(sprite3Sym, "dot5", 5, ctx);
            s3c.x = 7.35;
            s3c.y = 1.8;
            s3c.scaleX = 0.6192626953125;
            s3c.scaleY = 0.6192626953125;

            // depth 7: translateX=16.4, translateY=1.9, scale=0.395
            const s3d = clip.attach(sprite3Sym, "dot7", 7, ctx);
            s3d.x = 16.4;
            s3d.y = 1.9;
            s3d.scaleX = 0.395050048828125;
            s3d.scaleY = 0.395050048828125;

            // depth 9: translateX=-21.15, translateY=1.9, scale=0.293
            const s3e = clip.attach(sprite3Sym, "dot9", 9, ctx);
            s3e.x = -21.15;
            s3e.y = 1.9;
            s3e.scaleX = 0.292877197265625;
            s3e.scaleY = 0.292877197265625;

            // depth 11: translateX=13.95, translateY=-5.25, scale=0.293
            const s3f = clip.attach(sprite3Sym, "dot11", 11, ctx);
            s3f.x = 13.95;
            s3f.y = -5.25;
            s3f.scaleX = 0.292877197265625;
            s3f.scaleY = 0.292877197265625;
          },
        ],
      ]),
    };

    // -----------------------------------------------------------------------
    // anim1 — outer composite (DefineSprite_20), 222 frames
    // AS: DefineSprite_20/frame_145/DoAction.as → this.end() → signalHit
    //     DefineSprite_20/frame_220/DoAction.as → _parent.removeMovieClip(); stop()
    //
    // Also handles:
    //   - Placing sprite4 at depth 1 (frame 0) with alpha tween 0→1 (frames 0-9)
    //     and fade-out 1→0 (frames 115-126). We track this in onEnterFrame.
    //   - Placing sprite19 at depths 13, 15, 17 at frames 0, 21, 45 respectively.
    //
    // Alpha tween keyframes for sprite4 (alphaMult / 256):
    //   frame  0: 13/256 ≈ 0.051
    //   frame  9: 256/256 = 1.0
    //   frame 115: 236/256 ≈ 0.922
    //   frame 126: 13/256 ≈ 0.051
    // -----------------------------------------------------------------------
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 222,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      frameScripts: new Map([
        [
          // frame_1/DoAction.as of DefineSprite_20 (frame 0):
          // Attach sprite4 at depth 1 (initial alphaMult=13 → alpha≈0.051)
          // Attach sprite19 at depth 13 (first orb, frame 0)
          0,
          (clip, ctx) => {
            // sprite4 placement: frame=0, depth=1, translateX=-0.6, translateY=-1.4
            const s4 = clip.attach(sprite4Sym, "sprite4_inst", 1, ctx);
            s4.x = -0.6;
            s4.y = -1.4;
            s4.alpha = 13 / 256;

            // Store reference to s4 for alpha tween in onEnterFrame
            clip.vars.sprite4Ref = s4;

            // sprite19 placement: frame=0, depth=13, translateX=-0.05, translateY=-0.1
            const s19a = clip.attach(sprite19Sym, "sprite19_d13", 13, ctx);
            s19a.x = -0.05;
            s19a.y = -0.1;
          },
        ],
        [
          // frame 21 (0-based): attach sprite19 at depth 15
          // AS: placements[1] of sprite19: parentSpriteId=20, frame=21, depth=15
          21,
          (clip, ctx) => {
            const s19b = clip.attach(sprite19Sym, "sprite19_d15", 15, ctx);
            s19b.x = -0.05;
            s19b.y = -0.1;
          },
        ],
        [
          // frame 45 (0-based): attach sprite19 at depth 17
          // AS: placements[2] of sprite19: parentSpriteId=20, frame=45, depth=17
          45,
          (clip, ctx) => {
            const s19c = clip.attach(sprite19Sym, "sprite19_d17", 17, ctx);
            s19c.x = -0.05;
            s19c.y = -0.1;
          },
        ],
        [
          // AS: DefineSprite_20/frame_145/DoAction.as → this.end() → signalHit
          144,
          (_clip) => {
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_20/frame_220/DoAction.as → _parent.removeMovieClip(); stop()
          219,
          (clip) => {
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),

      // Alpha tween for sprite4 child across the anim1 timeline.
      // Keyframes (0-based frames):
      //   0 → 0.051, 9 → 1.0, 115 → 0.922, 126 → 0.051, 127+ → remove/hide
      onEnterFrame: (clip) => {
        const s4 = clip.vars.sprite4Ref as
          | { alpha: number; visible: boolean }
          | undefined;
        if (!s4) {
          return;
        }
        const f = clip.currentFrame; // 0-based
        let targetAlpha: number;
        if (f <= 9) {
          // Interpolate 0.051 → 1.0 over frames 0-9
          const t = f / 9;
          targetAlpha = 13 / 256 + t * (1 - 13 / 256);
        } else if (f < 115) {
          targetAlpha = 1.0;
        } else if (f <= 126) {
          // Interpolate 1.0 → 0.051 over frames 115-126
          const t = (f - 115) / (126 - 115);
          targetAlpha = 1.0 - t * (1 - 13 / 256);
        } else {
          targetAlpha = 0;
          s4.visible = false;
          return;
        }
        s4.alpha = targetAlpha;
        s4.visible = true;
      },
    };

    this.registry.register(sprite3Sym);
    this.registry.register(sprite4Sym);
    this.registry.register(sprite16Sym);
    this.registry.register(sprite18Sym);
    this.registry.register(sprite19Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: frame_1/DoAction.as → SOMA.playSound("dodge_603")
    callbacks.playSound("dodge_603");

    // Attach the outer composite (anim1 = DefineSprite_20) to root.
    // This starts its 222-frame timeline; frameScripts inside handle
    // all sub-symbol attaches and the signalHit/complete signals.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
