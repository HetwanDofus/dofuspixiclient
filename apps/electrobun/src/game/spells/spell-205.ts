/**
 * Spell 205 — Craquelure (Feca / Sadida-like crockett spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/205/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main timeline places a single
 * sprite_22 clip (DefineSprite_22) which positions itself at cellFrom in
 * its frame_1 script and moves toward cellTo under an acceleration /
 * friction model. sprite_22 reads `_parent.cellFrom` and `_parent.cellTo`
 * directly, so the container must be at world origin (0,0) — this is the
 * classic WorldAbsolute pattern.
 *
 * Library symbols (librarySymbols[] — both are clipEvent/directlyDynamic):
 *
 *   - sprite15 (DefineSprite_15): the "crockette" body — placed inside
 *     sprite_22 at frame_1 (depth 2, with initial scale/translate matrix).
 *     Has frame_1/DoAction.as that reads `corpsx`/`tetex` and drives a
 *     sinusoidal waggle loop via `onEnterFrame`. Its placed child `tete`
 *     (sprite14) is also driven. Additionally places a `PlaceObject2_6_9`
 *     (swapDepths) and `PlaceObject2_9_12` (swapDepths) clip-event instance
 *     whose handlers call swapDepths — we approximate these as no-ops since
 *     the SpellClip runtime uses zIndex/depth directly.
 *     onLoad: seeds `an`, `t`, `pm`, `ym` locals.
 *     onEnterFrame: oscillates `an`, bobs `_Y`, rotates.
 *
 *   - sprite14 (DefineSprite_14): the "head" placed INSIDE sprite15 at
 *     depth 14. Its single placed child (PlaceObject2_13_4) has an
 *     onClipEvent(enterFrame) that drives `_X = 7*cos(an)` and
 *     `_xscale = 100*sin(an)`, toggling visibility — canonical 3D-rotation
 *     illusion on the head. `an` is read from `_parent._parent.an`
 *     (= sprite15.vars.an).
 *
 * sprite_22 timeline key frames:
 *   frame_1  (index 0): stop, init vars, set position to cellFrom, start
 *                        onEnterFrame acceleration loop toward cellTo.
 *   frame_4  (index 3): gotoAndPlay(4) is the "landing approach" jump point
 *                        (from tps==90 in onEnterFrame; frott=0.4, acc=1).
 *   frame_37 (index 36): acc = 0.25.
 *   frame_67 (index 66): playSound("pose"); set fin=1, snap to cellTo → signalHit.
 *   frame_70 (index 69): this.end() → signalHit already done; places a
 *                         sprite_18 instance (impact wobble, PlaceObject2_21_1)
 *                         with its own onLoad/onEnterFrame.
 *   frame_121 (index 120): _parent.removeMovieClip() + stop → complete().
 *
 * sprite_18 (DefineSprite_18): 15-frame impact ring, stops at frame_13 (index 12).
 *   PlaceObject2_21_1 has onClipEvent(load): i=0, amp=30.
 *   onClipEvent(enterFrame): _rotation = (amp *= 0.8) * cos(i += PI).
 *
 * Main timeline (frame_2/DoAction.as): SOMA.playSound("crockette_205"); stop().
 *
 * Sounds manifest:
 *   frame 1 (index 0) → "crockette_205" (main timeline frame_2, fired at start)
 *   frame 66          → "pose" (sprite_22 frame_67)
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

// ── Manifest bounds ──────────────────────────────────────────────────────────

const SPRITE14_BOUNDS = {
  width: 16.6,
  height: 33.2,
  offsetX: -8.3,
  offsetY: -2.45,
};

const SPRITE15_BOUNDS = {
  width: 48.25,
  height: 65.45,
  offsetX: -24.65,
  offsetY: -27.15,
};

const SPRITE18_BOUNDS = {
  // sprite_18 animation entry
  width: 67.8,
  height: 67.8,
  offsetX: -33.3,
  offsetY: -36.35,
};

const SPRITE22_BOUNDS = {
  // sprite_22 animation entry
  width: 69.2,
  height: 175.9,
  offsetX: -33.3,
  offsetY: -172.3,
};

// ─────────────────────────────────────────────────────────────────────────────

export class Spell205 extends RuntimeSpell {
  readonly spellId = 205;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  // Symbols stored as fields so onSpellStart can attach them.
  private sprite14Sym!: SymbolDefinition;
  private sprite15Sym!: SymbolDefinition;
  private sprite18Sym!: SymbolDefinition;
  private sprite22Sym!: SymbolDefinition;

  // Capture callbacks so frame scripts can play sounds.
  private _callbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite14Anchor = calculateAnchor(SPRITE14_BOUNDS);
    const sprite15Anchor = calculateAnchor(SPRITE15_BOUNDS);
    const sprite18Anchor = calculateAnchor(SPRITE18_BOUNDS);
    const sprite22Anchor = calculateAnchor(SPRITE22_BOUNDS);

    // ── sprite14 (DefineSprite_14) — the crockette "head" ─────────────────
    // Placed inside sprite15 at depth 14. Its child PlaceObject2_13_4 has
    // a clipEvent(enterFrame) that drives X position + xscale to simulate
    // a 3-D rotation illusion, toggling visibility when scale goes negative.
    //
    // AS DefineSprite_14/frame_1/PlaceObject2_13_4/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _X = 7 * Math.cos(_parent._parent.an);
    //   _xscale = 100 * Math.sin(_parent._parent.an);
    //   if (_xscale < 0) { _visible = false; } else { _visible = true; }
    //
    // `_parent` inside that clip is sprite14; `_parent._parent` is sprite15.
    // We model this by giving sprite14 an onEnterFrame that reads
    // sprite15's `an` from its parent's vars.
    this.sprite14Sym = {
      name: "sprite14",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_14/frame_1/PlaceObject2_13_4/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // `_parent._parent.an` — clip's parent is sprite15 which holds `an`.
        const sprite15Clip = clip.parent;
        const an = (sprite15Clip?.vars.an as number) ?? 0;
        clip.x = 7 * Math.cos(an);
        const xscaleFlash = 100 * Math.sin(an);
        clip.scaleX = xscaleFlash / 100;
        if (xscaleFlash < 0) {
          clip.visible = false;
        } else {
          clip.visible = true;
        }
      },
    };

    // ── sprite15 (DefineSprite_15) — the crockette body ───────────────────
    // Placed inside sprite_22 at frame_1 (depth 2).
    // Initial matrix: scaleX=scaleY=0.3389…, translateX=2.5, translateY=-75.15
    //
    // frame_1/DoAction.as seeds corpsx / tetex / dpate from the authored
    // initial _x of child "corps" and "tete". Since we attach sprite14 as
    // "tete" at its authored position (translateX=15.3, translateY=1.1 from
    // the placement matrix in librarySymbols), corpsx ≈ 0 (corps is at x=0)
    // and tetex ≈ 15.3 (tete._x in the authored SWF).
    //
    // onLoad (PlaceObject2_15_2/CLIPACTIONRECORD onClipEvent(load).as):
    //   an=0; t=0; pm=0; ym=_Y
    //
    // onEnterFrame (PlaceObject2_15_2/CLIPACTIONRECORD onClipEvent(enterFrame).as):
    //   an = 0.3 * sin(t += 0.4) + _parent.anglepos + PI
    //   _Y  = ym + 10 * cos(pm += 0.1)
    //   _rotation = 3.34 * sin(t * 1.2)   [degrees → radians in TS]
    //
    // frame_1/DoAction.as:
    //   corpsx = corps._x;  (corps is the authored body at _x≈0)
    //   tetex  = tete._x;   (tete is sprite14 at _x≈15.3)
    //   dpate  = 10;
    //   onEnterFrame: moves corps/tete/p1..p4 in sinusoidal waggle.
    //
    // Since we don't have authored child sprites for "corps" and "p1..p4"
    // (they're SVG-baked into lib_sprite15_0.svg), we only animate the
    // live "tete" (sprite14) child. corpsx and tetex are stored so the
    // waggle math still drives tete._x correctly.
    this.sprite15Sym = {
      name: "sprite15",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_22/frame_1/PlaceObject2_15_2/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.an = 0;
        clip.vars.t = 0;
        clip.vars.pm = 0;
        clip.vars.ym = clip.y; // _Y at load time (set by parent frame script)
        // seed corpsx and tetex for the waggle onEnterFrame
        // tetex ≈ 15.3 (canonical placement translateX of tete inside sprite15)
        clip.vars.corpsx = 0;
        clip.vars.tetex = 15.3;
        clip.vars.dpate = 10;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_22/frame_1/PlaceObject2_15_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let t = clip.vars.t as number;
        let pm = clip.vars.pm as number;
        const ym = clip.vars.ym as number;

        // an = 0.3 * sin(t += 0.4) + _parent.anglepos + PI
        t += 0.4;
        const anglepos = (clip.parent?.vars.anglepos as number) ?? 0;
        const an = 0.3 * Math.sin(t) + anglepos + Math.PI;
        clip.vars.an = an;
        clip.vars.t = t;

        // _Y = ym + 10 * cos(pm += 0.1)
        pm += 0.1;
        clip.vars.pm = pm;
        clip.y = ym + 10 * Math.cos(pm);

        // _rotation = 3.34 * sin(t * 1.2)  [AS degrees → TS radians]
        clip.rotation = (3.34 * Math.sin(t * 1.2) * Math.PI) / 180;

        // AS DefineSprite_15/frame_1/DoAction.as waggle for tete child:
        //   tete._x = tetex * cos(an)
        //   tete._y = tetex / 2 * sin(an)
        const tetex = clip.vars.tetex as number;
        const teteClip = clip.children.get("tete");
        if (teteClip) {
          teteClip.x = tetex * Math.cos(an);
          teteClip.y = (tetex / 2) * Math.sin(an);
        }
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_15/frame_1/DoAction.as
            // Attach the "tete" (sprite14) child at its canonical placement.
            // Placement matrix from librarySymbols[0] (sprite14):
            //   translateX=15.3, translateY=1.1, scaleX=scaleY=1
            clip.attach(this.sprite14Sym, "tete", 14, ctx, {
              x: 15.3,
              y: 1.1,
            });
          },
        ],
      ]),
    };

    // ── sprite_18 (DefineSprite_18) — impact wobble ring ──────────────────
    // 15-frame composite animation. frame_13/DoAction.as: stop().
    // Placed by sprite_22 at frame_70 (PlaceObject2_21_1).
    //
    // PlaceObject2_21_1 onClipEvent(load):
    //   i = 0; amp = 30;
    // PlaceObject2_21_1 onClipEvent(enterFrame):
    //   _rotation = (amp *= 0.8) * Math.cos(i += PI);  [degrees → radians in TS]
    this.sprite18Sym = {
      name: "sprite_18",
      totalFrames: 15,
      frames: textures.getFrames("sprite_18"),
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_22/frame_70/PlaceObject2_21_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.i = 0;
        clip.vars.amp = 30;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_22/frame_70/PlaceObject2_21_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let i = clip.vars.i as number;
        let amp = clip.vars.amp as number;
        amp *= 0.8;
        i += Math.PI;
        // AS rotation in degrees → TS radians
        clip.rotation = (amp * Math.cos(i) * Math.PI) / 180;
        clip.vars.i = i;
        clip.vars.amp = amp;
      },
      frameScripts: new Map([
        [
          12,
          (clip) => {
            // AS DefineSprite_18/frame_13/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ── sprite_22 (DefineSprite_22) — main crockette timeline ────────────
    // 123 frames. Container-style: no frames[] since the authored content
    // is captured in the composite SVGs but motion is script-driven.
    // Uses textures.getFrames("sprite_22") for the authored drawn frames.
    //
    // Key frame scripts:
    //   frame_1  (index 0): init vars, stop, set position, start onEnterFrame loop
    //   frame_37 (index 36): acc = 0.25
    //   frame_67 (index 66): SOMA.playSound("pose"); fin=1; snap to cellTo → signalHit
    //   frame_70 (index 69): this.end() (already hit); attach sprite_18 impact
    //   frame_121 (index 120): _parent.removeMovieClip() → complete()
    this.sprite22Sym = {
      name: "sprite_22",
      totalFrames: 123,
      frames: textures.getFrames("sprite_22"),
      anchorX: sprite22Anchor.x,
      anchorY: sprite22Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_22/frame_1/DoAction.as
            clip.stop();
            clip.vars.tps = 0;
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            const x1 = cellFrom?.x ?? 0;
            const y1 = cellFrom?.y ?? 0;
            const x2 = cellTo?.x ?? 0;
            const y2 = cellTo?.y ?? 0;
            clip.vars.x1 = x1;
            clip.vars.y1 = y1;
            clip.vars.x2 = x2;
            clip.vars.y2 = y2;
            clip.x = x1;
            clip.y = y1;
            clip.vars.acc = 0.17;
            clip.vars.frott = 0.96;
            // random(10) - 5 → [-5, 4]
            clip.vars.vx = Math.floor(Math.random() * 10) - 5;
            clip.vars.vy = Math.floor(Math.random() * 10) - 5;
            clip.vars.fin = 0;
            clip.vars.anglepos = 0;

            // Attach sprite15 (the crockette body) per its placement:
            // parentSpriteId=22, frame=0, depth=2
            // matrix: scaleX=0.3390, scaleY=0.3390, translateX=2.5, translateY=-75.15
            const s15 = clip.attach(this.sprite15Sym, "crockette", 2, ctx, {
              x: 2.5,
              y: -75.15,
            });
            s15.scaleX = 0.3389739990234375;
            s15.scaleY = 0.3389739990234375;
            // Seed ym correctly now that y is set
            s15.vars.ym = s15.y;

            // Per-frame movement loop (canonical onEnterFrame defined inline
            // in DoAction.as via `this.onEnterFrame = function(){...}`)
            clip.onEnterFrame = (c) => {
              // AS DefineSprite_22/frame_1/DoAction.as onEnterFrame body
              const fin = c.vars.fin as number;
              if (fin !== 1) {
                let vx = c.vars.vx as number;
                let vy = c.vars.vy as number;
                let acc = c.vars.acc as number;
                const frott = c.vars.frott as number;
                const x2v = c.vars.x2 as number;
                const y2v = c.vars.y2 as number;

                if (c.x < x2v) {
                  vx += acc;
                } else {
                  vx -= acc;
                }
                vx *= frott;
                c.x = c.x + vx;
                c.vars.vx = vx;

                if (c.y < y2v) {
                  vy += acc;
                } else {
                  vy -= acc;
                }
                vy *= frott;
                c.y = c.y + vy;
                c.vars.vy = vy;

                // anglepos used by sprite15's onEnterFrame
                const anglepos = Math.atan2(c.y - y2v, c.x - x2v);
                c.vars.anglepos = anglepos;

                let tps = c.vars.tps as number;
                tps++;
                c.vars.tps = tps;
                if (tps === 90) {
                  // AS: gotoAndPlay(4) → index 3
                  c.gotoAndPlay(3);
                  c.vars.frott = 0.4;
                  c.vars.acc = 1;
                }
              }
            };
          },
        ],
        [
          36,
          (clip) => {
            // AS DefineSprite_22/frame_37/DoAction.as
            clip.vars.acc = 0.25;
          },
        ],
        [
          66,
          (clip) => {
            // AS DefineSprite_22/frame_67/DoAction.as: SOMA.playSound("pose")
            // AS DefineSprite_22/frame_67/DoAction_2.as: fin=1; _X=x2; _Y=y2
            this._callbacks?.playSound("pose");
            clip.vars.fin = 1;
            clip.x = clip.vars.x2 as number;
            clip.y = clip.vars.y2 as number;
            // Hit signals that the crockette has landed
            this.runtime.signalHit();
          },
        ],
        [
          69,
          (clip, ctx) => {
            // AS DefineSprite_22/frame_70/DoAction.as: this.end()
            // In canonical AS, `end()` was the spell's completion-signal method;
            // here signalHit was already called at frame_67, so we just
            // attach the impact sprite_18 (PlaceObject2_21_1 at this frame).
            clip.attach(this.sprite18Sym, "impact", 1, ctx);
          },
        ],
        [
          120,
          (clip) => {
            // AS DefineSprite_22/frame_121/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite14Sym);
    this.registry.register(this.sprite15Sym);
    this.registry.register(this.sprite18Sym);
    this.registry.register(this.sprite22Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_2/DoAction.as: SOMA.playSound("crockette_205"); stop();
    this._callbacks = callbacks;
    callbacks.playSound("crockette_205");

    // Attach sprite_22 as the main crockette clip at world origin (root).
    // For WorldAbsolute the container is at (0,0); sprite_22 sets its own
    // world position to cellFrom in its frame_1 script.
    this.root.attach(this.sprite22Sym, "sprite22", 1, context);
  }
}
