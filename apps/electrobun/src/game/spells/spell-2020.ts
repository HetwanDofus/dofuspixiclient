/**
 * Spell 2020 — Guerison (Eniripsa healing spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2020/scripts/scripts/
 *
 * displayType=11 (TargetCell). This is a self-contained impact at the target cell —
 * no projectile motion, no caster reference, no dual-anchored timelines.
 * The outer clip (DefineSprite_10) plays for 244 frames then removes itself.
 *
 * Library symbols (from manifest.librarySymbols + canonical AS):
 *
 *   - sprite3  (characterId 3, directlyDynamic: true)
 *               Floating healing orb particle. onLoad seeds vy ∈ [-5.5, -2.5].
 *               onEnterFrame: alpha pulses randomly, drifts upward with 0.98 friction.
 *               Has 9 placements inside sprite4 at frame 0, each at different depths
 *               and scales (the "sparkle cluster" around the main heal).
 *
 *   - sprite7  (characterId 7, directlyDynamic: true)
 *               Spinning glyph particle. onLoad seeds vr ∈ [0, 6.67].
 *               onEnterFrame: _rotation += vr (constant spin).
 *               1 placement inside sprite8 at frame 0.
 *
 *   - sprite8  (characterId 8, directlyDynamic: true)
 *               Pulsing ring wrapper. onLoad: copies rotation/alpha/i from parent.
 *               onEnterFrame: _xscale = 100 * sin(i += 0.067) — oscillating scale.
 *               1 placement inside sprite9 at frame 0.
 *
 *   - sprite4  (characterId 4, directlyDynamic: false)
 *               Static cluster of 9 sprite3 instances. No handlers of its own.
 *               Placed by DefineSprite_10 starting at frame 3, with a long alpha
 *               fade-in (frames 3–39) and fade-out (frames 130–171) tween.
 *               The alpha ramp is driven by sprite4's frameScripts in DefineSprite_10.
 *
 *   - sprite9  (characterId 9, directlyDynamic: true)
 *               Rising glow orb. onLoad: p=0, i=0, v2 random [0.016,0.046],
 *               random rotation, alpha=120, parent alpha=10, v random [0.3,0.9].
 *               onEnterFrame: figure-8 path (sin/cos oscillation), rotation += 3,
 *               parent alpha ramps up then fades down, removes parent when done.
 *               Placed by DefineSprite_10 at frames 3, 12, 24, 33, 48 (5 instances).
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("many_504").
 * DefineSprite_10/frame_1/DoAction.as: SOMA.playSound("guerison").
 * DefineSprite_10/frame_244/DoAction.as: _parent.removeMovieClip(); stop() → complete.
 *
 * signalHit: fired at frame 3 of sprite10 (when the first visual element appears).
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

// ---- Bounds from manifest.librarySymbols ----------------------------------------

const SPRITE3_BOUNDS = {
  width: 17.8,
  height: 17.8,
  offsetX: -9.05,
  offsetY: -8.95,
};

const SPRITE4_BOUNDS = {
  width: 45.9,
  height: 15.95,
  offsetX: -23.8,
  offsetY: -7.85,
};

const SPRITE7_BOUNDS = {
  width: 15.25,
  height: 15.15,
  offsetX: -7.1,
  offsetY: -7.8,
};

const SPRITE8_BOUNDS = {
  width: 15.25,
  height: 15.15,
  offsetX: -7.15,
  offsetY: -7.8,
};

const SPRITE9_BOUNDS = {
  width: 9.5,
  height: 9.5,
  offsetX: -4.15,
  offsetY: -4.9,
};

export class Spell2020 extends RuntimeSpell {
  readonly spellId = 2020;
  readonly displayType = SpellDisplayType.TargetCell;

  // Keep references for cross-symbol attaching
  private sprite3Sym!: SymbolDefinition;
  private sprite4Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private sprite8Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE3_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE4_BOUNDS);
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const sprite8Anchor = calculateAnchor(SPRITE8_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);

    // ---- sprite3 — floating healing orb particle --------------------------------
    // AS: scripts/DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: scripts/DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.sprite3Sym = {
      name: "sprite3",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      onLoad: (clip) => {
        // AS: vy = -3 * Math.random() - 2.5;
        clip.vars.vy = -3 * Math.random() - 2.5;
      },
      onEnterFrame: (clip) => {
        // AS: _alpha = 50 + random(50);
        //     _Y = _Y + vy;
        //     vy *= 0.98;
        clip.alpha = (50 + Math.floor(Math.random() * 50)) / 100;
        const vy = clip.vars.vy as number;
        clip.y += vy;
        clip.vars.vy = vy * 0.98;
      },
    };

    // ---- sprite7 — spinning glyph particle --------------------------------------
    // AS: scripts/DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: scripts/DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      onLoad: (clip) => {
        // AS: vr = 6.67 * Math.random();
        clip.vars.vr = 6.67 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS: _rotation = _rotation + vr;
        const vr = clip.vars.vr as number;
        clip.rotation += (vr * Math.PI) / 180;
      },
    };

    // ---- sprite8 — pulsing ring wrapper (contains sprite7) ----------------------
    // AS: scripts/DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: scripts/DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // sprite8's onLoad/enterFrame handlers are on its INNER PlaceObject2_7_1 child
    // (which IS sprite7). However sprite8 itself is the wrapper that hosts the
    // oscillating xscale behavior described in DefineSprite_8.
    // Per the AS: the placed child inside DefineSprite_8 is sprite7 (PlaceObject2_7_1),
    // and THAT child's handlers copy parent rotation/alpha/i and drive xscale oscillation.
    // sprite8 is "directlyDynamic: true" — the handlers listed under DefineSprite_8 fire
    // on the PlaceObject2_7_1 instance placed INSIDE sprite8 (which is sprite7).
    // So sprite8 itself is a container; we attach sprite7 inside it via frameScripts,
    // and sprite7's onLoad/onEnterFrame match the PlaceObject2_7_1 handlers.
    // BUT the actual handler scripts live under DefineSprite_8 (the parent), meaning
    // the placed sprite7 instance inside sprite8 carries these handlers:
    //   onLoad: _rotation = _parent.rotation; _alpha = _parent.alpha; i = _parent.i;
    //   onEnterFrame: _xscale = 100 * Math.sin(i += 0.067);
    // We model this by giving sprite7 THESE handlers (from DefineSprite_8's scripts),
    // while sprite8 is the container that holds them.
    //
    // Reconciliation: sprite7 (characterId 7) is placed inside sprite8 (characterId 8).
    // The scripts for the placed child are under DefineSprite_8/.../PlaceObject2_7_1/.
    // sprite7's own definition (DefineSprite_7/.../PlaceObject2_6_1/) fires on the
    // sprite7 instance placed inside sprite8's parent (sprite9/10).
    //
    // To avoid confusion: we create TWO symbol defs for the two contexts:
    //   sprite7 — top-level spinning glyph (DefineSprite_7 handlers, vr spin)
    //   sprite7Inner — when placed inside sprite8 it uses DefineSprite_8 handlers (xscale pulse)
    //
    // Actually re-reading: sprite8 contains sprite7 at PlaceObject2_7_1 with onClipEvent
    // defined under DefineSprite_8/frame_1/PlaceObject2_7_1/. Those handlers read
    // _parent.rotation, _parent.alpha, _parent.i — meaning the placed child (sprite7 inside
    // sprite8) reads sprite8's vars. sprite8 is then placed inside sprite9 at PlaceObject2_8_1
    // with DefineSprite_9 handlers (the figure-8 motion). sprite9 is the outermost dynamic
    // placed in sprite10/anim1.
    //
    // So the chain is: sprite10 (anim1) → sprite9 (figure-8) → sprite8 (xscale pulse child)
    // → sprite7 (inner spinning glyph, top-level spin from DefineSprite_7 handlers).
    //
    // We need a "sprite7_inner" variant for use inside sprite8 with the xscale-pulse handlers.
    const sprite7InnerSym: SymbolDefinition = {
      name: "sprite7_inner",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(load).as
        // _rotation = _parent.rotation; _alpha = _parent.alpha; i = _parent.i;
        const parent = clip.parent;
        const parentRotationRad = parent?.rotation ?? 0;
        clip.rotation = parentRotationRad;
        clip.alpha = parent?.alpha ?? 1;
        // i is not set on parent until after attach; default to 0
        clip.vars.i = (parent?.vars.i as number) ?? 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _xscale = 100 * Math.sin(i += 0.067);
        let i = clip.vars.i as number;
        i += 0.067;
        clip.vars.i = i;
        clip.scaleX = (100 * Math.sin(i)) / 100;
      },
    };
    this.registry.register(sprite7InnerSym);

    // ---- sprite8 — pulsing ring (contains sprite7_inner) -------------------------
    // sprite8 is a container that places sprite7 inside itself.
    // The manifest says sprite8 has 1 placement of sprite7 (characterId 7) inside it.
    // sprite8 itself has no explicit onLoad/enterFrame in the manifest scripts —
    // its dynamic behaviour comes from sprite9's handlers operating on sprite8 as a child.
    this.sprite8Sym = {
      name: "sprite8",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      onLoad: (clip, ctx) => {
        // Place sprite7_inner inside sprite8 at depth 1 per manifest placement:
        // matrix: scaleX=0.625, scaleY=0.625, translateX=0.3, translateY=0
        // AS: PlaceObject2_7_1 with that matrix
        const innerSym = this.registry.resolve("sprite7_inner");
        if (innerSym) {
          const child = clip.attach(innerSym, "sprite7_inner", 1, ctx);
          child.scaleX = 0.625;
          child.scaleY = 0.625;
          child.x = 0.3;
          child.y = 0;
        }
      },
    };

    // ---- sprite9 — rising glow orb (contains sprite8, drives figure-8 motion) ---
    // AS: scripts/DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: scripts/DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // The PlaceObject2_8_1 placed child is sprite8 inside sprite9.
    // These handlers are ON the sprite8 instance placed in sprite9.
    // sprite9 itself is the outer wrapper placed in anim1/sprite10.
    //
    // Same pattern as sprite8/sprite7: we need a "sprite8_inner" variant for placement
    // inside sprite9 that carries the DefineSprite_9 handlers.
    const sprite8InnerSym: SymbolDefinition = {
      name: "sprite8_inner",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load).as
        // p = 0; i = 0;
        // v2 = 0.016 + 0.03 * Math.random();
        // _rotation = random(360);
        // _alpha = 120;
        // _parent._alpha = 10;
        // v = 0.3 + 0.6 * Math.random();
        clip.vars.p = 0;
        clip.vars.i = 0;
        clip.vars.v2 = 0.016 + 0.03 * Math.random();
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        clip.alpha = 120 / 100;
        // _parent._alpha = 10 → set sprite9 container alpha
        if (clip.parent) {
          clip.parent.alpha = 10 / 100;
        }
        clip.vars.v = 0.3 + 0.6 * Math.random();

        // Also place sprite8's inner content (sprite7_inner) here as per sprite8 structure
        const innerSym = this.registry.resolve("sprite7_inner");
        if (innerSym) {
          const child = clip.attach(innerSym, "sprite7_inner", 1, ctx);
          child.scaleX = 0.625;
          child.scaleY = 0.625;
          child.x = 0.3;
          child.y = 0;
        }
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // if(_Y > -100 & _parent._alpha < 100) { _parent._alpha += 40; }
        // if(_Y < -100) {
        //   _parent._alpha -= 10;
        //   if(_parent._alpha < 0) { _parent._visible = 0; st = 1; _parent.removeMovieClip(); }
        // }
        // _rotation = _rotation + 3;
        // _Y = 5 * Math.cos(i) + (p -= v);
        // _X = 25 * Math.sin(i += v2);
        // if(Math.cos(i) < 0) { _alpha = 80 * Math.cos(i) + 100; }
        const parent = clip.parent;
        let p = clip.vars.p as number;
        let i = clip.vars.i as number;
        const v = clip.vars.v as number;
        const v2 = clip.vars.v2 as number;

        const yPos = clip.y;
        if (parent) {
          if (yPos > -100 && parent.alpha < 1.0) {
            parent.alpha = Math.min(1.0, parent.alpha + 40 / 100);
          }
          if (yPos < -100) {
            parent.alpha -= 10 / 100;
            if (parent.alpha < 0) {
              parent.visible = false;
              clip.vars.st = 1;
              parent.remove();
              return;
            }
          }
        }

        clip.rotation += (3 * Math.PI) / 180;

        p -= v;
        clip.vars.p = p;
        i += v2;
        clip.vars.i = i;

        clip.y = 5 * Math.cos(i) + p;
        clip.x = 25 * Math.sin(i);

        if (Math.cos(i) < 0) {
          // AS: _alpha = 80 * Math.cos(i) + 100  (in 0-100 scale)
          clip.alpha = (80 * Math.cos(i) + 100) / 100;
        }
      },
    };
    this.registry.register(sprite8InnerSym);

    // ---- sprite9 — outer container for figure-8 orbs -----------------------------
    // sprite9 is placed by DefineSprite_10 (the main animation sprite) at various
    // frames. sprite9 contains sprite8_inner (which carries the DefineSprite_9 handlers).
    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onLoad: (clip, ctx) => {
        // Place sprite8_inner inside sprite9. The manifest shows placement of
        // sprite8 (characterId 8) inside sprite9 at depth 1 with
        // matrix: scaleX=1, scaleY=1, translateX=-0.05, translateY=0
        // (actually the placement under DefineSprite_9 is PlaceObject2_8_1 which IS
        // the sprite8 instance that carries the figure-8 handlers).
        const innerSym = this.registry.resolve("sprite8_inner");
        if (innerSym) {
          const child = clip.attach(innerSym, "sprite8_inner", 1, ctx);
          child.x = -0.05;
          child.y = 0;
        }
      },
    };

    // ---- sprite4 — static cluster wrapper (9 × sprite3 at various scales) -------
    // sprite4 is directlyDynamic: false — no handlers of its own.
    // It is placed by DefineSprite_10 starting at frame 3 (0-indexed = 2).
    // It contains 9 instances of sprite3 at fixed offsets/scales per manifest placements.
    // The alpha tween on the sprite4 instance is driven by DefineSprite_10's authored
    // timeline tweens (captured in manifest placements as colorTransform.alphaMult
    // entries). We implement the ramp via frameScripts on the sprite10 symbol.
    this.sprite4Sym = {
      name: "sprite4",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      onLoad: (clip, ctx) => {
        // Place all 9 sprite3 instances per manifest placements[] for parentSpriteId=4
        // Depth 1: scaleX=0.619, scaleY=0.619, tx=-11, ty=2.6
        {
          const c = clip.attach(this.sprite3Sym, "s3d1", 1, ctx);
          c.scaleX = 0.6192626953125;
          c.scaleY = 0.6192626953125;
          c.x = -11;
          c.y = 2.6;
        }
        // Depth 3: scaleX=0.395, scaleY=0.395, tx=10.75, ty=4.2
        {
          const c = clip.attach(this.sprite3Sym, "s3d3", 3, ctx);
          c.scaleX = 0.395050048828125;
          c.scaleY = 0.395050048828125;
          c.x = 10.75;
          c.y = 4.2;
        }
        // Depth 5: scaleX=0.395, scaleY=0.395, tx=-15.7, ty=-1.8
        {
          const c = clip.attach(this.sprite3Sym, "s3d5", 5, ctx);
          c.scaleX = 0.395050048828125;
          c.scaleY = 0.395050048828125;
          c.x = -15.7;
          c.y = -1.8;
        }
        // Depth 7: scaleX=0.619, scaleY=0.619, tx=7.35, ty=1.8
        {
          const c = clip.attach(this.sprite3Sym, "s3d7", 7, ctx);
          c.scaleX = 0.6192626953125;
          c.scaleY = 0.6192626953125;
          c.x = 7.35;
          c.y = 1.8;
        }
        // Depth 9: scaleX=0.395, scaleY=0.395, tx=16.4, ty=1.9
        {
          const c = clip.attach(this.sprite3Sym, "s3d9", 9, ctx);
          c.scaleX = 0.395050048828125;
          c.scaleY = 0.395050048828125;
          c.x = 16.4;
          c.y = 1.9;
        }
        // Depth 11: scaleX=0.293, scaleY=0.293, tx=-21.15, ty=1.9
        {
          const c = clip.attach(this.sprite3Sym, "s3d11", 11, ctx);
          c.scaleX = 0.292877197265625;
          c.scaleY = 0.292877197265625;
          c.x = -21.15;
          c.y = 1.9;
        }
        // Depth 13: scaleX=0.293, scaleY=0.293, tx=19.55, ty=0.25
        {
          const c = clip.attach(this.sprite3Sym, "s3d13", 13, ctx);
          c.scaleX = 0.292877197265625;
          c.scaleY = 0.292877197265625;
          c.x = 19.55;
          c.y = 0.25;
        }
        // Depth 15: scaleX=0.207, scaleY=0.207, tx=-11.25, ty=-5.2
        {
          const c = clip.attach(this.sprite3Sym, "s3d15", 15, ctx);
          c.scaleX = 0.20703125;
          c.scaleY = 0.20703125;
          c.x = -11.25;
          c.y = -5.2;
        }
        // Depth 17: scaleX=0.293, scaleY=0.293, tx=13.95, ty=-5.25
        {
          const c = clip.attach(this.sprite3Sym, "s3d17", 17, ctx);
          c.scaleX = 0.292877197265625;
          c.scaleY = 0.292877197265625;
          c.x = 13.95;
          c.y = -5.25;
        }
      },
    };

    // ---- sprite10 / anim1 — the outer 244-frame animation -----------------------
    // DefineSprite_10 is the main animation container (corresponds to "anim1" in
    // animations[]). It carries the authored timeline with sprite4 and sprite9 placements.
    // frame_1 plays "guerison" sound.
    // frame_244 removes parent + stops → spell complete.
    // Between frames 3-171, sprite4 is visible with an alpha tween.
    // At frames 3, 12, 24, 33, 48 sprite9 instances are placed.
    //
    // The alpha tween for sprite4 (from manifest placements colorTransform.alphaMult):
    //   Frame 3:  alphaMult=13  → alpha = 13/256
    //   Frame 39: alphaMult=256 → alpha = 1.0  (full opacity, ramp-in frames 3-39)
    //   Frame 130: alphaMult=250 → start fade-out
    //   Frame 171: alphaMult=13  → nearly gone (fade-out frames 130-171)
    // We interpolate in frameScripts for the key frames and use onEnterFrame for the ramp.
    // Actually since this is a 244-frame authored timeline we implement it as frameScripts
    // at each keyed placement frame. The simplest canonical approach is to track elapsed
    // frames in the sprite10 onEnterFrame and set alpha accordingly.
    //
    // We model sprite10 as a SymbolDefinition attached to root from onSpellStart.
    this.sprite10Sym = {
      name: "sprite10",
      totalFrames: 244,
      frames: textures.getFrames("anim1"),
      anchorX: calculateAnchor({ width: 46, height: 16, offsetX: -24.4, offsetY: -9.25 }).x,
      anchorY: calculateAnchor({ width: 46, height: 16, offsetX: -24.4, offsetY: -9.25 }).y,
      frameScripts: new Map([
        [
          0,
          (_clip, _ctx) => {
            // AS DefineSprite_10/frame_1/DoAction.as: SOMA.playSound("guerison")
            // Sound is played via onSpellStart — no action needed here since
            // we can't call callbacks from frameScripts easily. The sound is
            // emitted in onSpellStart instead for frame_1.
          },
        ],
        [
          2,
          (clip, ctx) => {
            // Frame 3 (0-indexed=2): place sprite4 at depth 1 with initial alpha=13/256
            // and sprite9 instance at depth 19 with ratio=3.
            // From manifest placement: sprite4 at tx=-0.6, ty=-1.4, alphaMult=13
            if (!clip.children.has("sprite4")) {
              const s4 = clip.attach(this.sprite4Sym, "sprite4", 1, ctx);
              s4.x = -0.6;
              s4.y = -1.4;
              s4.alpha = 13 / 256;
            }
            // Sprite9 instance 1 at depth 19, tx=-0.05, ty=-0.1, ratio=3
            if (!clip.children.has("sprite9_1")) {
              const s9 = clip.attach(this.sprite9Sym, "sprite9_1", 19, ctx);
              s9.x = -0.05;
              s9.y = -0.1;
            }
            // Signal hit when the first visual element appears
            this.runtime.signalHit();
          },
        ],
        [
          11,
          (clip, ctx) => {
            // Frame 12 (0-indexed=11): place sprite9 instance 2 at depth 21
            if (!clip.children.has("sprite9_2")) {
              const s9 = clip.attach(this.sprite9Sym, "sprite9_2", 21, ctx);
              s9.x = -0.05;
              s9.y = -0.1;
            }
          },
        ],
        [
          23,
          (clip, ctx) => {
            // Frame 24 (0-indexed=23): place sprite9 instance 3 at depth 23
            if (!clip.children.has("sprite9_3")) {
              const s9 = clip.attach(this.sprite9Sym, "sprite9_3", 23, ctx);
              s9.x = -0.05;
              s9.y = -0.1;
            }
          },
        ],
        [
          32,
          (clip, ctx) => {
            // Frame 33 (0-indexed=32): place sprite9 instance 4 at depth 25
            if (!clip.children.has("sprite9_4")) {
              const s9 = clip.attach(this.sprite9Sym, "sprite9_4", 25, ctx);
              s9.x = -0.05;
              s9.y = -0.1;
            }
          },
        ],
        [
          47,
          (clip, ctx) => {
            // Frame 48 (0-indexed=47): place sprite9 instance 5 at depth 27
            if (!clip.children.has("sprite9_5")) {
              const s9 = clip.attach(this.sprite9Sym, "sprite9_5", 27, ctx);
              s9.x = -0.05;
              s9.y = -0.1;
            }
          },
        ],
        [
          243,
          (clip) => {
            // AS DefineSprite_10/frame_244/DoAction.as:
            // _parent.removeMovieClip(); stop();
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // Drive the alpha tween on sprite4 based on DefineSprite_10's current frame.
        // Fade-in: frames 3–39 (0-indexed 2–38): alphaMult 13 → 256
        //   alphaMult at frame f (0-indexed) ≈ 13 + (f - 2) * (256 - 13) / (38 - 2)
        // Fully opaque: frames 39–129 (0-indexed 38–128)
        // Fade-out: frames 130–171 (0-indexed 129–170): alphaMult 250 → 13
        //   alphaMult at frame f ≈ 250 - (f - 129) * (250 - 13) / (170 - 129)
        const s4 = clip.children.get("sprite4");
        if (s4) {
          const f = clip.currentFrame;
          if (f >= 2 && f < 39) {
            const alphaMult = 13 + ((f - 2) * (256 - 13)) / (38 - 2);
            s4.alpha = alphaMult / 256;
          } else if (f >= 39 && f < 129) {
            s4.alpha = 1.0;
          } else if (f >= 129 && f <= 170) {
            const alphaMult = 250 - ((f - 129) * (250 - 13)) / (170 - 129);
            s4.alpha = Math.max(0, alphaMult / 256);
          } else if (f > 170) {
            s4.alpha = 0;
          }
        }
      },
    };

    this.registry.register(this.sprite3Sym);
    this.registry.register(this.sprite4Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite8Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite10Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("many_504")
    callbacks.playSound("many_504");
    // AS DefineSprite_10/frame_1/DoAction.as: SOMA.playSound("guerison")
    // Both sounds play on frame 1 per manifest sounds[].
    callbacks.playSound("guerison");

    // Attach the main animation sprite (sprite10 / anim1) to root.
    // This is the outer timeline that drives everything.
    this.root.attach(this.sprite10Sym, "sprite10", 1, context);
  }
}
