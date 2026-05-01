/**
 * Spell 2017 — Projectile with smoke trail and impact particles.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2017/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). Reasoning:
 *   - Has both `move` (DefineSprite_4_move) and `shoot` (DefineSprite_1_shoot) symbols.
 *   - `move` frame_1 spawns fumee trail particles on its parent per tick via onEnterFrame.
 *   - `shoot` frame_1 resets rotation, spawns 7 fumee2 impact particles; frame_73 removes
 *     parent and completes the spell.
 *   - The harness drives the parabolic arc, attaches move, then attaches shoot at impact
 *     and fires signalHit automatically.
 *
 * Library symbols (from manifest.librarySymbols):
 *   - fumee2  (characterId=8)  — 57-frame smoke bounce particle. frame_1 seeds scale,
 *     vx/vy, yi, vr, fin, a; installs onEnterFrame for bounce + fade physics.
 *     Contains sprite7 "pain" child placed at depth 1.
 *     frame_55: removeMovieClip.
 *   - fumee   (characterId=13) — 48-frame trail smoke particle. frame_1 seeds scale,
 *     random start frame, damped vx/vy; installs onEnterFrame drift.
 *     frame_46: removeMovieClip.
 *   - sprite7 (characterId=7, directlyDynamic=true) — CLIPACTIONRECORD child placed
 *     inside fumee2 at depth 1, name "pain", offset (0.1, -0.25).
 *     onLoad: seeds vr, i=0.
 *     onEnterFrame: _yscale = 100*sin(i += vr).
 *
 * Container-only symbols (no lib_ prefix, no visual frames):
 *   - move  — 2-frame container. onLoad attaches sprite12 spinning child, installs
 *             onEnterFrame that spawns fumee trail particles each tick.
 *   - shoot — 75-frame container (animations[] entry, width/height=0 but has SVG frames).
 *             frame_1 (onLoad): resets rotation, spawns 7 fumee2 particles on parent.
 *             frame_73: _parent.removeMovieClip + complete().
 *
 * DefineSprite_12 — spinning visual child of move (PlaceObject2_3_1).
 *   frame_1: gotoAndStop(random(6)+2).
 *   onEnterFrame: _rotation += 35 degrees per tick.
 *
 * Main timeline: no SOMA.playSound found in canonical AS.
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

const SPRITE7_BOUNDS = {
  width: 8.7,
  height: 8.7,
  offsetX: -4.35,
  offsetY: -4.35,
};

export class Spell2017 extends RuntimeSpell {
  readonly spellId = 2017;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Stored as instance fields so shoot's onLoad can reference them
  // when attaching fumee2 particles to the parent container.
  private fumeeSym!: SymbolDefinition;
  private fumee2Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const fumee2Anchor = calculateAnchor(FUMEE2_BOUNDS);
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);

    // ---- sprite7 — CLIPACTIONRECORD "pain" child inside fumee2 --------
    // Placed by fumee2's onLoad at depth 1 with offset matrix (0.1, -0.25)
    // per manifest.librarySymbols[2].placements[0] (parentSpriteId=8, frame=0).
    //
    // AS scripts/DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS scripts/DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const sprite7Sym: SymbolDefinition = {
      name: "sprite7",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load): vr = Math.random() - 0.5; i = 0;
        clip.vars.vr = Math.random() - 0.5;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame): _yscale = 100 * Math.sin(i += vr)
        const vr = clip.vars.vr as number;
        let i = clip.vars.i as number;
        i += vr;
        clip.vars.i = i;
        // AS percent → TS decimal
        clip.scaleY = Math.sin(i);
      },
    };

    // ---- lib_fumee2 — 57-frame smoke bounce impact particle -------------
    // AS scripts/DefineSprite_8_fumee2/frame_1/DoAction.as
    // AS scripts/DefineSprite_8_fumee2/frame_55/DoAction.as
    //
    // In canonical AS, frame_1/DoAction runs as a timeline script when the
    // clip's playhead reaches frame 1 (index 0). Because the AS uses
    // `this.onEnterFrame = function() {...}` inline in that script to install
    // the physics handler, we replicate the full frame_1 logic inside onLoad
    // (which fires at attach time before any frame advances, equivalent to
    // Flash's first-frame execution), and install clip.onEnterFrame there.
    this.fumee2Sym = {
      name: "fumee2",
      totalFrames: 57,
      frames: textures.getFrames("lib_fumee2"),
      anchorX: fumee2Anchor.x,
      anchorY: fumee2Anchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_8_fumee2/frame_1/DoAction.as:
        //   t = 50 * Math.random() + 50;
        //   stop();
        //   _xscale = t; _yscale = t;
        //   vx = vx;  (preserve caller-set vx)
        //   vy *= 2;
        //   yi = _Y - 1.67 + 3.33 * Math.random();
        //   vr = 30 * Math.random() - 0.5;
        //   fin = 0;  a = 0;
        const t = 50 * Math.random() + 50;
        clip.stop();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        // vx was set by the attach caller before onLoad fires — preserve it
        const vxInit = (clip.vars.vx as number | undefined) ?? 0;
        const vyInit = (clip.vars.vy as number | undefined) ?? 0;
        clip.vars.vx = vxInit;
        clip.vars.vy = vyInit * 2;
        clip.vars.yi = clip.y - 1.67 + 3.33 * Math.random();
        clip.vars.vr = 30 * Math.random() - 0.5;
        clip.vars.fin = 0;
        clip.vars.a = 0;

        // Attach sprite7 "pain" child per manifest placements
        // (parentSpriteId=8, frame=0, depth=1, name="pain", matrix translateX=0.1, translateY=-0.25)
        clip.attach(sprite7Sym, "pain", 1, ctx, { x: 0.1, y: -0.25 });

        // AS frame_1 installs onEnterFrame physics:
        //   if (fin == 1) { _alpha = 150 - (a += 3.3); }
        //   _X += vx; _Y += vy; _rotation += vr;
        //   if (_Y > yi) { bounce + land; fin = 1; }
        //   vy += 0.5;
        clip.onEnterFrame = (self) => {
          let fin = self.vars.fin as number;
          let a = self.vars.a as number;
          let vx = self.vars.vx as number;
          let vy = self.vars.vy as number;
          const vr = self.vars.vr as number;
          const yi = self.vars.yi as number;

          if (fin === 1) {
            // AS: _alpha = 150 - (a += 3.3)  — Flash alpha is 0-100, TS is 0-1
            a += 3.3;
            self.vars.a = a;
            self.alpha = (150 - a) / 100;
          }

          self.x += vx;
          self.y += vy;
          // AS: _rotation = _rotation + vr  (degrees)
          self.rotation += (vr * Math.PI) / 180;

          if (self.y > yi) {
            // AS bounce logic:
            //   vy = (-vy)/9; _Y = yi; _rotation = 0; vr = 0;
            //   pain.pain.vr = 0; pain.pain.i = 0.8;
            //   vx = 0; play(); fin = 1;
            vy = (-vy) / 9;
            self.y = yi;
            self.rotation = 0;
            self.vars.vr = 0;

            const painClip = self.children.get("pain");
            if (painClip) {
              painClip.vars.vr = 0;
              painClip.vars.i = 0.8;
            }

            vx = 0;
            self.play();
            fin = 1;
            self.vars.fin = fin;
          }

          vy += 0.5;
          self.vars.vx = vx;
          self.vars.vy = vy;
        };
      },
      frameScripts: new Map([
        [
          54,
          (clip) => {
            // AS DefineSprite_8_fumee2/frame_55/DoAction.as: this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_fumee — 48-frame trail smoke particle -------------------
    // AS scripts/DefineSprite_13_fumee/frame_1/DoAction.as
    // AS scripts/DefineSprite_13_fumee/frame_46/DoAction.as
    //
    // Same pattern as fumee2: frame_1 installs onEnterFrame inline, so
    // we port the full logic into onLoad.
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
        //   this.onEnterFrame = function() { _X += vx; _Y += vy; vx /= 1.2; vy /= 1.2; }
        const t = 50 * Math.random() + 50;
        clip.gotoAndPlay(Math.floor(Math.random() * 30));
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        const vxInit = (clip.vars.vx as number | undefined) ?? 0;
        const vyInit = (clip.vars.vy as number | undefined) ?? 0;
        clip.vars.vx = vxInit / (3 + 3 * Math.random());
        clip.vars.vy = vyInit / (3 + Math.floor(Math.random() * 3));

        clip.onEnterFrame = (self) => {
          // AS: _X += vx; _Y += vy; vx /= 1.2; vy /= 1.2;
          let vx = self.vars.vx as number;
          let vy = self.vars.vy as number;
          self.x += vx;
          self.y += vy;
          vx /= 1.2;
          vy /= 1.2;
          self.vars.vx = vx;
          self.vars.vy = vy;
        };
      },
      frameScripts: new Map([
        [
          45,
          (clip) => {
            // AS DefineSprite_13_fumee/frame_46/DoAction.as: this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ---- sprite12 — spinning visual child placed inside move ----------
    // PlaceObject2_3_1 inside DefineSprite_4_move at depth 1.
    // AS DefineSprite_12/frame_1/DoAction.as: gotoAndStop(random(6) + 2)
    // AS DefineSprite_4_move/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _rotation = _rotation + 35
    const sprite12Sym: SymbolDefinition = {
      name: "sprite12",
      totalFrames: 7,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_12/frame_1/DoAction.as: gotoAndStop(random(6) + 2)
        // AS 1-based: gotoAndStop(N) → runtime 0-based: N-1
        clip.gotoAndStop(Math.floor(Math.random() * 6) + 1);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_4_move/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation + 35  (degrees → radians)
        clip.rotation += (35 * Math.PI) / 180;
      },
    };

    // ---- move — container-only. Drives fumee trail per tick ----------
    // AS DefineSprite_4_move/frame_1/DoAction.as
    // AS DefineSprite_4_move/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // The harness attaches `move` at the root at (0,0). The move onLoad
    // seeds xi/yi/c and installs onEnterFrame to spawn fumee particles on
    // _parent each tick as the harness positions move along the arc.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_4_move/frame_1/DoAction.as:
        //   xi = this._x; yi = this._y; nf = 0.67; c = 0;
        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
        clip.vars.nf = 0.67;
        clip.vars.c = 0;

        // Attach the spinning sprite12 child (PlaceObject2_3_1, depth 1)
        clip.attach(sprite12Sym, "sprite12_1", 1, ctx);

        // AS this.onEnterFrame = function() { ... }
        clip.onEnterFrame = (self) => {
          // AS DefineSprite_4_move/frame_1/DoAction.as onEnterFrame body:
          //   var _loc3_ = 0; var _loc2_;
          //   while (_loc3_ < nf) {
          //     this._parent.attachMovie("fumee","fumee"+c, c+10);
          //     _loc2_ = this._parent["fumee"+c];
          //     _loc2_._x = this._x; _loc2_._y = this._y;
          //     _loc2_.vx = this._x - xi + 6.67*(Math.random()-0.5);
          //     _loc2_.vy = this._y - yi + 6.67*(Math.random()-0.5);
          //     c++; _loc3_ += 1;
          //   }
          //   xi = this._x; yi = this._y;
          const nf = self.vars.nf as number;
          let c = self.vars.c as number;
          const xi = self.vars.xi as number;
          const yi = self.vars.yi as number;
          const parent = self.parent;

          let loc3 = 0;
          while (loc3 < nf) {
            if (parent) {
              const fumeeName = `fumee${c}`;
              const child = parent.attach(
                this.fumeeSym,
                fumeeName,
                c + 10,
                ctx,
              );
              child.x = self.x;
              child.y = self.y;
              child.vars.vx = self.x - xi + 6.67 * (Math.random() - 0.5);
              child.vars.vy = self.y - yi + 6.67 * (Math.random() - 0.5);
            }
            c++;
            loc3 += 1;
          }

          self.vars.c = c;
          self.vars.xi = self.x;
          self.vars.yi = self.y;
        };
      },
    };

    // ---- shoot — 75-frame. Impact burst + spell completion -----------
    // AS DefineSprite_1_shoot/frame_1/DoAction.as
    // AS DefineSprite_1_shoot/frame_73/DoAction.as
    //
    // shoot is in animations[] (width=0, height=0) NOT in librarySymbols[],
    // so use textures.getFrames("shoot") (no lib_ prefix).
    // The harness attaches shoot at the target position on landing.
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 75,
      frames: textures.getFrames("shoot"),
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_1_shoot/frame_1/DoAction.as:
        //   _rotation = 0;
        //   xi = this._x; yi = this._y;
        //   c = 0;
        //   var p = 0;
        //   while (p < 7) {
        //     this._parent.attachMovie("fumee2","fumee2"+c+200, c+200);
        //     var f = this._parent["fumee2"+c+200];
        //     f._x = this._x; f._y = this._y;
        //     f.vx = this._x - xi + 5*(Math.random()-0.5);
        //     f.vy = -6 * Math.random();
        //     c++; xi = this._x; yi = this._y; p++;
        //   }
        clip.rotation = 0;
        // xi/yi track the "previous position" for each iteration but since
        // _x/_y never change within this loop (shoot is stationary at impact),
        // xi/yi always equal clip.x/clip.y and the vx delta is always
        // 5*(rand-0.5). This matches canonical AS exactly.
        let xi = clip.x;
        let c = 0;
        const parent = clip.parent;

        for (let p = 0; p < 7; p++) {
          if (parent) {
            const fumee2Name = `fumee2${c}200`;
            const f = parent.attach(
              this.fumee2Sym,
              fumee2Name,
              c + 200,
              ctx,
            );
            f.x = clip.x;
            f.y = clip.y;
            f.vars.vx = clip.x - xi + 5 * (Math.random() - 0.5);
            f.vars.vy = -6 * Math.random();
          }
          c++;
          xi = clip.x;
        }
      },
      frameScripts: new Map([
        [
          72,
          (clip) => {
            // AS DefineSprite_1_shoot/frame_73/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite7Sym);
    this.registry.register(this.fumee2Sym);
    this.registry.register(this.fumeeSym);
    this.registry.register(sprite12Sym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // No SOMA.playSound found in the canonical AS scripts for spell 2017.
    // The harness (displayType=30, ProjectileBallistic) automatically:
    //   1. Attaches `move` at root (0,0) — move's onLoad seeds trail logic.
    //   2. Drives parabolic arc, updating move's position each tick.
    //   3. On landing: attaches `shoot` at target coords, calls runtime.signalHit().
    // No additional main-timeline children to attach here.
  }
}
