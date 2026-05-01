/**
 * Spell 809 — Lakam (Earth/Rock spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/809/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single `shoot` animation in
 * `animations[]` (no `move` symbol, no projectile arc, no caster reference).
 * It renders entirely at the target cell.
 *
 * Symbol / script layout:
 *
 *   - DefineSprite_39 (outer container, 208 frames):
 *       frame_58:  this.end() → signalHit
 *       frame_208: _parent.removeMovieClip() + stop() → complete
 *       Internally places DefineSprite_6 (sprite6) at depth 3, offset (0.45, -5.15)
 *       and DefineSprite_35 at depth 5.
 *
 *   - DefineSprite_6 (sprite6, 190 frames, directlyDynamic: true):
 *       onClipEvent(enterFrame) on its internal PlaceObject2_4_3 child:
 *       spawns pairs of `pierres` while c < level * 3.
 *
 *   - DefineSprite_15_pierres (pierres, 1 frame):
 *       onClipEvent(load): seeds vd, vx, vy, an, v2x, v2y, t, v, vr; positions
 *         _parent wrapper; sets scale.
 *       onClipEvent(enterFrame): ballistic flight, rotation, alpha fade, removal.
 *
 *   - DefineSprite_35 (inner rotating/fading sub-sprite, 49 frames):
 *       frame_1 DoAction: _rotation = random(360); t = 20+random(40); scale/alpha.
 *       frame_49 DoAction: stop().
 *       onClipEvent(enterFrame) on PlaceObject2_8_5 (depth 5 of shoot):
 *         _rotation += 35 deg/frame; _alpha -= 5/frame.
 *
 *   - lib_pierres — rock particle. onLoad seeds physics vars. onEnterFrame
 *                   integrates ballistic motion, rotation, alpha fade, removes
 *                   parent wrapper when alpha < 10%.
 *   - lib_sprite6 — 190-frame sub-composite. onEnterFrame spawns pierres pairs.
 *
 * Main timeline: SOMA.playSound("lakam_405").
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

const PIERRES_BOUNDS = {
  width: 16.15,
  height: 20.5,
  offsetX: -8.15,
  offsetY: -8.6,
};

const SPRITE6_BOUNDS = {
  width: 126.25,
  height: 122.8,
  offsetX: -62.05,
  offsetY: -98,
};

const SHOOT_BOUNDS = {
  width: 126.25,
  height: 122.8,
  offsetX: -61.6,
  offsetY: -103.15,
};

// DefineSprite_35 has no manifest librarySymbols entry — it is an anonymous
// inner sprite placed at depth 5 of shoot by the SWF timeline. We give it
// a neutral 0.5/0.5 anchor since no bounds data is available.
const SPRITE35_BOUNDS = {
  anchorX: 0.5,
  anchorY: 0.5,
};

export class Spell809 extends RuntimeSpell {
  readonly spellId = 809;
  readonly displayType = SpellDisplayType.TargetCell;

  private pierresSym!: SymbolDefinition;
  private sprite6Sym!: SymbolDefinition;
  private sprite35Sym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- lib_pierres — rock particle with ballistic physics ----------
    // AS: DefineSprite_15_pierres/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_15_pierres/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_15_pierres/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load).as
        // vd = 30 + random(30)
        // gotoAndPlay(random(4) + 1)
        // vx = 15 * (Math.random() - 0.5)
        // vy = 15 * (Math.random() - 0.5)
        // an = _parent._parent._parent._parent._parent.angle + 3.1415
        // v2x = Math.cos(an) * 2
        // v2y = Math.sin(an) * 5
        // _parent._x = 20 * (Math.random() - 0.5)
        // _parent._y = 10 * (Math.random() - 0.5)
        // t = 60 + 40 * Math.random()
        // v = -10
        // _xscale = t; _yscale = t
        // vr = 60 * (-0.5 + Math.random())
        const vd = 30 + Math.floor(Math.random() * 30);
        clip.vars.vd = vd;
        clip.vars.tps = 0;

        // AS: gotoAndPlay(random(4) + 1) → 1-based, so startFrame = random(4)
        const startFrame = Math.floor(Math.random() * 4);
        clip.gotoAndPlay(startFrame);

        clip.vars.vx = 15 * (Math.random() - 0.5);
        clip.vars.vy = 15 * (Math.random() - 0.5);

        // AS: _parent._parent._parent._parent._parent.angle
        // Traversal in our tree:
        //   pierres (this) → wrapper → sprite6 → shoot → root
        // root.vars.angle holds the angle in degrees (set by harness).
        const wrapper = clip.parent;
        const sprite6 = wrapper?.parent;
        const shoot = sprite6?.parent;
        const root = shoot?.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        const an = (angleDeg * Math.PI) / 180 + Math.PI;
        clip.vars.an = an;
        clip.vars.v2x = Math.cos(an) * 2;
        clip.vars.v2y = Math.sin(an) * 5;

        // AS: _parent._x = 20 * (Math.random() - 0.5)
        //     _parent._y = 10 * (Math.random() - 0.5)
        // _parent of the pierres clip (inside the wrapper) is the wrapper container
        if (wrapper) {
          wrapper.x = 20 * (Math.random() - 0.5);
          wrapper.y = 10 * (Math.random() - 0.5);
        }

        const t = 60 + 40 * Math.random();
        clip.vars.v = -10;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.vr = 60 * (-0.5 + Math.random());
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_15_pierres/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // if(_alpha < 10) { removeMovieClip(_parent) }
        // _parent._x += vx
        // _parent._y += vy
        // _rotation = _rotation + vr
        // if(tps++ < vd) { _Y += v; vx /= 1.2; vy /= 1.2; v /= 1.2 }
        // if(tps++ > vd) { _Y += (v2y *= 1.2); _parent._y += 10; _X += (v2x *= 1.2); _alpha -= 10 }
        if (clip.alpha < 10 / 100) {
          const wrapper = clip.parent;
          if (wrapper) {
            wrapper.remove();
          }
          return;
        }

        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const vr = clip.vars.vr as number;
        let tps = clip.vars.tps as number;
        const vd = clip.vars.vd as number;
        let v = clip.vars.v as number;
        let v2x = clip.vars.v2x as number;
        let v2y = clip.vars.v2y as number;
        const wrapper = clip.parent;

        if (wrapper) {
          wrapper.x += vx;
          wrapper.y += vy;
        }

        // AS: _rotation = _rotation + vr (degrees delta)
        clip.rotation += (vr * Math.PI) / 180;

        // AS: if(tps++ < vd) — post-increment: check current value, then increment
        if (tps < vd) {
          clip.y += v;
          vx /= 1.2;
          vy /= 1.2;
          v /= 1.2;
          clip.vars.vx = vx;
          clip.vars.vy = vy;
          clip.vars.v = v;
        }
        tps++;

        // AS: if(tps++ > vd) — second post-increment on the same tick
        if (tps > vd) {
          v2y *= 1.2;
          clip.y += v2y;
          if (wrapper) {
            wrapper.y += 10;
          }
          v2x *= 1.2;
          clip.x += v2x;
          clip.alpha -= 10 / 100;
          clip.vars.v2x = v2x;
          clip.vars.v2y = v2y;
        }
        tps++;

        clip.vars.tps = tps;
      },
    };

    // ---- DefineSprite_35 — inner rotating/fading sub-sprite at depth 5 ----
    // AS: DefineSprite_35/frame_1/DoAction.as
    //   _rotation = random(360)
    //   t = 20 + random(40)
    //   _xscale = t; _yscale = t
    //   _alpha = 60 + random(40)
    // AS: DefineSprite_35/frame_49/DoAction.as
    //   stop()
    // AS: DefineSprite_9_shoot/frame_1/PlaceObject2_8_5/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + 35
    //   _alpha = _alpha - 5
    this.sprite35Sym = {
      name: "sprite35",
      totalFrames: 49,
      frames: [],
      anchorX: SPRITE35_BOUNDS.anchorX,
      anchorY: SPRITE35_BOUNDS.anchorY,
      onEnterFrame: (clip) => {
        // AS DefineSprite_9_shoot/frame_1/PlaceObject2_8_5/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation + 35  (degrees)
        // _alpha = _alpha - 5         (0-100 range)
        clip.rotation += (35 * Math.PI) / 180;
        clip.alpha -= 5 / 100;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_35/frame_1/DoAction.as
            // _rotation = random(360)
            // t = 20 + random(40)
            // _xscale = t; _yscale = t
            // _alpha = 60 + random(40)
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            const t = 20 + Math.floor(Math.random() * 40);
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.alpha = (60 + Math.floor(Math.random() * 40)) / 100;
          },
        ],
        [
          48,
          (clip) => {
            // AS DefineSprite_35/frame_49/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- lib_sprite6 — 190-frame sub-composite, spawns pierres pairs ----
    // AS: DefineSprite_6/frame_1/PlaceObject2_4_3/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // directlyDynamic: true — has its own clipEvent enterFrame that spawns pierres.
    // The enterFrame runs on an inner sub-instance (PlaceObject2_4_3) inside sprite6.
    // We model sprite6's onLoad + onEnterFrame to drive this spawning logic, since
    // the sub-instance is represented by sprite6 itself in our runtime tree.
    this.sprite6Sym = {
      name: "sprite6",
      totalFrames: 190,
      frames: textures.getFrames("lib_sprite6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      onLoad: (clip) => {
        // Initialize the counter c used by the enterFrame spawner.
        // AS: c is a dynamic property on PlaceObject2_4_3 sub-instance.
        clip.vars.c = 0;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_6/frame_1/PlaceObject2_4_3/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // if(c < _parent._parent._parent.level * 3) {
        //   c += 1; this.attachMovie("pierres","pierres" + c, c);
        //   c += 1; this.attachMovie("pierres","pierres" + c, c);
        // }
        //
        // _parent._parent._parent.level:
        //   PlaceObject2_4_3 (sub of sprite6) → sprite6 → shoot → root
        //   In our tree: sprite6 → shoot → root
        const shoot = clip.parent;
        const root = shoot?.parent;
        const level = (root?.vars.level as number) ?? 1;
        let c = clip.vars.c as number;

        if (c < level * 3) {
          // First pierres: create a wrapper container then attach pierres inside it
          c += 1;
          const wrapperSym1: SymbolDefinition = {
            name: `__wrapper_${c}`,
            totalFrames: 1,
            frames: [],
            anchorX: 0.5,
            anchorY: 0.5,
          };
          const wrapper1 = clip.attach(wrapperSym1, `pierres_wrapper_${c}`, c, ctx);
          wrapper1.attach(this.pierresSym, `pierres${c}`, 1, ctx);

          // Second pierres
          c += 1;
          const wrapperSym2: SymbolDefinition = {
            name: `__wrapper_${c}`,
            totalFrames: 1,
            frames: [],
            anchorX: 0.5,
            anchorY: 0.5,
          };
          const wrapper2 = clip.attach(wrapperSym2, `pierres_wrapper_${c}`, c, ctx);
          wrapper2.attach(this.pierresSym, `pierres${c}`, 1, ctx);

          clip.vars.c = c;
        }
      },
    };

    // ---- shoot — outer container (DefineSprite_39, 208 authored frames) ----
    // animations[] "shoot" has 166 rendered SVG frames; DefineSprite_39 runs to
    // frame 208 per the AS scripts. We set totalFrames=208 so the frame_58 and
    // frame_208 scripts fire at the correct logical frames. The texture provider
    // will clamp beyond frame 165 to the last available SVG frame automatically.
    //
    // frame_1 (index 0): attach sprite6 at depth 3, offset (0.45, -5.15)
    //                    attach sprite35 at depth 5 (the rotating/fading sub-sprite)
    // frame_58 (index 57): this.end() → signalHit
    // frame_208 (index 207): _parent.removeMovieClip() + stop() → complete
    //
    // The alphaMult colorTransform tween on the sprite6 child (frames 117-140 in
    // placements[]) is driven per-frame via onEnterFrame on the shoot clip.
    this.shootSym = {
      name: "shoot",
      totalFrames: 208,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      onEnterFrame: (clip) => {
        // Handle the alphaMult colorTransform tween on sprite6 (depth 3).
        // placements[] shows alphaMult stepping from 246 (frame 117) down to 23
        // (frame 140) — a decrease of ~9.7 per frame over 24 frames.
        // AS canonical: SWF tween on PlaceObject2 colorTransform applies to the
        // placed child each frame. We replicate this by updating sprite6's alpha
        // in onEnterFrame of the parent shoot container.
        const currentFrame = clip.currentFrame;
        if (currentFrame >= 117 && currentFrame <= 140) {
          const sprite6Child = clip.children.get("sprite6");
          if (sprite6Child) {
            // alphaMult values from placements[] (0-indexed frame → alphaMult/256):
            // frame 117: 246, 118: 237, 119: 227, 120: 217, 121: 207, 122: 198,
            // 123: 188, 124: 178, 125: 169, 126: 159, 127: 149, 128: 140,
            // 129: 130, 130: 120, 131: 110, 132: 101, 133: 91, 134: 81,
            // 135: 72, 136: 62, 137: 52, 138: 42, 139: 33, 140: 23
            const alphaMultValues: readonly number[] = [
              246, 237, 227, 217, 207, 198, 188, 178, 169, 159, 149, 140,
              130, 120, 110, 101, 91, 81, 72, 62, 52, 42, 33, 23,
            ];
            const idx = currentFrame - 117;
            if (idx >= 0 && idx < alphaMultValues.length) {
              const alphaMult = alphaMultValues[idx] ?? 23;
              sprite6Child.alpha = alphaMult / 256;
            }
          }
        }
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: frame_1 of DefineSprite_39 places sprite6 (DefineSprite_6) at
            // depth 3 with matrix translateX=0.45, translateY=-5.15.
            // Also places DefineSprite_35 at depth 5 (PlaceObject2_8_5) which
            // has the rotating/fading enterFrame handler.
            clip.attach(this.sprite6Sym, "sprite6", 3, ctx, {
              x: 0.45,
              y: -5.15,
            });
            clip.attach(this.sprite35Sym, "sprite35", 5, ctx);
          },
        ],
        [
          57,
          () => {
            // AS DefineSprite_39/frame_58/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          207,
          (clip) => {
            // AS DefineSprite_39/frame_208/DoAction.as: _parent.removeMovieClip(); stop();
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite35Sym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("lakam_405");
    callbacks.playSound("lakam_405");

    // Attach the outer shoot container at the root level.
    // displayType=11 (TargetCell): root container is already positioned at
    // target cell — shoot attaches at local (0,0).
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
