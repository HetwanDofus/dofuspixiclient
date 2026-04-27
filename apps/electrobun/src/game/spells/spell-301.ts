/**
 * Spell 301 — Setag (unknown class, self-buff / caster-anchored aura).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/301/scripts/scripts/
 *
 * displayType=10 (CasterCell). The spell has no projectile, no target-cell
 * anchoring. It is a multi-layered aura / particle system that lives at the
 * caster. Evidence:
 *   - No `move` / `shoot` / `duplicate` symbols.
 *   - DefineSprite_24's onEnterFrame oscillates upward (_Y decreasing) and
 *     removes itself when it fades out — a floating particle anchored at the
 *     caster.
 *   - DefineSprite_25 is the outer composite: frame_88 fires this.end()
 *     (signalHit) and frame_325 calls _parent.removeMovieClip() (complete).
 *
 * Library symbols (all in manifest animations[], no librarySymbols[] entries):
 *   - anim1 — 327-frame composite outer container (DefineSprite_25). Holds
 *     the full visual timeline. frame_88 → signalHit; frame_325 →
 *     _parent.removeMovieClip() + complete.
 *
 * The manifest has NO `librarySymbols[]` entries. All symbols appear only in
 * `animations[]`. The symbol tree inferred from script paths:
 *
 *   DefineSprite_25 (outer, "anim1")
 *     └─ DefineSprite_24 (a floating orb child, "orb")
 *           └─ DefineSprite_23 (inner spinning sub-sprite, "inner")
 *                 └─ DefineSprite_21 (accelerating-loop sub-sprite, "spinner")
 *                        (also has PlaceObject2_21_1 placing "innerLeaf")
 *     └─ DefineSprite_3  (gravity-bounce particle, "particle")
 *
 * Because the manifest has no librarySymbols[], all getFrames() calls use
 * the bare animation name ("anim1") without the "lib_" prefix.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("setag_301") only.
 *
 * The outermost authored symbol DefineSprite_25 maps to the `anim1`
 * animation (327 frames, stopFrame=324). We attach it as a child of root
 * via onSpellStart so the runtime drives its timeline.
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

const ANIM1_BOUNDS = {
  width: 43.65,
  height: 35.15,
  offsetX: -22.6,
  offsetY: -13.1,
};

export class Spell301 extends RuntimeSpell {
  readonly spellId = 301;
  readonly displayType = SpellDisplayType.CasterCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- DefineSprite_21 — accelerating-loop spinner sub-sprite ----
    // AS: DefineSprite_21/frame_1/DoAction.as
    // Sets an onEnterFrame that accelerates gotoAndPlay each loop.
    // This is an inner sub-symbol whose onEnterFrame is installed by
    // its own frame_1 DoAction. We model it as a 1-frame container with
    // frameScripts[0] installing the behaviour via vars + onEnterFrame.
    const spinnerSym: SymbolDefinition = {
      name: "spinner",
      totalFrames: 30,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_21/frame_1/DoAction.as
            // this.onEnterFrame = function() {
            //   f = _currentframe + t;
            //   if (f > _totalframes) { f -= _totalframes; }
            //   gotoAndPlay(f);
            //   if (a++ % 20 == 1) { t += 1; }
            // };
            // Seed state variables. `t` starts at 1 (the frame skip),
            // `a` is the modulo counter.
            clip.vars.t = 1;
            clip.vars.a = 0;
            clip.onEnterFrame = (c) => {
              let t = c.vars.t as number;
              let a = c.vars.a as number;
              // AS: f = _currentframe + t  (1-based in AS → 0-based here)
              let f = c.currentFrame + t;
              if (f >= c.totalFrames) {
                f -= c.totalFrames;
              }
              c.gotoAndPlay(f);
              if (a % 20 === 1) {
                t += 1;
              }
              a++;
              c.vars.t = t;
              c.vars.a = a;
            };
          },
        ],
      ]),
    };

    // ---- innerLeaf — static sub-sprite placed by PlaceObject2_21_1 ----
    // AS: DefineSprite_23/frame_1/PlaceObject2_21_1/CLIPACTIONRECORD onClipEvent(load).as
    // ta = random(40) + 70; _xscale = _yscale = 0.5 * ta; gotoAndPlay(random(30))
    // No per-frame update needed — scales itself and jumps to a random frame.
    const innerLeafSym: SymbolDefinition = {
      name: "innerLeaf",
      totalFrames: 30,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_23/frame_1/PlaceObject2_21_1/CLIPACTIONRECORD onClipEvent(load).as
        const ta = Math.floor(Math.random() * 40) + 70;
        clip.scaleX = (0.5 * ta) / 100;
        clip.scaleY = (0.5 * ta) / 100;
        // AS: gotoAndPlay(random(30)) — 1-based in AS
        clip.gotoAndPlay(Math.floor(Math.random() * 30));
      },
    };

    // ---- inner — spinning sub-sprite inside the orb ----------------
    // AS: DefineSprite_23/frame_1/PlaceObject2_22_7/CLIPACTIONRECORD onClipEvent(load).as
    //   _rotation = random(360) - 90
    //   _alpha = random(50) + 40
    //   i = Math.random() * 6
    // onClipEvent(enterFrame):
    //   _xscale = 100 * Math.sin(i += 0.5)
    // Also places PlaceObject2_21_1 (innerLeaf) and spinner on frame_1.
    const innerSym: SymbolDefinition = {
      name: "inner",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS: DefineSprite_23/frame_1/PlaceObject2_22_7/CLIPACTIONRECORD onClipEvent(load).as
        clip.rotation = ((Math.floor(Math.random() * 360) - 90) * Math.PI) / 180;
        clip.alpha = (Math.floor(Math.random() * 50) + 40) / 100;
        clip.vars.i = Math.random() * 6;
        // Place inner children (spinner + innerLeaf) that the AS authored
        // timeline places via PlaceObject2 in DefineSprite_23/frame_1.
        clip.attach(spinnerSym, "spinner", 7, ctx);
        clip.attach(innerLeafSym, "innerLeaf", 1, ctx);
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_23/frame_1/PlaceObject2_22_7/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let i = clip.vars.i as number;
        i += 0.5;
        clip.vars.i = i;
        // AS: _xscale = 100 * Math.sin(i)  → decimal scale
        clip.scaleX = Math.sin(i);
      },
    };

    // ---- particle — gravity-bounce particle (DefineSprite_3) --------
    // AS: DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    //   v = 0
    // onClipEvent(enterFrame):
    //   _Y += v; _X += vx; v += 0.6
    //   if (_Y > 0) { _Y = 0; v = -5 * Math.random(); vx = -2.5*Math.random()+1.25 }
    // Note: vx is not seeded in onLoad — it starts as undefined (0 in AS).
    const particleSym: SymbolDefinition = {
      name: "particle",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.v = 0;
        clip.vars.vx = 0;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let v = clip.vars.v as number;
        const vx = clip.vars.vx as number;
        clip.y += v;
        clip.x += vx;
        v += 0.6;
        if (clip.y > 0) {
          clip.y = 0;
          v = -5 * Math.random();
          clip.vars.vx = -2.5 * Math.random() + 1.25;
        }
        clip.vars.v = v;
      },
    };

    // ---- orb — floating oscillating orb (DefineSprite_24) ----------
    // AS: DefineSprite_24/frame_1/PlaceObject2_23_1/CLIPACTIONRECORD onClipEvent(load).as
    //   st = 0; i = 0; p = 0
    //   v2 = 0.05 + 0.05 * Math.random()
    //   _rotation = random(360)
    //   _alpha = 120  → but note this is the INNER sprite's alpha
    //   _parent._alpha = 10  → the orb container starts at alpha 10
    //   v = 0.5 + 0.5 * Math.random()
    // onClipEvent(enterFrame):
    //   if (_Y > -80 & _parent._alpha < 100) { _parent._alpha += 6 }
    //   if (_Y < -80) {
    //     _parent._alpha -= 6
    //     if (_parent._alpha < 0) { _parent._visible = 0; st = 1; _parent.removeMovieClip() }
    //   }
    //   _rotation += 1.3
    //   _Y = 5 * Math.cos(i) + (p -= v)
    //   _X = 25 * Math.sin(i += v2)
    //   if (Math.cos(i) < 0) { _alpha = 80 * Math.cos(i) + 100 }
    const orbSym: SymbolDefinition = {
      name: "orb",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS: DefineSprite_24/frame_1/PlaceObject2_23_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.st = 0;
        clip.vars.i = 0;
        clip.vars.p = 0;
        clip.vars.v2 = 0.05 + 0.05 * Math.random();
        // _rotation = random(360) applied to the inner clip (this)
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        // _alpha = 120 on this inner sprite — clamped to 1.0 max
        clip.alpha = Math.min(120 / 100, 1);
        // _parent._alpha = 10 → the orb container (clip.parent)
        if (clip.parent) {
          clip.parent.alpha = 10 / 100;
        }
        clip.vars.v = 0.5 + 0.5 * Math.random();
        // Place the inner sub-sprite authored by the DefineSprite_24 timeline
        clip.attach(innerSym, "inner", 1, ctx);
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_24/frame_1/PlaceObject2_23_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let i = clip.vars.i as number;
        let p = clip.vars.p as number;
        const v = clip.vars.v as number;
        const v2 = clip.vars.v2 as number;
        const parent = clip.parent;

        if (parent) {
          if (clip.y > -80 && parent.alpha < 1.0) {
            parent.alpha = Math.min(parent.alpha + 6 / 100, 1.0);
          }
          if (clip.y < -80) {
            parent.alpha -= 6 / 100;
            if (parent.alpha < 0) {
              parent.visible = false;
              clip.vars.st = 1;
              parent.remove();
              return;
            }
          }
        }

        // _rotation = _rotation + 1.3 (degrees delta → radians)
        clip.rotation += (1.3 * Math.PI) / 180;

        // _Y = 5 * cos(i) + (p -= v)
        p -= v;
        clip.vars.p = p;
        clip.y = 5 * Math.cos(i) + p;

        // _X = 25 * sin(i += v2)
        i += v2;
        clip.vars.i = i;
        clip.x = 25 * Math.sin(i);

        // if (cos(i) < 0) { _alpha = 80 * cos(i) + 100 }
        if (Math.cos(i) < 0) {
          // AS _alpha in 0-100 → TS 0-1
          clip.alpha = (80 * Math.cos(i) + 100) / 100;
        }
      },
    };

    // ---- anim1 — outer composite (DefineSprite_25, 327 frames) -----
    // AS: DefineSprite_25/frame_88/DoAction.as  → this.end() → signalHit
    // AS: DefineSprite_25/frame_325/DoAction.as → _parent.removeMovieClip(); stop() → complete
    // The symbol has authored per-frame visuals in the `anim1` animation.
    // It also hosts the orb and particle children placed on its timeline.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 327,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_25 frame_1 — implicit PlaceObject children.
            // Attach the orb container (which hosts the inner sub-sprites)
            // and a particle at the caster origin.
            const orbContainer = this.registry.resolve("orbContainer");
            if (orbContainer) {
              clip.attach(orbContainer, "orbContainer", 2, ctx);
            }
            clip.attach(particleSym, "particle", 3, ctx);
          },
        ],
        [
          87,
          () => {
            // AS: DefineSprite_25/frame_88/DoAction.as → this.end()
            this.runtime.signalHit();
          },
        ],
        [
          324,
          (clip) => {
            // AS: DefineSprite_25/frame_325/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- orbContainer — thin wrapper so _parent._alpha works --------
    // The AS clip event refers to `_parent._alpha` meaning the orb's
    // containing mc. We create an explicit container clip so orbSym's
    // inner `_alpha` adjusts the container, not the anim1 itself.
    const orbContainerSym: SymbolDefinition = {
      name: "orbContainer",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // Place the inner orbSym (DefineSprite_24's authored child)
        clip.attach(orbSym, "orbInner", 1, ctx);
      },
    };

    this.registry.register(spinnerSym);
    this.registry.register(innerLeafSym);
    this.registry.register(innerSym);
    this.registry.register(particleSym);
    this.registry.register(orbSym);
    this.registry.register(orbContainerSym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: frame_1/DoAction.as → SOMA.playSound("setag_301");
    callbacks.playSound("setag_301");

    // Attach the outer anim1 composite at root so the runtime drives
    // its full 327-frame timeline starting from the next tick.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
