/**
 * Spell 512 — Éboulement (Sadida earth-rock spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/512/scripts/scripts/
 *
 * displayType=11 (TargetCell). The main animated content (sprite_42) positions
 * itself at _parent.cellTo on its own frame_1, and the outer main timeline
 * just stops. No projectile motion, no caster reference for the main clip —
 * it is an impact at target cell.
 *
 * AS layout:
 *   - Main timeline (frame_2/DoAction.as): stop(). One frame of content places
 *     sprite_42 on the stage (implicitly, frame_1).
 *   - sprite_42 (213-frame composite): the main impact animation.
 *       frame_1 (DoAction.as):  SOMA.playSound("licrounch_1008")
 *       frame_1 (DoAction_2.as): _X = _parent.cellTo.x; _Y = _parent.cellTo.y
 *       frame_7: Two authored PlaceObject2 children with clip events:
 *           PlaceObject2_6_7  — a sprite that shakes (random X/Y offset each frame)
 *           PlaceObject2_10_9 — a sprite (sprite_10, 2-frame) that wobbles rotation
 *                               driven by a sine-accumulator, toggling between
 *                               gotoAndStop(1) and gotoAndStop(2).
 *       frame_55 (DoAction.as): SOMA.playSound("many_512b")
 *       frame_61 (DoAction.as): this.end() → signalHit
 *       frame_61: PlaceObject2_35_12 placed with onClipEvent(load) that
 *                 attachMovie("pierres", "pierresN", N) 7 times.
 *       frame_211 (DoAction.as): _parent.removeMovieClip() → complete()
 *
 *   - sprite_27 (93-frame, projectile/debris visual): frame_1 does
 *     gotoAndPlay(random(30)) to randomise start frame.
 *
 *   - lib_pierres (library symbol, 1-frame stone particle):
 *       onClipEvent(load):  seed vx, vy, _parent._x/_y scatter, t, scale,
 *                           alpha, v, vr.
 *       onClipEvent(enterFrame): physics — drift parent X/Y, bounce on Y=0,
 *                                 settle when t==1.
 *
 *   - sprite_10 (2-frame inline visual used by the wobble sprite):
 *     No scripts of its own — just animated frames toggled by sprite_42's
 *     PlaceObject2_10_9 enterFrame handler (gotoAndStop(1) or gotoAndStop(2)).
 *
 * The two PlaceObject2 children in sprite_42/frame_7 are "inline" authored
 * placements baked into the composite sprite_42 SVG frames.  However their
 * CLIPACTIONRECORD handlers (shaking + wobble) are purely runtime and must
 * be reproduced via live SpellClip instances attached at frame 7.
 *
 * The stone-particle "pierres" container (PlaceObject2_35_12 in frame_61) is
 * a wrapper clip with no own handlers — its onClipEvent(load) fires once and
 * attaches 7 lib_pierres children.  We model it as a container SymbolDefinition
 * whose frameScripts[0] spawns the 7 particles.
 *
 * Library symbols:
 *   - lib_pierres — 1-frame stone particle. onLoad seeds physics vars. onEnterFrame
 *                   integrates drift + bounce + settle.
 *
 * Inline authored children of sprite_42 (registered as container symbols):
 *   - shake_sprite  — wobbles X/Y ±2.5px each frame (PlaceObject2_6_7).
 *   - wobble_sprite — sine-driven rotation toggling sprite_10's 2 frames (PlaceObject2_10_9).
 *   - pierres_container — spawns 7 lib_pierres particles on load (PlaceObject2_35_12).
 *
 * Sounds:
 *   - "licrounch_1008" at sprite_42 frame_1.
 *   - "many_512b"      at sprite_42 frame_55.
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

// ---- Manifest bounds --------------------------------------------------------

const PIERRES_BOUNDS = {
  width: 6.4,
  height: 3.85,
  offsetX: -3.2,
  offsetY: -2.2,
};

const SPRITE_27_BOUNDS = {
  width: 64.75,
  height: 46.25,
  offsetX: -29.8,
  offsetY: -43.6,
};

const SPRITE_28_BOUNDS = {
  width: 106.55,
  height: 99.3,
  offsetX: -53.95,
  offsetY: -45.05,
};

const SPRITE_42_BOUNDS = {
  width: 120.6,
  height: 163.35,
  offsetX: -60.4,
  offsetY: -142.55,
};

const SPRITE_10_BOUNDS = {
  width: 33,
  height: 44,
  offsetX: -4.55,
  offsetY: -22.5,
};

export class Spell512 extends RuntimeSpell {
  readonly spellId = 512;
  readonly displayType = SpellDisplayType.TargetCell;

  // Capture sound callback for use in frame scripts
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ---- lib_pierres — stone fragment particle -------------------
    // AS: scripts/DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const pierresSym: SymbolDefinition = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,

      onLoad: (clip) => {
        // AS: DefineSprite_3_pierres / PlaceObject2_2_1 / onClipEvent(load)
        //   vx = 5 * (Math.random() - 0.5)
        //   vy = 2 * (Math.random() - 0.5)
        //   _parent._x = 20 * (Math.random() - 0.5)
        //   _parent._y = 10 * (Math.random() - 0.5)
        //   t = 60 + 40 * Math.random()
        //   _xscale = t; _yscale = t; _alpha = 20 + random(90)
        //   v = -5 * Math.random() - 5
        //   vr = 40 * (-0.5 + Math.random())
        //
        // NOTE: In canonical AS, "this" is the inner sprite and
        // "_parent" is the pierres clip itself.  We model both as the
        // same SpellClip (the particle IS the rendered sprite), so
        // _parent._x / _parent._y map to clip.x / clip.y.
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -5 * Math.random() - 5;
        clip.vars.vr = 40 * (-0.5 + Math.random());
      },

      onEnterFrame: (clip) => {
        // AS: DefineSprite_3_pierres / PlaceObject2_2_1 / onClipEvent(enterFrame)
        //   _parent._x += vx
        //   _parent._y += vy
        //   if(t != 1) {
        //     _Y = _Y + v; _rotation = _rotation + vr; v += 0.5
        //     if(_Y > 0) {
        //       vx /= 2; vy /= 2; _rotation = 0; _Y = 0
        //       v = (-v) / 4
        //       if(Math.abs(v) < 1) { vx = 0; vy = 0; t = 1 }
        //     }
        //   }
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        const t = clip.vars.t as number;

        clip.x += vx;
        clip.y += vy;

        if (t !== 1) {
          // _Y here is the inner sprite's local Y relative to its parent
          // (the pierres clip). We store it in vars.innerY.
          let innerY = (clip.vars.innerY as number | undefined) ?? 0;
          innerY += v;
          clip.rotation += (vr * Math.PI) / 180;
          v += 0.5;

          if (innerY > 0) {
            vx /= 2;
            vy /= 2;
            clip.rotation = 0;
            innerY = 0;
            v = (-v) / 4;
            if (Math.abs(v) < 1) {
              vx = 0;
              vy = 0;
              clip.vars.t = 1;
            }
          }

          clip.vars.innerY = innerY;
          clip.vars.v = v;
          clip.vars.vr = vr;
          clip.vars.vx = vx;
          clip.vars.vy = vy;
        }
      },
    };

    // ---- pierres_container — wrapper placed at sprite_42 frame_61 ----
    // AS: DefineSprite_42/frame_61/PlaceObject2_35_12/CLIPACTIONRECORD onClipEvent(load)
    //   c = 0; while (c < 7) { this.attachMovie("pierres","pierres"+c,c); c++ }
    // This wrapper has no authored visual frames of its own.
    const pierresContainerSym: SymbolDefinition = {
      name: "pierres_container",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      onLoad: (clip, ctx) => {
        // AS: DefineSprite_42/frame_61/PlaceObject2_35_12/onClipEvent(load)
        for (let c = 0; c < 7; c++) {
          clip.attach(pierresSym, `pierres${c}`, c, ctx);
        }
      },
    };

    // ---- sprite_10 — 2-frame wobble visual (toggled by wobble_sprite) ----
    // No own scripts. Registered so wobble_sprite can gotoAndStop its frames.
    const sprite10Anchor = calculateAnchor(SPRITE_10_BOUNDS);
    const sprite10Sym: SymbolDefinition = {
      name: "sprite_10",
      totalFrames: 2,
      frames: textures.getFrames("sprite_10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
    };

    // ---- shake_sprite — shakes position ±2.5px each frame ---------------
    // AS: DefineSprite_42/frame_7/PlaceObject2_6_7/CLIPACTIONRECORD onClipEvent(load)
    //   y = _Y
    // AS: DefineSprite_42/frame_7/PlaceObject2_6_7/CLIPACTIONRECORD onClipEvent(enterFrame)
    //   _X = (Math.random() - 0.5) * 5
    //   _Y = (Math.random() - 0.5) * 5 + y
    // This is an inline authored placement baked into sprite_42's composite SVG
    // visually, but its per-frame behavior must be driven live.
    const shakeSpriteSym: SymbolDefinition = {
      name: "shake_sprite",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      onLoad: (clip) => {
        // AS: DefineSprite_42/frame_7/PlaceObject2_6_7/onClipEvent(load)
        //   y = _Y
        clip.vars.baseY = clip.y;
      },

      onEnterFrame: (clip) => {
        // AS: DefineSprite_42/frame_7/PlaceObject2_6_7/onClipEvent(enterFrame)
        //   _X = (Math.random() - 0.5) * 5
        //   _Y = (Math.random() - 0.5) * 5 + y
        const baseY = clip.vars.baseY as number;
        clip.x = (Math.random() - 0.5) * 5;
        clip.y = (Math.random() - 0.5) * 5 + baseY;
      },
    };

    // ---- wobble_sprite — sine-driven rotation, toggles sprite_10 frames ---
    // AS: DefineSprite_42/frame_7/PlaceObject2_10_9/CLIPACTIONRECORD onClipEvent(load)
    //   i = 0
    // AS: DefineSprite_42/frame_7/PlaceObject2_10_9/CLIPACTIONRECORD onClipEvent(enterFrame)
    //   _rotation = _rotation + vr
    //   vr = 46.6 * Math.sin(i += Math.random())
    //   if(Math.abs(vr) > 100) { gotoAndStop(2) } else { gotoAndStop(1) }
    // The wobble_sprite itself is a container that holds a sprite_10 instance.
    // In canonical AS the PlaceObject2_10_9 is a sprite that authors placed
    // with a sub-sprite. We model it as a container with sprite_10 as a child.
    const wobbleSpriteSym: SymbolDefinition = {
      name: "wobble_sprite",
      totalFrames: 2,
      frames: textures.getFrames("sprite_10"),
      anchorX: calculateAnchor(SPRITE_10_BOUNDS).x,
      anchorY: calculateAnchor(SPRITE_10_BOUNDS).y,

      onLoad: (clip) => {
        // AS: DefineSprite_42/frame_7/PlaceObject2_10_9/onClipEvent(load)
        //   i = 0
        clip.vars.i = 0;
        clip.vars.vr = 0;
      },

      onEnterFrame: (clip) => {
        // AS: DefineSprite_42/frame_7/PlaceObject2_10_9/onClipEvent(enterFrame)
        //   _rotation = _rotation + vr
        //   vr = 46.6 * Math.sin(i += Math.random())
        //   if(Math.abs(vr) > 100) { gotoAndStop(2) } else { gotoAndStop(1) }
        let vr = clip.vars.vr as number;
        let i = clip.vars.i as number;

        clip.rotation += (vr * Math.PI) / 180;
        i += Math.random();
        vr = 46.6 * Math.sin(i);

        if (Math.abs(vr) > 100) {
          clip.gotoAndStop(1); // AS gotoAndStop(2) → 0-based index 1
        } else {
          clip.gotoAndStop(0); // AS gotoAndStop(1) → 0-based index 0
        }

        clip.vars.vr = vr;
        clip.vars.i = i;
      },
    };

    // ---- sprite_27 — debris/dust visual (93 frames, randomised start) -----
    // AS: DefineSprite_27/frame_1/DoAction.as: gotoAndPlay(random(30))
    const sprite27Anchor = calculateAnchor(SPRITE_27_BOUNDS);
    const sprite27Sym: SymbolDefinition = {
      name: "sprite_27",
      totalFrames: 93,
      frames: textures.getFrames("sprite_27"),
      anchorX: sprite27Anchor.x,
      anchorY: sprite27Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_27/frame_1/DoAction.as
            //   gotoAndPlay(random(30))
            clip.gotoAndPlay(Math.floor(Math.random() * 30));
          },
        ],
      ]),
    };

    // ---- sprite_28 — secondary impact visual (81 frames, no scripts) ------
    const sprite28Anchor = calculateAnchor(SPRITE_28_BOUNDS);
    const sprite28Sym: SymbolDefinition = {
      name: "sprite_28",
      totalFrames: 81,
      frames: textures.getFrames("sprite_28"),
      anchorX: sprite28Anchor.x,
      anchorY: sprite28Anchor.y,
    };

    // ---- sprite_42 — main 213-frame impact timeline ----------------------
    // frame_1  DoAction.as:   SOMA.playSound("licrounch_1008")
    // frame_1  DoAction_2.as: _X = _parent.cellTo.x; _Y = _parent.cellTo.y
    // frame_7  places shake_sprite and wobble_sprite (both with clip events)
    // frame_55 DoAction.as:   SOMA.playSound("many_512b")
    // frame_61 DoAction.as:   this.end() → signalHit
    //          PlaceObject2_35_12 placed → pierres_container onLoad spawns 7 pierres
    // frame_211 DoAction.as:  _parent.removeMovieClip() → complete()
    const sprite42Anchor = calculateAnchor(SPRITE_42_BOUNDS);
    const sprite42Sym: SymbolDefinition = {
      name: "sprite_42",
      totalFrames: 213,
      frames: textures.getFrames("sprite_42"),
      anchorX: sprite42Anchor.x,
      anchorY: sprite42Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_42/frame_1/DoAction.as
            //   SOMA.playSound("licrounch_1008")
            this.soundCallback?.("licrounch_1008");

            // AS: DefineSprite_42/frame_1/DoAction_2.as
            //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y
            // For displayType=11 (TargetCell), the harness anchors the
            // container at cellTo. sprite_42 is a direct child of root,
            // so here _parent is root. We read cellTo from root.vars.
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
          6,
          (clip, ctx) => {
            // AS: DefineSprite_42/frame_7 places:
            //   PlaceObject2_6_7  → shake_sprite (clip events: load seeds baseY,
            //                        enterFrame randomises X/Y)
            //   PlaceObject2_10_9 → wobble_sprite (clip events: load seeds i=0,
            //                        enterFrame sine rotation + frame toggle)
            clip.attach(shakeSpriteSym, "shake_sprite", 7, ctx);
            clip.attach(wobbleSpriteSym, "wobble_sprite", 9, ctx);
          },
        ],
        [
          54,
          (_clip) => {
            // AS: DefineSprite_42/frame_55/DoAction.as
            //   SOMA.playSound("many_512b")
            this.soundCallback?.("many_512b");
          },
        ],
        [
          60,
          (clip, ctx) => {
            // AS: DefineSprite_42/frame_61/DoAction.as
            //   this.end() → signal hit (damage popup)
            this.runtime.signalHit();

            // AS: DefineSprite_42/frame_61 also places PlaceObject2_35_12
            //   (the pierres_container) whose onClipEvent(load) spawns 7 pierres.
            clip.attach(pierresContainerSym, "pierres_container", 12, ctx);
          },
        ],
        [
          210,
          (clip) => {
            // AS: DefineSprite_42/frame_211/DoAction.as
            //   _parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(pierresSym);
    this.registry.register(pierresContainerSym);
    this.registry.register(sprite10Sym);
    this.registry.register(shakeSpriteSym);
    this.registry.register(wobbleSpriteSym);
    this.registry.register(sprite27Sym);
    this.registry.register(sprite28Sym);
    this.registry.register(sprite42Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use inside frame scripts
    this.soundCallback = callbacks.playSound;

    // The main timeline has 2 frames; frame_2/DoAction.as is just stop().
    // Frame_1 implicitly places sprite_42 on the stage. We attach it here
    // so it begins ticking from the first runtime frame.
    // sprite_42's own frame_1 script positions it at cellTo and plays sound.
    const sprite42Sym = this.registry.resolve("sprite_42");
    if (sprite42Sym) {
      this.root.attach(sprite42Sym, "sprite42", 1, context);
    }
  }
}
