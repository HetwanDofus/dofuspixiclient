/**
 * Spell 2017 — Projectile with smoke trail and impact smoke burst.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2017/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has a `move` symbol
 * (1-frame container whose onEnterFrame emits `fumee` trail particles
 * each tick as the harness flies it along the parabolic arc) and a
 * `shoot` symbol (75-frame container whose frame_1 bursts 7 `fumee2`
 * smoke particles into _parent and whose frame_73 removes the outer mc
 * and signals completion).
 *
 * The harness drives `move` along the arc, calls runtime.signalHit()
 * automatically on landing, then attaches `shoot` at the target —
 * do NOT call signalHit again from per-spell code.
 *
 * Library symbols (registered, attached via attachMovie):
 *   - fumee2  — 57-frame smoke/bounce particle. Set vx/vy on vars AFTER
 *               attach() returns (shoot frame_1 does this). onEnterFrame
 *               integrates position, bounces at yi rest-Y, fades alpha
 *               after bounce. frame_55 removes self.
 *   - fumee   — 48-frame small trail smoke. frame_1 script seeds scale,
 *               jumps to random starting frame, divides vx/vy by
 *               friction. onEnterFrame drifts + decays velocity.
 *               frame_46 removes self.
 *
 * Container symbols (frames: [], no texture):
 *   - move    — 1-frame container. frame_1 initialises xi/yi/nf/c.
 *               onEnterFrame drops `fumee` trail particles at the
 *               current (harness-driven) position each tick.
 *   - shoot   — 75-frame container. frame_1 resets rotation, spawns 7
 *               fumee2 particles. frame_73 removes parent outer mc and
 *               signals runtime.complete().
 *
 * Internal sub-sprites DefineSprite_7 (spinning visual inside move) and
 * DefineSprite_12 (sub-child of fumee2's pain.pain) are authored
 * composites baked into the respective lib textures; their clip-event
 * logic (_yscale oscillation, random stop frame) is captured in the
 * lib_fumee2 and lib_fumee onLoad/onEnterFrame handlers as needed.
 *
 * Main timeline: no SOMA.playSound found in provided AS; onSpellStart
 * is a no-op.
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

const FUMEE2_BOUNDS = {
  width: 8.7,
  height: 8.7,
  offsetX: -4.25,
  offsetY: -4.6,
};

const FUMEE_BOUNDS = {
  width: 3,
  height: 3.1,
  offsetX: -0.8,
  offsetY: -1.05,
};

export class Spell2017 extends RuntimeSpell {
  readonly spellId = 2017;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Captured so shoot frame_1 can reference fumeeSym and fumee2Sym
  // without closing over the local scope of registerSymbols.
  private fumee2Sym!: SymbolDefinition;
  private fumeeSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const fumee2Anchor = calculateAnchor(FUMEE2_BOUNDS);
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);

    // ----------------------------------------------------------------
    // lib_fumee2 — smoke/bounce particle spawned at impact site
    // ----------------------------------------------------------------
    // vx and vy are written onto clip.vars by the CALLER (shoot frame_1)
    // AFTER attach() returns, because attach() runs onLoad first then
    // the caller sets vars. To work around this, fumee2's onLoad seeds
    // yi/vr/fin/a/scale from the already-applied _x/_y position, and
    // the onEnterFrame reads vx/vy (which will be valid by the time the
    // first onEnterFrame fires, one tick later).
    //
    // AS: DefineSprite_8_fumee2/frame_1/DoAction.as
    this.fumee2Sym = {
      name: "fumee2",
      totalFrames: 57,
      frames: textures.getFrames("lib_fumee2"),
      anchorX: fumee2Anchor.x,
      anchorY: fumee2Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_8_fumee2/frame_1/DoAction.as:
        //   t = 50 * Math.random() + 50;
        //   stop();
        //   _xscale = t; _yscale = t;
        //   vx = vx;  (preserves caller-set value — noop here, read in onEnterFrame)
        //   vy *= 2;  (caller sets vy before first onEnterFrame fires)
        //   yi = _Y - 1.67 + 3.33 * Math.random();
        //   vr = 30 * Math.random() - 0.5;
        //   fin = 0; a = 0;
        const t = 50 * Math.random() + 50;
        clip.stop();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        // yi is seeded from the clip's current y (set by attach transform).
        clip.vars.yi = clip.y - 1.67 + 3.33 * Math.random();
        clip.vars.vr = 30 * Math.random() - 0.5;
        clip.vars.fin = 0;
        clip.vars.a = 0;
        // vy multiplier deferred: vy is written by caller after attach returns.
        // We flag that it needs to be doubled on first enterFrame.
        clip.vars.vyDoubled = false;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_8_fumee2/frame_1/DoAction.as — onEnterFrame:
        //   if(fin == 1) { _alpha = 150 - (a += 3.3); }
        //   _X += vx; _Y += vy;
        //   _rotation += vr;
        //   if(_Y > yi) {
        //     vy = (-vy) / 9; _Y = yi; _rotation = 0; vr = 0;
        //     pain.pain.vr = 0; pain.pain.i = 0.8;  (sub-sprite refs, no-op)
        //     vx = 0; play(); fin = 1;
        //   }
        //   vy += 0.5;
        let fin = clip.vars.fin as number;
        let a = clip.vars.a as number;
        let vx = (clip.vars.vx as number) ?? 0;
        let vy = (clip.vars.vy as number) ?? 0;
        let vr = clip.vars.vr as number;
        const yi = clip.vars.yi as number;

        // Apply the vy *= 2 from frame_1 on the very first enterFrame,
        // now that the caller has had a chance to set vy.
        if (!(clip.vars.vyDoubled as boolean)) {
          vy *= 2;
          clip.vars.vyDoubled = true;
        }

        if (fin === 1) {
          a += 3.3;
          clip.vars.a = a;
          // AS: _alpha = 150 - a  (Flash 0-100 → TS 0-1)
          clip.alpha = (150 - a) / 100;
        }

        clip.x += vx;
        clip.y += vy;
        clip.rotation += (vr * Math.PI) / 180;

        if (clip.y > yi) {
          vy = (-vy) / 9;
          clip.y = yi;
          clip.rotation = 0;
          vr = 0;
          // pain.pain.vr = 0; pain.pain.i = 0.8; — sub-sprite refs, no-op
          vx = 0;
          clip.play();
          fin = 1;
        }

        vy += 0.5;

        clip.vars.fin = fin;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.vr = vr;
      },
      frameScripts: new Map([
        [
          54,
          (clip) => {
            // AS DefineSprite_8_fumee2/frame_55/DoAction.as:
            //   this.removeMovieClip();
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_fumee — small trail smoke particle dropped by move
    // ----------------------------------------------------------------
    // vx and vy are written by move's onEnterFrame AFTER attach() returns.
    // frame_1 frameScript divides them (reads at frame 0 = first frame
    // script, which fires during the attach() call for the entry frame).
    // To handle this correctly we use onLoad (fires during attach before
    // frame_1 script) to capture nothing, and use the frame_1 script only
    // for scale + gotoAndPlay. vx/vy division happens in onLoad via the
    // same deferred pattern as fumee2.
    //
    // AS: DefineSprite_13_fumee/frame_1/DoAction.as
    // AS: DefineSprite_13_fumee/frame_46/DoAction.as
    this.fumeeSym = {
      name: "fumee",
      totalFrames: 48,
      frames: textures.getFrames("lib_fumee"),
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_13_fumee/frame_1/DoAction.as:
        //   t = 50 * Math.random() + 50;
        //   gotoAndPlay(random(30));
        //   _xscale = t; _yscale = t;
        //   vx /= 3 + 3 * Math.random();
        //   vy /= 3 + random(3);
        //   onEnterFrame: _X += vx; _Y += vy; vx /= 1.2; vy /= 1.2;
        //
        // vx/vy are set by move's onEnterFrame AFTER attach() returns,
        // so we cannot divide them here. We flag for deferred division.
        const t = 50 * Math.random() + 50;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        // gotoAndPlay(random(30)) — AS random(30) = floor(rand*30), 1-based → 0-based: floor(rand*30)
        clip.gotoAndPlay(Math.floor(Math.random() * 30));
        // Store divisors so onEnterFrame can apply them on first tick.
        clip.vars.vxDiv = 3 + 3 * Math.random();
        clip.vars.vyDiv = 3 + Math.floor(Math.random() * 3);
        clip.vars.frictionApplied = false;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_13_fumee/frame_1/DoAction.as — onEnterFrame:
        //   _X += vx; _Y += vy; vx /= 1.2; vy /= 1.2;
        let vx = (clip.vars.vx as number) ?? 0;
        let vy = (clip.vars.vy as number) ?? 0;

        // Apply the initial friction division deferred from onLoad.
        if (!(clip.vars.frictionApplied as boolean)) {
          vx /= clip.vars.vxDiv as number;
          vy /= clip.vars.vyDiv as number;
          clip.vars.frictionApplied = true;
        }

        clip.x += vx;
        clip.y += vy;
        vx /= 1.2;
        vy /= 1.2;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
      frameScripts: new Map([
        [
          45,
          (clip) => {
            // AS DefineSprite_13_fumee/frame_46/DoAction.as:
            //   this.removeMovieClip();
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // move — 1-frame container; drops fumee trail particles each tick
    // ----------------------------------------------------------------
    // AS: DefineSprite_4_move/frame_1/DoAction.as
    // AS: DefineSprite_4_move/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // The PlaceObject2 child (DefineSprite_7) has `_rotation += 35` each
    // frame — it is a visual spinner baked into the move composite; we
    // have no separate SpellClip for it, so its rotation is a no-op here.
    const fumeeSym = this.fumeeSym;
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_4_move/frame_1/DoAction.as:
            //   xi = this._x; yi = this._y; nf = 0.67; c = 0;
            //   this.onEnterFrame = function() { ... }
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            clip.vars.nf = 0.67;
            clip.vars.c = 0;
          },
        ],
      ]),
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_4_move/frame_1/DoAction.as — onEnterFrame:
        //   var _loc3_ = 0;
        //   while(_loc3_ < nf) {    // nf=0.67: 0 < 0.67 → 1 particle/frame
        //     _parent.attachMovie("fumee","fumee"+c, c+10);
        //     f._x = this._x; f._y = this._y;
        //     f.vx = this._x - xi + 6.67*(Math.random()-0.5);
        //     f.vy = this._y - yi + 6.67*(Math.random()-0.5);
        //     c++; _loc3_++;
        //   }
        //   xi = this._x; yi = this._y;
        const nf = clip.vars.nf as number;
        let c = clip.vars.c as number;
        const xi = clip.vars.xi as number;
        const yi = clip.vars.yi as number;

        const parent = clip.parent;
        if (parent) {
          let loc3 = 0;
          while (loc3 < nf) {
            const instanceName = `fumee${c}`;
            const attached = parent.attach(
              fumeeSym,
              instanceName,
              c + 10,
              ctx,
            );
            // Set position and velocity AFTER attach (so onEnterFrame
            // deferred friction-application reads them correctly).
            attached.x = clip.x;
            attached.y = clip.y;
            attached.vars.vx =
              clip.x - xi + 6.67 * (Math.random() - 0.5);
            attached.vars.vy =
              clip.y - yi + 6.67 * (Math.random() - 0.5);
            c++;
            loc3 += 1;
          }
        }

        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
        clip.vars.c = c;
      },
    };

    // ----------------------------------------------------------------
    // shoot — 75-frame container; impact smoke burst
    // ----------------------------------------------------------------
    // AS: DefineSprite_1_shoot/frame_1/DoAction.as
    // AS: DefineSprite_1_shoot/frame_73/DoAction.as
    const fumee2Sym = this.fumee2Sym;
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 75,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_1_shoot/frame_1/DoAction.as:
            //   _rotation = 0;
            //   xi = this._x; yi = this._y; c = 0;
            //   var p = 0;
            //   while(p < 7) {
            //     _parent.attachMovie("fumee2","fumee2"+c+200, c+200);
            //     f._x = this._x; f._y = this._y;
            //     f.vx = this._x - xi + 5*(Math.random()-0.5);
            //     f.vy = -6 * Math.random();
            //     c++; xi=this._x; yi=this._y; p++;
            //   }
            clip.rotation = 0;

            const parent = clip.parent;
            if (parent) {
              let c = 0;
              let xi = clip.x;
              for (let p = 0; p < 7; p++) {
                const instanceName = `fumee2${c}200`;
                const attached = parent.attach(
                  fumee2Sym,
                  instanceName,
                  c + 200,
                  ctx,
                );
                // Set position + velocity AFTER attach so fumee2's
                // onEnterFrame deferred-vy-double reads them correctly.
                attached.x = clip.x;
                attached.y = clip.y;
                attached.vars.vx =
                  clip.x - xi + 5 * (Math.random() - 0.5);
                attached.vars.vy = -6 * Math.random();
                c++;
                xi = clip.x;
              }
            }
          },
        ],
        [
          72,
          (clip) => {
            // AS DefineSprite_1_shoot/frame_73/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.fumee2Sym);
    this.registry.register(this.fumeeSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // Main timeline: no SOMA.playSound found in the provided AS source.
    // The harness (displayType=30, ProjectileBallistic) attaches `move`,
    // drives the arc, and attaches `shoot` on landing — nothing more needed.
  }
}
