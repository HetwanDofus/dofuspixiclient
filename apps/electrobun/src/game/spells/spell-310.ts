/**
 * Spell 310 — Séisme (Sacrieur earth quake).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/310/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has `move` and `shoot`
 * library symbols, with the harness driving a parabolic arc. The `move`
 * symbol carries a wobbling rock particle (DefineSprite_9_move with a
 * child sprite that oscillates via onClipEvent(enterFrame)). The `shoot`
 * symbol (132-frame container) carries two kinds of particles:
 *   - DefineSprite_12_pierres: bouncing rock fragments with gravity
 *   - DefineSprite_19_cercle which in turn contains DefineSprite_18:
 *     a spinning sub-sprite inside a fading cercle particle
 * frame_1 of shoot resets rotation, plays "setag_310", and spawns pierres.
 * frame_103 of shoot: a child clip starts fading _alpha -= 3 per frame.
 * frame_130 of shoot: _parent.removeMovieClip() + stop() → complete().
 *
 * Main timeline frame_1: SOMA.playSound("setag_305").
 *
 * Library symbols:
 *   - sprite18 (characterId=18) — spinning sub-sprite inside cercle.
 *     onLoad: seeds vr, _rotation, gotoAndStop to random frame.
 *     onEnterFrame: _rotation += (vr /= _parent.r).
 *   - cercle (DefineSprite_19_cercle) — fading position particle that
 *     contains sprite18. onLoad seeds va, t, scale, alpha, r. Also
 *     exposes vx/vy on the cercle clip itself.
 *     onEnterFrame: fade alpha, drift via parent.vx/vy, remove when alpha < 10.
 *   - pierres (DefineSprite_12_pierres) — bouncing rock fragment.
 *     onLoad: seeds vx, vy, scatter parent position, t, scale, alpha, v, vr.
 *     onEnterFrame: moves parent, applies gravity bounce physics.
 *   - move (DefineSprite_9_move) — wobbling rock during flight.
 *     Frames: shoot animation textures won't be used here; this is a
 *     container that has a child placed by PlaceObject2 with onClipEvent.
 *     The child is an unnamed sprite18-like clip driving rotation+yscale.
 *     We model it as a single symbol with onLoad/onEnterFrame directly.
 *   - shoot — 132-frame container. frame_1 spawns pierres + cercle
 *     particles, frame_103 has a fader child, frame_130 completes.
 *
 * Note on move's child: DefineSprite_9_move/frame_1 has a PlaceObject2_4_1
 * with onClipEvent handlers that rotate and yscale a child. Since this child
 * has no separate library entry or texture in librarySymbols, we model
 * the move symbol itself as having those handlers directly, making move
 * the wobbling visual (using its own frames from the "shoot" animation
 * composite — but move itself has no textures, so we use frames:[] and
 * drive it as a container). The harness attaches `move` and drives its
 * position along the arc.
 *
 * Sounds: main timeline → "setag_305"; shoot frame_1 → "setag_310";
 * shoot enterFrame bounce → "setag_310".
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

// sprite18 bounds from manifest librarySymbols[0]
const SPRITE18_BOUNDS = {
  width: 38.1,
  height: 21.6,
  offsetX: -19.05,
  offsetY: -19.8,
};

export class Spell310 extends RuntimeSpell {
  readonly spellId = 310;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Captured so onSpellStart can reference for shoot's sound callback
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite18Anchor = calculateAnchor(SPRITE18_BOUNDS);

    // ---- sprite18 — spinning sub-sprite inside cercle ---------------
    // AS: scripts/DefineSprite_18/frame_1/PlaceObject2_17_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: scripts/DefineSprite_18/frame_1/PlaceObject2_17_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const sprite18Sym: SymbolDefinition = {
      name: "sprite18",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite18"),
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,
      onLoad: (clip) => {
        // AS: vr = random(200) + 100; _rotation = random(360); gotoAndStop(random(_totalframes) + 1);
        clip.vars.vr = Math.floor(Math.random() * 200) + 100;
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        // gotoAndStop(random(_totalframes) + 1) — totalFrames=1, so random(1)+1=1 → frame 0
        clip.gotoAndStop(0);
      },
      onEnterFrame: (clip) => {
        // AS: _rotation = _rotation + (vr /= _parent.r)
        // _parent is the cercle clip; r is stored on cercle's vars
        let vr = clip.vars.vr as number;
        const parentR = (clip.parent?.vars.r as number) ?? 1.1;
        vr /= parentR;
        clip.vars.vr = vr;
        clip.rotation += (vr * Math.PI) / 180;
      },
    };

    // ---- cercle (DefineSprite_19_cercle) — fading particle containing sprite18 ----
    // AS: scripts/DefineSprite_19_cercle/frame_1/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: scripts/DefineSprite_19_cercle/frame_1/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // cercle itself has no texture entry or bounds in librarySymbols; it is
    // not in manifest.librarySymbols but is referenced by shoot's frame_1.
    // We model it as a container with the placement matrix from sprite18's
    // placements (parentSpriteId=19 → this IS DefineSprite_19_cercle).
    // onLoad seeds alpha, scale, r, va on the cercle clip. It also attaches
    // sprite18 as a child.
    const cercleSym: SymbolDefinition = {
      name: "cercle",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS: va = 4 - random(3); t = 60 + random(70); _xscale=t; _yscale=t;
        //     _alpha = 70 + random(30); r = 1.1 + 0.5 * Math.random();
        const va = 4 - Math.floor(Math.random() * 3);
        const t = 60 + Math.floor(Math.random() * 70);
        clip.vars.va = va;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (70 + Math.floor(Math.random() * 30)) / 100;
        clip.vars.r = 1.1 + 0.5 * Math.random();
        // vx/vy are set on cercle by the parent (shoot) when it attaches.
        // Initialise to 0 here; shoot's frameScripts will set them.
        clip.vars.vx = 0;
        clip.vars.vy = 0;

        // Place sprite18 child at canonical placement matrix from manifest:
        // matrix: scaleX=1, scaleY=0.861, rotateSkew1=-0.2827, translateX=0, translateY=-0.05
        // rotateSkew1 != 0 → rotation = atan2(rotateSkew1, scaleX) in Flash convention
        // rotation = atan2(-0.282684, 1) ≈ -0.2763 rad
        const rot = Math.atan2(-0.282684326171875, 1);
        clip.attach(sprite18Sym, "sprite18_inner", 1, ctx, {
          x: 0,
          y: -0.05,
          rotation: rot,
        });
      },
      onEnterFrame: (clip) => {
        // AS: if(_alpha < 10) { _parent.removeMovieClip(); }
        //     _alpha = _alpha - va;
        //     _X = _X + _parent.vx; _Y = _Y + _parent.vy;
        //     _parent.vx /= r; _parent.vy /= r;
        const alphaVal = clip.alpha * 100;
        if (alphaVal < 10) {
          clip.remove();
          return;
        }
        const va = clip.vars.va as number;
        clip.alpha = (alphaVal - va) / 100;

        // _X and _Y are the clip's own position within its parent (shoot).
        // _parent.vx / _parent.vy are on the parent (shoot/pierres container
        // that was attached as the cercle's parent). In canonical AS the
        // cercle is attached inside shoot, and vx/vy are stored on the
        // cercle clip itself (set externally). We follow that pattern:
        // vx/vy live on the cercle clip (set by shoot when it attaches cercle).
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const r = clip.vars.r as number;
        clip.x += vx;
        clip.y += vy;
        vx /= r;
        vy /= r;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- pierres (DefineSprite_12_pierres) — bouncing rock fragment ----
    // AS: scripts/DefineSprite_12_pierres/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: scripts/DefineSprite_12_pierres/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // No texture entry in librarySymbols or animations by this name;
    // the "shoot" animation composite renders its frames. We treat this
    // as a container-only symbol since it has no separate exported SVGs.
    // The child sprite (PlaceObject2_11_1) is the visual rock; here we model
    // the inner child's clip events directly on the pierres symbol.
    const pierresSym: SymbolDefinition = {
      name: "pierres",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: vx = 5 * (Math.random() - 0.5); vy = 2 * (Math.random() - 0.5);
        //     _parent._x = 20 * (Math.random() - 0.5); _parent._y = 10 * (Math.random() - 0.5);
        //     t = 60 + 40 * Math.random(); _xscale = t; _alpha = 20 + random(90); _yscale = t;
        //     v = -10 * Math.random() - 5; vr = 40 * (-0.5 + Math.random());
        const vx = 5 * (Math.random() - 0.5);
        const vy = 2 * (Math.random() - 0.5);
        // _parent._x / _parent._y — in AS the child sets the parent's position.
        // Since we model the clip events on the pierres symbol itself (which IS
        // the parent in this context), we set our own x/y.
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        const t = 60 + 40 * Math.random();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        const v = -10 * Math.random() - 5;
        const vr = 40 * (-0.5 + Math.random());
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.t = t;
        clip.vars.v = v;
        clip.vars.vr = vr;
        // _Y tracks the inner visual's local y offset (gravity simulation)
        clip.vars.localY = 0;
        clip.vars.fin = 0;
      },
      onEnterFrame: (clip) => {
        // AS: _parent._x += vx; _parent._y += vy;
        //     if(t != 1) {
        //       _Y = _Y + v; _rotation = _rotation + vr; v += 1;
        //       if(_Y > 0) {
        //         vx /= 2; vy /= 2; _Y = 0; v = (-v)/4; _rotation = 0;
        //         vr = ...; apr /= 3; if(Math.abs(v) < 1) { vx=0; vy=0; t=1; }
        //       }
        //     }
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let t = clip.vars.t as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        let localY = clip.vars.localY as number;

        clip.x += vx;
        clip.y += vy;

        if (t !== 1) {
          localY += v;
          clip.rotation += (vr * Math.PI) / 180;
          v += 1;

          if (localY > 0) {
            // bounce on ground
            vx *= 0.6;
            vy *= 0.2;
            localY = 0;
            v = (-v) / 4;
            clip.rotation = 0;
            vr = 0;

            if (Math.abs(v) < 1) {
              vx = 0;
              vy = 0;
              t = 1;
            }
          }

          clip.vars.vr = vr;
          clip.vars.v = v;
          clip.vars.t = t;
          clip.vars.vx = vx;
          clip.vars.vy = vy;
          clip.vars.localY = localY;
        }
      },
    };

    // ---- move (DefineSprite_9_move) — wobbling rock during flight ----
    // AS: scripts/DefineSprite_9_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: scripts/DefineSprite_9_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // AS: scripts/DefineSprite_9_move/frame_1/DoAction.as (empty)
    // The move symbol is a container. Its child (PlaceObject2_4_1) has the
    // clip events. We model the move symbol itself as carrying those handlers
    // since we have no separate library entry for the child.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: vr = 20 * (-0.5 + Math.random()); vx = 0.3 * Math.random(); i = 1.5;
        clip.vars.vr = 20 * (-0.5 + Math.random());
        clip.vars.vx = 0.3 * Math.random();
        clip.vars.i = 1.5;
      },
      onEnterFrame: (clip) => {
        // AS: _rotation = _rotation + vr; _yscale = 100 * Math.sin(i += vx);
        const vr = clip.vars.vr as number;
        let i = clip.vars.i as number;
        const vx = clip.vars.vx as number;
        clip.rotation += (vr * Math.PI) / 180;
        i += vx;
        clip.scaleY = Math.sin(i);
        clip.vars.i = i;
      },
      frameScripts: new Map([
        [
          0,
          // AS: DefineSprite_9_move/frame_1/DoAction.as — empty
          (_clip, _ctx) => {
            // no-op: canonical frame_1 DoAction is empty
          },
        ],
      ]),
    };

    // ---- shoot (DefineSprite_8_shoot) — 132-frame impact container ----
    // AS: scripts/DefineSprite_8_shoot/frame_1/DoAction.as
    //   → _rotation = 0; SOMA.playSound("setag_310");
    // AS: scripts/DefineSprite_8_shoot/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load).as
    //   → seeds rb, apr, vr, g, vx, vy, fin on the inner child
    // AS: scripts/DefineSprite_8_shoot/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   → bouncing rock with gravity, plays setag_310 on bounce
    // AS: scripts/DefineSprite_8_shoot/frame_103/PlaceObject2_7_4/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   → _parent._alpha -= 3 (a child at depth 4 fades the shoot container)
    // AS: scripts/DefineSprite_8_shoot/frame_130/DoAction.as
    //   → _parent.removeMovieClip(); stop();
    //
    // The manifest shoot animation has 132 frames (frameCount=132). We
    // register shoot with frames from textures.getFrames("shoot") (no lib_
    // prefix since it's in animations[], not librarySymbols[]).
    // However, shoot acts as both a textured timeline AND a container for
    // dynamically attached child clips. We include its frames so the
    // composite renders, and add the frameScripts for the procedural bits.
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 132,
      frames: textures.getFrames("shoot"),
      anchorX: calculateAnchor({
        width: 106.85,
        height: 77.85,
        offsetX: -41.7,
        offsetY: -74.2,
      }).x,
      anchorY: calculateAnchor({
        width: 106.85,
        height: 77.85,
        offsetX: -41.7,
        offsetY: -74.2,
      }).y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_8_shoot/frame_1/DoAction.as
            //   _rotation = 0; SOMA.playSound("setag_310");
            clip.rotation = 0;
            this.soundCallback?.("setag_310");

            // AS: DefineSprite_8_shoot/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load).as
            // Attach the inner PlaceObject2_4_2 child — a bouncing rock sprite.
            // We model it as a separate sub-symbol spawned inline.
            const level = (clip.parent?.vars.level as number) ?? 1;
            const nb = 3 + level;
            for (let c = 0; c < nb; c++) {
              clip.attach(pierresSym, `pierres${c}`, 10 + c, ctx);
            }

            // Also attach cercle particles with velocity
            const nbCercle = 5 + level * 2;
            for (let c = 0; c < nbCercle; c++) {
              const cercleClip = clip.attach(
                cercleSym,
                `cercle${c}`,
                20 + c,
                ctx,
              );
              // seed vx/vy on the cercle clip so its onEnterFrame can drift
              cercleClip.vars.vx = 5 * (Math.random() - 0.5);
              cercleClip.vars.vy = 2 * (Math.random() - 0.5);
            }

            // Attach the inner bouncing rock child (PlaceObject2_4_2)
            // This is the primary rock described in shoot's onClipEvent(load):
            //   rb=100+13*(-0.5+Math.random()); apr=100; vr=apr*(-0.5+Math.random());
            //   g=-15-8*Math.random(); vx=5*(-0.5+Math.random()); vy=2.5*(-0.5+Math.random()); fin=0
            const rockClip = clip.attach(
              innerRockSym,
              "innerRock",
              4,
              ctx,
            );
            void rockClip; // used by onLoad which fires inside attach
          },
        ],
        [
          102,
          (clip, ctx) => {
            // AS: DefineSprite_8_shoot/frame_103/PlaceObject2_7_4/CLIPACTIONRECORD onClipEvent(enterFrame)
            // A clip at depth 4 in frame 103 starts fading the shoot container.
            // We model this by attaching a fader symbol that applies
            // _parent._alpha -= 3 each frame.
            clip.attach(faderSym, "fader", 7, ctx);
          },
        ],
        [
          129,
          (clip) => {
            // AS: DefineSprite_8_shoot/frame_130/DoAction.as
            //   _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            this.runtime.complete();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- innerRock (PlaceObject2_4_2 child of shoot) -------------------
    // AS: scripts/DefineSprite_8_shoot/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load).as
    // AS: scripts/DefineSprite_8_shoot/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // This is the inner child of shoot that has the bouncing-rock physics.
    // It has no separate SVG frames; it's a sub-container.
    const innerRockSym: SymbolDefinition = {
      name: "innerRock",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: rb=100+13*(-0.5+Math.random()); apr=100; vr=apr*(-0.5+Math.random());
        //     g=-15-8*Math.random(); vx=5*(-0.5+Math.random()); vy=2.5*(-0.5+Math.random()); fin=0;
        const rb = 100 + 13 * (-0.5 + Math.random());
        const apr = 100;
        const vr = apr * (-0.5 + Math.random());
        const g = -15 - 8 * Math.random();
        const vx = 5 * (-0.5 + Math.random());
        const vy = 2.5 * (-0.5 + Math.random());
        clip.vars.rb = rb;
        clip.vars.apr = apr;
        clip.vars.vr = vr;
        clip.vars.g = g;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.fin = 0;
        clip.vars.i = 0;
        clip.vars.localY = 0;
      },
      onEnterFrame: (clip) => {
        // AS: if(fin == 0) {
        //       _parent._x += vx; _parent._y += vy;
        //       _rotation += vr; _yscale = 100 * Math.sin(i += vx);
        //       _Y = _Y + (g += 1.3);
        //       if(_Y > 0) {
        //         SOMA.playSound("setag_310");
        //         vx *= 0.6; vy *= 0.2; _Y = 0; g = (-g)/1.5; _rotation = rb;
        //         apr /= 3; vr = apr*(-0.5+Math.random());
        //         if(Math.abs(g) < 4) { fin = 1; }
        //       }
        //     }
        const fin = clip.vars.fin as number;
        if (fin !== 0) {
          return;
        }

        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let vr = clip.vars.vr as number;
        let g = clip.vars.g as number;
        let i = clip.vars.i as number;
        let apr = clip.vars.apr as number;
        const rb = clip.vars.rb as number;
        let localY = clip.vars.localY as number;

        // _parent._x += vx; _parent._y += vy
        const parent = clip.parent;
        if (parent) {
          parent.x += vx;
          parent.y += vy;
        }

        // _rotation += vr
        clip.rotation += (vr * Math.PI) / 180;

        // _yscale = 100 * Math.sin(i += vx)
        i += vx;
        clip.scaleY = Math.sin(i);

        // _Y += (g += 1.3)
        g += 1.3;
        localY += g;

        if (localY > 0) {
          this.soundCallback?.("setag_310");
          vx *= 0.6;
          vy *= 0.2;
          localY = 0;
          g = (-g) / 1.5;
          clip.rotation = (rb * Math.PI) / 180;
          apr /= 3;
          vr = apr * (-0.5 + Math.random());

          if (Math.abs(g) < 4) {
            clip.vars.fin = 1;
          }
        }

        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.vr = vr;
        clip.vars.g = g;
        clip.vars.i = i;
        clip.vars.apr = apr;
        clip.vars.localY = localY;
      },
    };

    // ---- fader — child spawned at shoot frame_103 that fades shoot ----
    // AS: scripts/DefineSprite_8_shoot/frame_103/PlaceObject2_7_4/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _parent._alpha -= 3;
    const faderSym: SymbolDefinition = {
      name: "fader",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: _parent._alpha -= 3  (0-100 Flash → 0-1 TS, so decrement by 3/100)
        const parent = clip.parent;
        if (parent) {
          parent.alpha = Math.max(0, parent.alpha - 3 / 100);
        }
      },
    };

    this.registry.register(sprite18Sym);
    this.registry.register(cercleSym);
    this.registry.register(pierresSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
    this.registry.register(innerRockSym);
    this.registry.register(faderSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as → SOMA.playSound("setag_305");
    callbacks.playSound("setag_305");
    // Capture sound callback for use inside frame scripts
    this.soundCallback = callbacks.playSound;
  }
}
