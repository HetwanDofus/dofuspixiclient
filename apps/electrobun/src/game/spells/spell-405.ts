/**
 * Spell 405 — Lakam (Sadida water spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/405/scripts/scripts/
 *
 * displayType=11 (TargetCell). Single impact animation anchored at the target cell.
 * No projectile, no caster reference, no beam. The main timeline just plays a sound
 * and the animation plays out at the target.
 *
 * Canonical AS layout:
 *
 *   - Main timeline frame_1: SOMA.playSound("lakam_405")
 *
 *   - DefineSprite_19 (outer container, 153 frames = anim1):
 *       Placed as the root animation. Contains multiple staggered PlaceObject2
 *       placements of sprite18 (the water-drop composite) at various depths and
 *       frames, each with level-based visibility rules.
 *       frame_112: this.end() → signalHit
 *       frame_151: _parent.removeMovieClip() + stop() → spell complete
 *
 *   - sprite18 (characterId=18, directlyDynamic=true, 24 frames):
 *       A water splash composite. Each instance placed into DefineSprite_19 at
 *       different frames/depths/positions carries a sprite16 (characterId=16)
 *       child internally. The sprite18 symbol itself has clip event handlers
 *       (onLoad/onEnterFrame) on its inner sprite16 child that drive water drop
 *       particles. It also has frame_22: stop().
 *
 *   - DefineSprite_18 internal child (PlaceObject2_16_1, the actual particle driver):
 *       onLoad: seeds v, va, t, r; sets scale from t.
 *       onEnterFrame: moves X by v; decrements alpha by va; spawns goutte drops
 *                     up to 4*level; decelerates v by /1.2.
 *
 *   - goutte (characterId=12): single-frame water droplet. frame_1: stop().
 *
 *   - DefineSprite_11_shoot (shoot, characterId=11):
 *       A separate "shoot" symbol referenced in the scripts list.
 *       PlaceObject2_10_1 onLoad: t = 50 + 10*level; sets scale from t.
 *
 *   - DefineSprite_7: frame_1: _rotation=random(360); _alpha=50. (rotation+alpha particle)
 *
 *   - DefineSprite_4: frame_1: _rotation=random(360). (simple rotation particle)
 *
 * Level-based visibility rules on sprite18 placements inside DefineSprite_19:
 *   depth 6  (frame 0):  visible if level >= 2
 *   depth 11 (frame 6):  visible if level >= 3
 *   depth 16 (frame 6):  visible if level >= 3
 *   depth 21 (frame 12): visible if level >= 5
 *   depth 26 (frame 12): visible if level >= 4
 *   depth 31 (frame 30): visible if level >= 2
 *   depth 41 (frame 36): visible if level >= 3
 *   depth 46 (frame 36): visible if level >= 3
 *   depth 51 (frame 42): visible if level >= 5
 *   depth 56 (frame 42): visible if level >= 4
 *   depth 1  (frame 0):  always visible (no script)
 *
 * The outer DefineSprite_19 is represented by the "anim1" animation in the manifest.
 * We register it as a SymbolDefinition and attach it from onSpellStart.
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

// ---- Manifest bounds for library symbols ----

const GOUTTE_BOUNDS = {
  width: 0,
  height: 0,
  offsetX: 0,
  offsetY: 0,
};

const SPRITE18_BOUNDS = {
  width: 107.4,
  height: 109.3,
  offsetX: -50.05,
  offsetY: -56.65,
};

// anim1 bounds (the outer DefineSprite_19 container)
const ANIM1_BOUNDS = {
  width: 117.9,
  height: 113.5,
  offsetX: -41.55,
  offsetY: -56.25,
};

export class Spell405 extends RuntimeSpell {
  readonly spellId = 405;
  readonly displayType = SpellDisplayType.TargetCell;

  private goutteSymDef!: SymbolDefinition;
  private sprite18SymDef!: SymbolDefinition;
  private anim1SymDef!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ----------------------------------------------------------------
    // goutte — single-frame water droplet (characterId=12, lib_goutte)
    // AS DefineSprite_12_goutte/frame_1/DoAction.as: stop();
    // ----------------------------------------------------------------
    const goutteAnchor = calculateAnchor(
      GOUTTE_BOUNDS.width > 0
        ? GOUTTE_BOUNDS
        : { width: 1, height: 1, offsetX: -0.5, offsetY: -0.5 },
    );

    this.goutteSymDef = {
      name: "goutte",
      totalFrames: 1,
      frames: textures.getFrames("lib_goutte"),
      anchorX: goutteAnchor.x,
      anchorY: goutteAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_12_goutte/frame_1/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite18 — water splash composite (characterId=18, lib_sprite18)
    // directlyDynamic=true: owns clip event handlers on its inner
    // PlaceObject2_16_1 child.
    //
    // The sprite18 symbol is placed multiple times inside DefineSprite_19
    // at various frames and depths, each with level-based visibility rules.
    //
    // Internally, sprite18 has a placed child (PlaceObject2_16_1) which
    // carries the onLoad/onEnterFrame for drop-particle physics.
    //
    // Since in our runtime sprite18 IS the particle actor (the "inner
    // child" referred to by PlaceObject2_16_1 scripts is the clip
    // event handler on the sprite18 instance itself), we port the
    // PlaceObject2_16_1 onLoad/onEnterFrame directly onto sprite18's
    // SymbolDefinition handlers.
    //
    // AS DefineSprite_18/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(load):
    //   v = 5 + 18 * Math.random();
    //   va = 1 + Math.random(3);   ← NOTE: Math.random() ignores arg, same as Math.random()
    //   t = 50 + 50 * Math.random();
    //   r = 0.1 + Math.random() * 0.8;
    //   _xscale = t; _yscale = t;
    //
    // AS DefineSprite_18/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(enterFrame):
    //   _X = _X + v;
    //   _alpha = _alpha - va;
    //   if(c < 4 * _parent._parent._parent.level) {
    //     _parent.attachMovie("goutte","goutte" + c, c + 1);
    //     eval("_parent.goutte" + c)._x = _X;
    //     c++;
    //   }
    //   v /= 1.2;
    //
    // AS DefineSprite_18/frame_22/DoAction.as: stop();
    // ----------------------------------------------------------------
    const sprite18Anchor = calculateAnchor(SPRITE18_BOUNDS);

    this.sprite18SymDef = {
      name: "sprite18",
      totalFrames: 24,
      frames: textures.getFrames("lib_sprite18"),
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_18/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.v = 5 + 18 * Math.random();
        // AS: va = 1 + Math.random(3) — Math.random() ignores its argument in AS2,
        // behaves identically to Math.random(). Port as Math.random().
        clip.vars.va = 1 + Math.random();
        const t = 50 + 50 * Math.random();
        clip.vars.t = t;
        clip.vars.r = 0.1 + Math.random() * 0.8;
        clip.vars.c = 0;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_18/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let v = clip.vars.v as number;
        const va = clip.vars.va as number;
        let c = clip.vars.c as number;

        clip.x += v;
        clip.alpha = Math.max(0, clip.alpha - va / 100);

        // _parent._parent._parent.level:
        // PlaceObject2_16_1 is inside sprite18, which is inside DefineSprite_19,
        // which is inside the outer container (root). So from PlaceObject2_16_1's
        // perspective: _parent = sprite18 instance, _parent._parent = DefineSprite_19
        // instance (anim1), _parent._parent._parent = root (outer mc).
        // In our hierarchy: sprite18 clip's parent = anim1 clip, anim1 clip's parent = root.
        const anim1Clip = clip.parent;
        const rootClip = anim1Clip?.parent;
        const level = (rootClip?.vars.level as number) ?? 1;

        if (c < 4 * level) {
          const goutteName = `goutte${c}`;
          const goutte = clip.attach(this.goutteSymDef, goutteName, c + 1, ctx);
          goutte.x = clip.x;
          c++;
          clip.vars.c = c;
        }

        v /= 1.2;
        clip.vars.v = v;
      },
      frameScripts: new Map([
        [
          21,
          (clip) => {
            // AS DefineSprite_18/frame_22/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // anim1 — outer DefineSprite_19 container (153 frames).
    // This is placed as the main animation at the target cell.
    //
    // It contains staggered PlaceObject2 placements of sprite18 at
    // various depths and frames with level-based visibility rules.
    //
    // Placement schedule (from manifest placements[] and CLIPACTIONRECORD scripts):
    //
    //   frame 0,  depth 1:  sprite18 at (13.3, 0.4)  — always visible
    //   frame 0,  depth 6:  sprite18 at (13.3, 0.4)  — visible if level >= 2
    //   frame 6,  depth 11: sprite18 at (13.3, 0.4)  — visible if level >= 3
    //   frame 6,  depth 16: sprite18 at (10.7, 0.4)  — visible if level >= 3
    //   frame 12, depth 21: sprite18 at (10.3, 0.4)  — visible if level >= 5
    //   frame 12, depth 26: sprite18 at (10.3, 0.4)  — visible if level >= 4
    //   frame 30, depth 31: sprite18 at (19.0, 4.6)  — visible if level >= 2
    //   frame 30, depth 36: sprite18 at (19.0, 4.6)  — (no script = always visible)
    //   frame 36, depth 41: sprite18 at (13.3, 0.4)  — visible if level >= 3
    //   frame 36, depth 46: sprite18 at (13.3, 0.4)  — visible if level >= 3
    //   frame 42, depth 51: sprite18 at (8.5,  0.4)  — visible if level >= 5
    //   frame 42, depth 56: sprite18 at (13.3, 0.4)  — visible if level >= 4
    //
    // frame_112: this.end() → signalHit
    // frame_151: _parent.removeMovieClip(); stop(); → complete
    // ----------------------------------------------------------------
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    this.anim1SymDef = {
      name: "anim1",
      totalFrames: 153,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_19/frame_1: PlaceObject2 places sprite18 at depth 1 and depth 6
            const level = (clip.parent?.vars.level as number) ?? 1;

            // depth 1 — always visible (no script restriction)
            {
              const inst = clip.attach(this.sprite18SymDef, "s18_d1", 1, ctx);
              inst.x = 13.3;
              inst.y = 0.4;
            }

            // depth 6 — visible if level >= 2
            // AS DefineSprite_19/frame_1/PlaceObject2_18_6/CLIPACTIONRECORD onClipEvent(load):
            //   if(_parent._parent.level < 2) { _visible = false; }
            {
              const inst = clip.attach(this.sprite18SymDef, "s18_d6", 6, ctx);
              inst.x = 13.3;
              inst.y = 0.4;
              if (level < 2) {
                inst.visible = false;
              }
            }
          },
        ],
        [
          6,
          (clip, ctx) => {
            // AS DefineSprite_19/frame_7: PlaceObject2 places sprite18 at depth 11 and depth 16
            const level = (clip.parent?.vars.level as number) ?? 1;

            // depth 11 — visible if level >= 3
            // AS DefineSprite_19/frame_7/PlaceObject2_18_11/CLIPACTIONRECORD onClipEvent(load):
            //   if(_parent._parent.level < 3) { _visible = false; }
            {
              const inst = clip.attach(this.sprite18SymDef, "s18_d11", 11, ctx);
              inst.x = 13.3;
              inst.y = 0.4;
              if (level < 3) {
                inst.visible = false;
              }
            }

            // depth 16 — visible if level >= 3
            // AS DefineSprite_19/frame_7/PlaceObject2_18_16/CLIPACTIONRECORD onClipEvent(load):
            //   if(_parent._parent.level < 3) { _visible = false; }
            {
              const inst = clip.attach(this.sprite18SymDef, "s18_d16", 16, ctx);
              inst.x = 10.7;
              inst.y = 0.4;
              if (level < 3) {
                inst.visible = false;
              }
            }
          },
        ],
        [
          12,
          (clip, ctx) => {
            // AS DefineSprite_19/frame_13: PlaceObject2 places sprite18 at depth 21 and depth 26
            const level = (clip.parent?.vars.level as number) ?? 1;

            // depth 21 — visible if level >= 5
            // AS DefineSprite_19/frame_13/PlaceObject2_18_21/CLIPACTIONRECORD onClipEvent(load):
            //   if(_parent._parent.level < 5) { _visible = false; }
            {
              const inst = clip.attach(this.sprite18SymDef, "s18_d21", 21, ctx);
              inst.x = 10.3;
              inst.y = 0.4;
              if (level < 5) {
                inst.visible = false;
              }
            }

            // depth 26 — visible if level >= 4
            // AS DefineSprite_19/frame_13/PlaceObject2_18_26/CLIPACTIONRECORD onClipEvent(load):
            //   if(_parent._parent.level < 4) { _visible = false; }
            {
              const inst = clip.attach(this.sprite18SymDef, "s18_d26", 26, ctx);
              inst.x = 10.3;
              inst.y = 0.4;
              if (level < 4) {
                inst.visible = false;
              }
            }
          },
        ],
        [
          30,
          (clip, ctx) => {
            // AS DefineSprite_19/frame_31: PlaceObject2 places sprite18 at depth 31 and depth 36
            const level = (clip.parent?.vars.level as number) ?? 1;

            // depth 31 — visible if level >= 2
            // AS DefineSprite_19/frame_31/PlaceObject2_18_31/CLIPACTIONRECORD onClipEvent(load):
            //   if(_parent._parent.level < 2) { _visible = false; }
            {
              const inst = clip.attach(this.sprite18SymDef, "s18_d31", 31, ctx);
              inst.x = 19.0;
              inst.y = 4.6;
              if (level < 2) {
                inst.visible = false;
              }
            }

            // depth 36 — no visibility script, always visible
            {
              const inst = clip.attach(this.sprite18SymDef, "s18_d36", 36, ctx);
              inst.x = 19.0;
              inst.y = 4.6;
            }
          },
        ],
        [
          36,
          (clip, ctx) => {
            // AS DefineSprite_19/frame_37: PlaceObject2 places sprite18 at depth 41 and depth 46
            const level = (clip.parent?.vars.level as number) ?? 1;

            // depth 41 — visible if level >= 3
            // AS DefineSprite_19/frame_37/PlaceObject2_18_41/CLIPACTIONRECORD onClipEvent(load):
            //   if(_parent._parent.level < 3) { _visible = false; }
            {
              const inst = clip.attach(this.sprite18SymDef, "s18_d41", 41, ctx);
              inst.x = 13.3;
              inst.y = 0.4;
              if (level < 3) {
                inst.visible = false;
              }
            }

            // depth 46 — visible if level >= 3
            // AS DefineSprite_19/frame_37/PlaceObject2_18_46/CLIPACTIONRECORD onClipEvent(load):
            //   if(_parent._parent.level < 3) { _visible = false; }
            {
              const inst = clip.attach(this.sprite18SymDef, "s18_d46", 46, ctx);
              inst.x = 13.3;
              inst.y = 0.4;
              if (level < 3) {
                inst.visible = false;
              }
            }
          },
        ],
        [
          42,
          (clip, ctx) => {
            // AS DefineSprite_19/frame_43: PlaceObject2 places sprite18 at depth 51 and depth 56
            const level = (clip.parent?.vars.level as number) ?? 1;

            // depth 51 — visible if level >= 5
            // AS DefineSprite_19/frame_43/PlaceObject2_18_51/CLIPACTIONRECORD onClipEvent(load):
            //   if(_parent._parent.level < 5) { _visible = false; }
            {
              const inst = clip.attach(this.sprite18SymDef, "s18_d51", 51, ctx);
              inst.x = 8.5;
              inst.y = 0.4;
              if (level < 5) {
                inst.visible = false;
              }
            }

            // depth 56 — visible if level >= 4
            // AS DefineSprite_19/frame_43/PlaceObject2_18_56/CLIPACTIONRECORD onClipEvent(load):
            //   if(_parent._parent.level < 4) { _visible = false; }
            {
              const inst = clip.attach(this.sprite18SymDef, "s18_d56", 56, ctx);
              inst.x = 13.3;
              inst.y = 0.4;
              if (level < 4) {
                inst.visible = false;
              }
            }
          },
        ],
        [
          111,
          () => {
            // AS DefineSprite_19/frame_112/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          150,
          (clip) => {
            // AS DefineSprite_19/frame_151/DoAction.as: _parent.removeMovieClip(); stop();
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.goutteSymDef);
    this.registry.register(this.sprite18SymDef);
    this.registry.register(this.anim1SymDef);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("lakam_405");
    callbacks.playSound("lakam_405");

    // Attach the outer anim1 container (DefineSprite_19) at root.
    // This starts the 153-frame animation at the target cell.
    this.root.attach(this.anim1SymDef, "anim1", 1, context);
  }
}
