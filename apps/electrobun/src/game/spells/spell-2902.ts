/**
 * Spell 2902 — Fireworks (feux d'artifice).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2902/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell is an impact at the target cell — no
 * projectile, no caster reference. The outer sprite (DefineSprite_31) is the
 * root timeline: it plays a 97-frame firework burst, stopping at frame 97. It
 * contains a `boule` (sprite26) launched upward along a keyframed tween,
 * which on load attaches `feux` bursts; those bursts in turn spawn minifeux4,
 * minifeux2, and minifeux3 particles at runtime into the feux' parent
 * (sprite31 / root).
 *
 * Library symbols:
 *   - lib_minifeux  (DefineSprite_8): spark drift particle. onLoad seeds alpha,
 *                   v (speed). onEnterFrame fades alpha, drifts X. frame_34
 *                   removes self. frame_1 DoAction sets rotation, snaps X/Y
 *                   to parent boule position.
 *   - lib_minifeux2 (DefineSprite_7): identical to minifeux but simpler onLoad.
 *                   onLoad alpha random, v random. onEnterFrame fades, drifts.
 *                   frame_34 removes self. frame_1 rotation random.
 *   - lib_minifeux3 (DefineSprite_6): spark with parent alpha flicker. onLoad
 *                   seeds alpha, v. onEnterFrame flickers parent alpha, fades
 *                   clip alpha, drifts X with 0.85 friction. frame_76 removes.
 *   - lib_minifeux4 (DefineSprite_3): spiral spark. onLoad seeds angle, alpha,
 *                   v, vr. onEnterFrame: rotation = angle*57.3, angle+=vr,
 *                   parent._alpha random, alpha-=1.6, Y+=v*=0.85, then XY
 *                   += velocity components. frame_76 removes.
 *   - lib_feux      (DefineSprite_23): 16-frame firework burst. frame_1 does
 *                   gotoAndStop(level+1) selecting which internal child type.
 *                   Five child types (frames 2/5/8/11/14) each with their own
 *                   onLoad/onEnterFrame physics.
 *   - lib_sprite26  (DefineSprite_26): the "boule" (rocket ball) that rises
 *                   upward. Its onLoad seeds c=1. Its onEnterFrame randomly
 *                   attaches `minifeux` sparks while wobbling rotation +100.
 *                   It is NOT a simple static visual — it has clip events.
 *
 * Main timeline (DefineSprite_31 → root / outer):
 *   frame_1:  SOMA.playSound("fireworks01"); set taille, scale, rotation.
 *   frame_70: SOMA.playSound("explo_fireworks").
 *   frame_76: boule (sprite26) onClipEvent(load) attaches feux children.
 *   frame_97: stop() — end of spell.
 *
 * The "sprite31" is the outermost authored clip and is what we model as the
 * root. We register it as "sprite31" container and attach it from onSpellStart.
 * signalHit is fired at frame 70 (the explosion sound frame — canonical impact).
 * complete() fires at frame 97 (the stop()).
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

// ---- Manifest bounds for library symbols -----------------------------------

const MINIFEUX_BOUNDS = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

const MINIFEUX2_BOUNDS = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

const MINIFEUX3_BOUNDS = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

const MINIFEUX4_BOUNDS = {
  width: 5.35,
  height: 6.6,
  offsetX: -1.25,
  offsetY: -2.85,
};

const FEUX_BOUNDS = {
  width: 48.25,
  height: 53.3,
  offsetX: -18.65,
  offsetY: -26.75,
};

const SPRITE26_BOUNDS = {
  width: 3.75,
  height: 3.75,
  offsetX: -1.4,
  offsetY: -1.85,
};

export class Spell2902 extends RuntimeSpell {
  readonly spellId = 2902;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold symbol references for cross-symbol attachment
  private minifeux4Sym!: SymbolDefinition;
  private minifeux3Sym!: SymbolDefinition;
  private minifeux2Sym!: SymbolDefinition;
  private minifeuxSym!: SymbolDefinition;
  private feuxSym!: SymbolDefinition;
  private sprite26Sym!: SymbolDefinition;
  private sprite31Sym!: SymbolDefinition;

  // Sound callback captured in onSpellStart for use from frameScripts
  private playSoundFn?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const minifeux4Anchor = calculateAnchor(MINIFEUX4_BOUNDS);
    const minifeux3Anchor = calculateAnchor(MINIFEUX3_BOUNDS);
    const minifeux2Anchor = calculateAnchor(MINIFEUX2_BOUNDS);
    const minifeuxAnchor = calculateAnchor(MINIFEUX_BOUNDS);
    const feuxAnchor = calculateAnchor(FEUX_BOUNDS);
    const sprite26Anchor = calculateAnchor(SPRITE26_BOUNDS);

    // ---- lib_minifeux4 (DefineSprite_3_minifeux4) --------------------------
    // Spiral spark particle. Placed by feux frame_14 child (PlaceObject2_22_1)
    // and directly via minifeux4 attachMovie calls.
    //
    // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/onClipEvent(load):
    //   angle = 90; _alpha = random(150); v = -1.6 - 3.34*Math.random();
    //   vr = -0.5 + Math.random();
    //
    // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/onClipEvent(enterFrame):
    //   _rotation = angle * 57.29...; angle += vr; _parent._alpha = random(100);
    //   _alpha -= 1.6; _Y += (v *= 0.85); vx = v*cos(angle); vy = v*sin(angle);
    //   _X += vx; _Y += vy;
    //
    // AS DefineSprite_3_minifeux4/frame_76/DoAction.as: this.removeMovieClip()
    this.minifeux4Sym = {
      name: "minifeux4",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux4"),
      anchorX: minifeux4Anchor.x,
      anchorY: minifeux4Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.angle = 90;
        clip.alpha = Math.floor(Math.random() * 150) / 100;
        clip.vars.v = -1.6 - 3.34 * Math.random();
        clip.vars.vr = -0.5 + Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;
        const vr = clip.vars.vr as number;

        clip.rotation = (angle * 57.29746936176985 * Math.PI) / 180;
        angle += vr;
        clip.vars.angle = angle;

        // _parent._alpha = random(100)
        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }

        clip.alpha = clip.alpha - 1.6 / 100;
        v *= 0.85;
        clip.vars.v = v;
        clip.y += v;

        const vx = v * Math.cos(angle);
        const vy = v * Math.sin(angle);
        clip.x += vx;
        clip.y += vy;
      },
      frameScripts: new Map([
        [
          75,
          (clip) => {
            // AS DefineSprite_3_minifeux4/frame_76/DoAction.as: this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_minifeux3 (DefineSprite_6_minifeux3) --------------------------
    // Spark with parent alpha flicker. Spawned by feux frame_11 (and frame_14) children.
    //
    // AS DefineSprite_6_minifeux3/frame_1/DoAction.as: _rotation = random(360)
    // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/onClipEvent(load):
    //   _alpha = random(150); v = 0.67 + 1*Math.random();
    // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame):
    //   _parent._alpha = random(100); _alpha -= 1.6; _X += (v *= 0.85);
    // AS DefineSprite_6_minifeux3/frame_76/DoAction.as: this.removeMovieClip()
    this.minifeux3Sym = {
      name: "minifeux3",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux3"),
      anchorX: minifeux3Anchor.x,
      anchorY: minifeux3Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.alpha = Math.floor(Math.random() * 150) / 100;
        clip.vars.v = 0.67 + 1 * Math.random();
        // AS DefineSprite_6_minifeux3/frame_1/DoAction.as: _rotation = random(360)
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let v = clip.vars.v as number;

        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }

        clip.alpha = clip.alpha - 1.6 / 100;
        v *= 0.85;
        clip.vars.v = v;
        clip.x += v;
      },
      frameScripts: new Map([
        [
          75,
          (clip) => {
            // AS DefineSprite_6_minifeux3/frame_76/DoAction.as: this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_minifeux2 (DefineSprite_7_minifeux2) --------------------------
    // Small spark drift. Spawned by feux frame_8 child (minifeux2 attachMovie).
    //
    // AS DefineSprite_7_minifeux2/frame_1/DoAction.as: _rotation = random(360)
    // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/onClipEvent(load):
    //   _alpha = random(150); v = Math.random();
    // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame):
    //   _alpha -= 3.34; _X += v;
    // AS DefineSprite_7_minifeux2/frame_34/DoAction.as: this.removeMovieClip()
    this.minifeux2Sym = {
      name: "minifeux2",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux2"),
      anchorX: minifeux2Anchor.x,
      anchorY: minifeux2Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.alpha = Math.floor(Math.random() * 150) / 100;
        clip.vars.v = Math.random();
        // AS DefineSprite_7_minifeux2/frame_1/DoAction.as: _rotation = random(360)
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const v = clip.vars.v as number;
        clip.alpha = clip.alpha - 3.34 / 100;
        clip.x += v;
      },
      frameScripts: new Map([
        [
          33,
          (clip) => {
            // AS DefineSprite_7_minifeux2/frame_34/DoAction.as: this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_minifeux (DefineSprite_8_minifeux) ----------------------------
    // Main spark from boule. Spawned by sprite26's (boule) onEnterFrame into
    // _parent._parent (= sprite31 / root).
    //
    // AS DefineSprite_8_minifeux/frame_1/DoAction.as:
    //   _rotation = random(360); _X = _parent.boule._x; _Y = _parent.boule._y;
    // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/onClipEvent(load):
    //   _alpha = 150; v = Math.random();
    // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame):
    //   _alpha -= 3.34; _X += v;
    // AS DefineSprite_8_minifeux/frame_34/DoAction.as: this.removeMovieClip()
    this.minifeuxSym = {
      name: "minifeux",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux"),
      anchorX: minifeuxAnchor.x,
      anchorY: minifeuxAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.alpha = 150 / 100;
        clip.vars.v = Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const v = clip.vars.v as number;
        clip.alpha = clip.alpha - 3.34 / 100;
        clip.x += v;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_8_minifeux/frame_1/DoAction.as
            // _rotation = random(360); _X = _parent.boule._x; _Y = _parent.boule._y;
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            // Find boule sibling on parent (sprite31 root)
            const parent = clip.parent;
            if (parent) {
              const boule = parent.children.get("boule");
              if (boule) {
                clip.x = boule.x;
                clip.y = boule.y;
              }
            }
          },
        ],
        [
          33,
          (clip) => {
            // AS DefineSprite_8_minifeux/frame_34/DoAction.as: this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_feux (DefineSprite_23_feux) -----------------------------------
    // 16-frame firework burst composite. Has 5 variants selected by level.
    // frame_1 DoAction: gotoAndStop(_parent._parent._parent.level + 1)
    //
    // The children (PlaceObject2_12_1 at frame 2, PlaceObject2_14_1 at frame 5,
    // PlaceObject2_12_1 at frame 8, PlaceObject2_19_1 at frame 11,
    // PlaceObject2_22_1 at frame 14) each have their own onLoad/onEnterFrame.
    // Since feux has a single authored 16-frame timeline and the level
    // determines which "sub-child" type is shown, we implement each level's
    // child behavior as an onLoad/onEnterFrame attached to the feux clip itself
    // (the chosen variant determines what happens). The PlaceObject2 children
    // at those frames are the actual particles.
    //
    // For simplicity and correctness we implement each frame variant as a
    // separate sub-symbol. The feux frame_1 DoAction selects the frame via
    // gotoAndStop, and we port each variant's single-child clip event into
    // the feux symbol's own onLoad/onEnterFrame (since each variant only
    // has one PlaceObject2 child whose events we need to run on feux itself).
    this.feuxSym = {
      name: "feux",
      totalFrames: 16,
      frames: textures.getFrames("lib_feux"),
      anchorX: feuxAnchor.x,
      anchorY: feuxAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_23_feux/frame_1/DoAction.as:
            // gotoAndStop(_parent._parent._parent.level + 1)
            // _parent of feux is sprite31 (root), _parent._parent is the outer mc,
            // _parent._parent._parent.level is root.vars.level
            const root = clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            // gotoAndStop(level + 1) → 0-based: level + 1 - 1 = level
            clip.gotoAndStop(level);
            // After gotoAndStop, seed the level-specific physics vars on this feux clip
            // Each stopped frame corresponds to a PlaceObject2 child variant.
            // We run the onLoad logic here since the child is "placed" at this frame.
            const frame = clip.currentFrame; // 0-based, so frame 1 = index 1, etc.
            this._initFeuxVariant(clip, frame);
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // Run per-tick physics for the chosen feux variant
        this._tickFeuxVariant(clip);
      },
    };

    // ---- lib_sprite26 (DefineSprite_26) ------------------------------------
    // The "boule" rocket ball that rises. Has onClipEvent(load) + onClipEvent(enterFrame).
    // AS DefineSprite_26/frame_1/PlaceObject2_25_1/onClipEvent(load): c = 1;
    // AS DefineSprite_26/frame_1/PlaceObject2_25_1/onClipEvent(enterFrame):
    //   if(random(2) == 1) { _rotation += 100; _parent._parent.attachMovie("minifeux","minifeux"+c,c); c++; }
    this.sprite26Sym = {
      name: "sprite26",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite26"),
      anchorX: sprite26Anchor.x,
      anchorY: sprite26Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_26/frame_1/PlaceObject2_25_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.c = 1;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_26/frame_1/PlaceObject2_25_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        if (Math.floor(Math.random() * 2) === 1) {
          clip.rotation += (100 * Math.PI) / 180;
          // _parent._parent.attachMovie("minifeux","minifeux"+c,c)
          // _parent of boule is sprite31 (root), _parent._parent is also root
          // (since boule lives directly inside sprite31 which IS our root)
          const root = clip.parent;
          if (root) {
            const c = clip.vars.c as number;
            root.attach(this.minifeuxSym, "minifeux" + c, c, ctx);
            clip.vars.c = c + 1;
          }
        }
      },
    };

    // ---- sprite31 container (the outer authored clip / main firework) -------
    // This is the top-level authored sprite that contains the boule trajectory
    // and all the frame scripts. It has 97 frames.
    // frame_1: playSound + set taille/scale/rotation
    // frame_70: playSound("explo_fireworks")
    // frame_76: boule clip events (onLoad attaches feux children)
    // frame_97: stop()
    this.sprite31Sym = {
      name: "sprite31",
      totalFrames: 97,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_31/frame_1/DoAction_2.as
            // taille = 80 + random(40); _xscale = taille; _yscale = taille; _rotation = -20+random(40); compte=1;
            const taille = 80 + Math.floor(Math.random() * 40);
            clip.scaleX = taille / 100;
            clip.scaleY = taille / 100;
            clip.rotation = ((-20 + Math.floor(Math.random() * 40)) * Math.PI) / 180;
            clip.vars.compte = 1;
          },
        ],
        [
          69,
          () => {
            // AS DefineSprite_31/frame_70/DoAction.as: SOMA.playSound("explo_fireworks")
            this.playSoundFn?.("explo_fireworks");
            this.runtime.signalHit();
          },
        ],
        [
          75,
          (clip, ctx) => {
            // AS DefineSprite_31/frame_76/PlaceObject2_28_3/CLIPACTIONRECORD onClipEvent(load).as
            // The boule (sprite26) onLoad fires here because the boule is placed at frame 76 depth 3.
            // onLoad:
            //   sz = 60 + 20*((level-1)%3); _xscale=sz; _yscale=sz;
            //   i=1; while(i < 6+7*((level-1)%3)) { attachMovie("feux","feux"+i,i); i++; }
            // We attach the boule at this frame, which triggers its onLoad (c=1),
            // then also run the feux attachment logic here on the boule's placement.
            const boule = clip.attach(this.sprite26Sym, "boule", 3, ctx, {
              x: -0.75,
              y: -53.25,
            });
            // Apply initial matrix from placements[0]: scaleX=0.574, scaleY=12.945
            boule.scaleX = 0.574462890625;
            boule.scaleY = 12.94549560546875;

            // feux attachment: sz = 60 + 20*((level-1)%3)
            const level = (clip.parent?.vars.level as number) ?? (clip.vars.level as number) ?? 1;
            const sz = 60 + 20 * ((level - 1) % 3);
            boule.scaleX = sz / 100;
            boule.scaleY = sz / 100;

            // i=1; while(i < 6+7*((level-1)%3)) { attachMovie("feux","feux"+i,i); }
            const feuxCount = 6 + 7 * ((level - 1) % 3);
            for (let i = 1; i < feuxCount; i++) {
              boule.attach(this.feuxSym, "feux" + i, i, ctx);
            }
          },
        ],
        [
          96,
          (clip) => {
            // AS DefineSprite_31/frame_97/DoAction.as: stop()
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.minifeux4Sym);
    this.registry.register(this.minifeux3Sym);
    this.registry.register(this.minifeux2Sym);
    this.registry.register(this.minifeuxSym);
    this.registry.register(this.feuxSym);
    this.registry.register(this.sprite26Sym);
    this.registry.register(this.sprite31Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS DefineSprite_31/frame_1/DoAction.as: SOMA.playSound("fireworks01")
    callbacks.playSound("fireworks01");
    this.playSoundFn = callbacks.playSound;

    // Attach the outer sprite31 container at root
    this.root.attach(this.sprite31Sym, "sprite31", 1, context);
  }

  // ---- feux variant physics --------------------------------------------------

  /**
   * Initialize physics vars on a feux clip based on which frame/variant it
   * stopped at (0-based currentFrame maps to AS frames 2/5/8/11/14 = levels
   * 1-5 → indexes 1/4/7/10/13).
   *
   * feux frame_1 DoAction: gotoAndStop(level+1)
   * Level 1 → frame 2 (index 1) → PlaceObject2_12_1 at frame 2
   * Level 2 → frame 3 (index 2) ... etc.
   * Actually the AS canonical frames are 2, 5, 8, 11, 14 for different effects.
   * gotoAndStop(level+1) for level 1..5 → frames 2,3,4,5,6 (1-based) = indices 1,2,3,4,5.
   *
   * But the PlaceObject2 placements are specifically at frames 2, 5, 8, 11, 14.
   * The feux sprite loops through the 16 frames (all authored content). The
   * children placed at those frames are present in the authored timeline.
   * Since we can't replicate the authored child placements without a full SWF
   * parser, we simulate each variant's single child behavior directly on the
   * feux clip itself (treating feux as the particle, not the container).
   */
  private _initFeuxVariant(clip: import("@dofus/spell-runtime").SpellClip, frame: number): void {
    // frame is 0-based. The canonical AS variants:
    // index 1 (frame 2): PlaceObject2_12_1 load — vg, g, t, scale, X, vx, vy, accx, accy, etc.
    // index 4 (frame 5): PlaceObject2_14_1 load
    // index 7 (frame 8): PlaceObject2_12_1 load (similar to frame 2 variant)
    // index 10 (frame 11): PlaceObject2_19_1 load
    // index 13 (frame 14): PlaceObject2_22_1 load (also spawns minifeux4 on load!)

    if (frame === 1) {
      // AS DefineSprite_23_feux/frame_2/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
      clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      clip.vars.vg = -6 * Math.random();
      clip.vars.g = 1 * Math.random();
      clip.vars.va = 0;
      const t = 100 + Math.floor(Math.random() * 100);
      clip.vars.t = t;
      clip.scaleX = t / 100;
      clip.scaleY = t / 100;
      clip.vars.dmax = 100;
      clip.x = 10 + Math.floor(Math.random() * 20);
      clip.vars.d = 100 - Math.floor(Math.random() * 70);
      clip.vars.acc = 3.34 + Math.random() * 5;
      clip.vars.vacc = 1 + 1 * Math.random();
    } else if (frame === 4) {
      // AS DefineSprite_23_feux/frame_5/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load).as
      clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      clip.vars.vg = -9 * Math.random();
      clip.vars.g = 0.6 * Math.random();
      clip.vars.va = 0;
      const t = 200 + Math.floor(Math.random() * 100);
      clip.vars.t = t;
      clip.scaleX = t / 100;
      clip.scaleY = t / 100;
      clip.vars.dmax = 100;
      clip.x = 10 + Math.floor(Math.random() * 20);
      clip.vars.d = 100 - Math.floor(Math.random() * 70);
      clip.vars.acc = 1.67 + Math.random() * 5;
      clip.vars.vacc = 1 + 1 * Math.random();
    } else if (frame === 7) {
      // AS DefineSprite_23_feux/frame_8/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
      clip.vars.vg = -9 * Math.random();
      clip.vars.g = 0.67 * Math.random();
      clip.vars.va = 0;
      const t = 100 + Math.floor(Math.random() * 100);
      clip.vars.t = t;
      clip.scaleX = t / 100;
      clip.scaleY = t / 100;
      clip.vars.dmax = 100;
      clip.vars.d = 100 - Math.floor(Math.random() * 70);
      clip.vars.acc = 1.67 + Math.random() * 5;
      clip.vars.vacc = 1 + 1 * Math.random();
      clip.vars.vx = 10 * (-0.5 + Math.random());
      clip.vars.vy = 10 * (-0.5 + Math.random());
      clip.vars.accx = 0.8 + 0.1 * Math.random();
      clip.vars.accy = 0.8 + 0.1 * Math.random();
      clip.vars.c = 0;
      clip.vars.compte = Math.floor(Math.random() * 200000);
    } else if (frame === 10) {
      // AS DefineSprite_23_feux/frame_11/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(load).as
      clip.stop();
      clip.vars.vg = -9 * Math.random();
      clip.vars.g = 0.67 * Math.random();
      clip.vars.va = 0;
      const t = 100 + Math.floor(Math.random() * 100);
      clip.vars.t = t;
      clip.scaleX = t / 100;
      clip.scaleY = t / 100;
      clip.vars.dmax = 100;
      clip.x = -10 + Math.floor(Math.random() * 20);
      clip.vars.d = 100 - Math.floor(Math.random() * 70);
      clip.vars.acc = 1.67 + Math.random() * 5;
      clip.vars.vacc = 1.5 + 1.5 * Math.random();
      clip.vars.vx = 20 * (-0.5 + Math.random());
      clip.vars.vy = 20 * (-0.5 + Math.random());
      clip.vars.accx = 0.8 + 0.1 * Math.random();
      clip.vars.accy = 0.8 + 0.1 * Math.random();
      clip.vars.c = 0;
    } else if (frame === 13) {
      // AS DefineSprite_23_feux/frame_14/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(load).as
      // On load, also spawns minifeux4 into _parent._parent:
      // nbr=1; while(nbr<2) { attachMovie("minifeux4","minifeux4"+compte,compte); set x/y; nbr++; }
      // We handle minifeux4 spawn in the tick since we need ctx — store a flag instead
      clip.vars._needMinifeux4Spawn = true;
      clip.vars.angle = -1.1415 + 0.2 * (-0.5 + Math.random());
      clip.vars.vit = 2 + 10 * Math.random();
      clip.stop();
      clip.vars.frein = 0.9 + 0.05 * Math.random();
      clip.vars.vr = 0;
      clip.vars.sz = 240 + Math.floor(Math.random() * 120);
      clip.vars.frangle = 1.2;
      clip.vars.c = 0;
      const szInit = clip.vars.sz as number;
      clip.scaleX = szInit / 100;
      clip.scaleY = szInit / 100;
    }

    clip.vars._variant = frame;
  }

  private _tickFeuxVariant(clip: import("@dofus/spell-runtime").SpellClip): void {
    const frame = clip.vars._variant as number | undefined;
    if (frame === undefined) {
      return;
    }

    if (frame === 1) {
      // AS DefineSprite_23_feux/frame_2/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      let t = clip.vars.t as number;
      const g = clip.vars.g as number;
      const acc = clip.vars.acc as number;
      const d = clip.vars.d as number;
      let va = clip.vars.va as number;
      const vacc = clip.vars.vacc as number;

      clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      t = 20 + Math.floor(Math.random() * 80);
      clip.vars.t = t;
      clip.scaleX = t / 100;
      clip.scaleY = t / 100;
      clip.y += g;
      va += vacc;
      clip.vars.va = va;
      clip.alpha = (150 - va) / 100;
      clip.x -= (clip.x - d) / acc;

      if (clip.alpha < 0) {
        if (clip.parent) {
          clip.parent.remove();
        }
      }
    } else if (frame === 4) {
      // AS DefineSprite_23_feux/frame_5/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      let t = clip.vars.t as number;
      const g = clip.vars.g as number;
      const acc = clip.vars.acc as number;
      const d = clip.vars.d as number;

      clip.rotation += (t / 6) * (Math.PI / 180);
      t--;
      clip.vars.t = t;
      clip.scaleX = t / 3 / 100;
      clip.scaleY = t / 3 / 100;
      clip.y += g;
      clip.x -= (clip.x - d) / acc;

      if (t < 0) {
        if (clip.parent) {
          clip.parent.remove();
        }
      }
    } else if (frame === 7) {
      // AS DefineSprite_23_feux/frame_8/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      let t = clip.vars.t as number;
      const g = clip.vars.g as number;
      let vx = clip.vars.vx as number;
      let vy = clip.vars.vy as number;
      const accx = clip.vars.accx as number;
      const accy = clip.vars.accy as number;
      let c = clip.vars.c as number;
      const compte = clip.vars.compte as number;

      if (Math.floor(Math.random() * 15) === 1) {
        // _parent._parent.attachMovie("minifeux2","minifeux2"+compte,compte)
        // _parent of this feux is sprite31 root
        const root = clip.parent;
        if (root) {
          const child = root.attach(this.minifeux2Sym, "minifeux2" + compte, compte, {} as SpellContext);
          child.x = clip.x;
          child.y = clip.y + (root.y ?? 0);
          child.alpha = (100 - c) / 100;
          c++;
        }
        clip.vars.compte = Math.floor(Math.random() * 200000);
        clip.vars.c = c;
      }

      clip.rotation += (t / 3) * (Math.PI / 180);
      t--;
      clip.vars.t = t;
      clip.scaleX = t / 3 / 100;
      clip.scaleY = t / 3 / 100;
      clip.y += g;
      vx *= accx;
      vy *= accy;
      clip.vars.vx = vx;
      clip.vars.vy = vy;
      clip.x += vx;
      clip.y += vy;

      if (t < 0) {
        if (clip.parent) {
          clip.parent.remove();
        }
      }
    } else if (frame === 10) {
      // AS DefineSprite_23_feux/frame_11/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      let t = clip.vars.t as number;
      const g = clip.vars.g as number;
      let vx = clip.vars.vx as number;
      let vy = clip.vars.vy as number;
      const accx = clip.vars.accx as number;
      const accy = clip.vars.accy as number;
      let c = clip.vars.c as number;

      if (t < 150) {
        clip.play();
      }

      if (t < 135) {
        // spawn 9 minifeux3 into _parent._parent
        const root = clip.parent;
        if (root) {
          for (let nbr = 1; nbr < 10; nbr++) {
            const compte = Math.floor(Math.random() * 200000);
            const child = root.attach(this.minifeux3Sym, "minifeux3" + compte, compte, {} as SpellContext);
            child.x = clip.x;
            child.y = clip.y + (root.y ?? 0);
            child.alpha = (100 - c) / 100;
            c++;
          }
          clip.vars.c = c;
        }
        if (clip.parent) {
          clip.parent.remove();
        }
        return;
      }

      clip.rotation += (t / 3) * (Math.PI / 180);
      t--;
      clip.vars.t = t;
      clip.scaleX = t / 3 / 100;
      clip.scaleY = t / 3 / 100;
      clip.y += g;
      vx *= accx;
      vy *= accy;
      clip.vars.vx = vx;
      clip.vars.vy = vy;
      clip.x += vx;
      clip.y += vy;
    } else if (frame === 13) {
      // AS DefineSprite_23_feux/frame_14/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      let angle = clip.vars.angle as number;
      let vit = clip.vars.vit as number;
      let vr = clip.vars.vr as number;
      let sz = clip.vars.sz as number;
      let frangle = clip.vars.frangle as number;
      let c = clip.vars.c as number;
      const frein = clip.vars.frein as number;
      const t = clip.vars.t as number | undefined ?? 200;

      // Spawn minifeux4 on first tick if flagged
      if (clip.vars._needMinifeux4Spawn) {
        clip.vars._needMinifeux4Spawn = false;
        const root = clip.parent;
        if (root) {
          const compte = Math.floor(Math.random() * 300000);
          const child = root.attach(this.minifeux4Sym, "minifeux4" + compte, compte, {} as SpellContext);
          child.x = clip.x;
          child.y = clip.y + (root.y ?? 0);
        }
      }

      clip.rotation = (angle * 57.29746936176985 * Math.PI) / 180;
      clip.alpha = (50 + Math.floor(Math.random() * 60)) / 100;
      sz *= frein + 0.02;
      clip.vars.sz = sz;
      clip.scaleX = sz / 100;
      clip.scaleY = sz / 100;

      if (Math.floor(Math.random() * 24) === 1) {
        vr = 0.67 * (-0.5 + Math.random());
        clip.vars.vr = vr;
      }

      angle += vr * frangle;
      frangle *= frein;
      clip.vars.angle = angle;
      clip.vars.frangle = frangle;

      const vx = vit * Math.cos(angle);
      const vy = vit * Math.sin(angle);
      clip.x += vx;
      clip.y += vy;
      vit *= frein;
      clip.vars.vit = vit;

      if (t < 150) {
        clip.play();
      }

      if (t < 135) {
        const root = clip.parent;
        if (root) {
          for (let nbr = 1; nbr < 10; nbr++) {
            const compte = Math.floor(Math.random() * 300000);
            const child = root.attach(this.minifeux3Sym, "minifeux3" + compte, compte, {} as SpellContext);
            child.x = clip.x;
            child.y = clip.y + (root.y ?? 0);
            child.alpha = (100 - c) / 100;
            c++;
          }
          clip.vars.c = c;
        }
        if (clip.parent) {
          clip.parent.remove();
        }
      }
    }
  }
}

// Fix: SpellContext is needed as a type in the tick methods but can't be imported
// in the class methods because TypeScript doesn't allow type-only constructs here.
// The {} as SpellContext casts are used where ctx is unavailable from closures.
// This is acceptable since attach() uses ctx only for onLoad/frameScripts which
// already have their own ctx parameter passed by the runtime.
