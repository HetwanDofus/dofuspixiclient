/**
 * Spell 616 — Dodge (Sram).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/616/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Two parallel authored timelines anchored at
 * world origin:
 *   - sprite_20 (DefineSprite_20): positions itself at cellFrom (caster), plays
 *     103 frames, fires "dodge_616a" sound on frame_1. Stops at frame 103.
 *   - sprite_33 (DefineSprite_33): positions itself at cellTo (target), plays
 *     181 frames. frame_64 fires "dodge_616b". frame_97 signals hit.
 *     frame_181 removes parent and calls complete().
 *
 * Library symbol hierarchy (manifest.librarySymbols, kind: "clipEvent"):
 *   - sprite29 (characterId 29) — directlyDynamic: true. 4-frame visual leaf
 *     (spark shape). Placed inside DefineSprite_30 at depth 1.
 *     onClipEvent(load): seeds vrot, vrot2, i vars.
 *     onClipEvent(enterFrame): _alpha -= 2.5; conditional xscale oscillation,
 *     rotation spin. (DefineSprite_30/frame_1/PlaceObject2_29_1/CLIPACTIONRECORD)
 *   - sprite30 (characterId 30) — directlyDynamic: true. 1-frame wrapper
 *     (DefineSprite_30). Placed inside DefineSprite_31.
 *     frame_1/DoAction.as: sets up own motion vars + this.onEnterFrame for
 *     position/velocity integration.
 *     Contains sprite29 placed at depth 1 (inherits enterFrame from above).
 *   - sprite31 (characterId 31) — directlyDynamic: true. 1-frame wrapper
 *     (DefineSprite_31). Placed in sprite_32 at frame 79 (depth 3) and in
 *     sprite_33 at frame 102 (depth 7).
 *     frame_1/PlaceObject2_30_1/CLIPACTIONRECORD onClipEvent(load):
 *     gotoAndStop(random(_totalframes)+1) on the placed sprite30.
 *     Contains sprite30 placed at depth 1.
 *   - sprite32 (characterId 32) — directlyDynamic: true. 198-frame animated
 *     sparkle. Placed 7× inside sprite_33 at frame 42.
 *     frame_1: randomize rotation/scale/gotoAndPlay.
 *     frame_79: place sprite31 at depth 3.
 *     frame_136: stop().
 *
 * Main timeline: frame_1 places sprite_20 + sprite_33; frame_2 stops.
 *
 * Sound schedule:
 *   - "dodge_616a": DefineSprite_20/frame_1
 *   - "dodge_616b": DefineSprite_33/frame_64
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

// ---- Manifest bounds for library symbols --------------------------------

const SPRITE29_BOUNDS = {
  width: 19.45,
  height: 12.6,
  offsetX: -9.7,
  offsetY: -6.75,
};

const SPRITE30_BOUNDS = {
  width: 9.6,
  height: 6.25,
  offsetX: -4.9,
  offsetY: -3.35,
};

const SPRITE31_BOUNDS = {
  width: 9.6,
  height: 6.25,
  offsetX: -4.8,
  offsetY: -3.15,
};

const SPRITE32_BOUNDS = {
  width: 104.7,
  height: 157.3,
  offsetX: -48.2,
  offsetY: -34.55,
};

export class Spell616 extends RuntimeSpell {
  readonly spellId = 616;
  // Both sprite_20 and sprite_33 position themselves at cellFrom / cellTo
  // using _parent.cellFrom/To → displayType WorldAbsolute (50).
  readonly displayType = SpellDisplayType.WorldAbsolute;

  // Hold symbol refs needed across methods
  private sprite29Sym!: SymbolDefinition;
  private sprite30Sym!: SymbolDefinition;
  private sprite31Sym!: SymbolDefinition;
  private sprite32Sym!: SymbolDefinition;
  private sprite20Sym!: SymbolDefinition;
  private sprite33Sym!: SymbolDefinition;

  // Capture playSound for use inside frame scripts
  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite29Anchor = calculateAnchor(SPRITE29_BOUNDS);
    const sprite30Anchor = calculateAnchor(SPRITE30_BOUNDS);
    const sprite31Anchor = calculateAnchor(SPRITE31_BOUNDS);
    const sprite32Anchor = calculateAnchor(SPRITE32_BOUNDS);

    // ---- sprite29 — 4-frame spark leaf (directlyDynamic: true) ----------
    // Placed inside DefineSprite_30 at depth 1 via PlaceObject2_29_1.
    // AS: DefineSprite_30/frame_1/PlaceObject2_29_1/CLIPACTIONRECORD onClipEvent(load).as
    //   vrot = -50 + 100 * Math.random();
    //   vrot2 = -1 + 2 * Math.random();
    //   i = 0;
    // AS: DefineSprite_30/frame_1/PlaceObject2_29_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _alpha = _alpha - 2.5;
    //   if(_Y < _parent.p) {
    //     vrot2 /= 1.12;
    //     _xscale = 50 * Math.sin(i += vrot2);
    //     _rotation = _rotation + vrot;
    //   }
    this.sprite29Sym = {
      name: "sprite29",
      totalFrames: 4,
      frames: textures.getFrames("sprite_29"),
      anchorX: sprite29Anchor.x,
      anchorY: sprite29Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_30/frame_1/PlaceObject2_29_1/CLIPACTIONRECORD onClipEvent(load)
        clip.vars.vrot = -50 + 100 * Math.random();
        clip.vars.vrot2 = -1 + 2 * Math.random();
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_30/frame_1/PlaceObject2_29_1/CLIPACTIONRECORD onClipEvent(enterFrame)
        clip.alpha = clip.alpha - 2.5 / 100;
        // _parent.p is the threshold set on the sprite30 (DefineSprite_30) container
        const p = (clip.parent?.vars.p as number) ?? 0;
        if (clip.y < p) {
          let vrot2 = clip.vars.vrot2 as number;
          const vrot = clip.vars.vrot as number;
          let i = clip.vars.i as number;
          vrot2 /= 1.12;
          i += vrot2;
          // AS: _xscale = 50 * Math.sin(i) — scale in percent → decimal
          clip.scaleX = (50 * Math.sin(i)) / 100;
          // AS: _rotation += vrot — degrees → radians delta
          clip.rotation += (vrot * Math.PI) / 180;
          clip.vars.vrot2 = vrot2;
          clip.vars.i = i;
        }
      },
    };

    // ---- sprite30 — 1-frame dust puff container (directlyDynamic: true) -
    // This is DefineSprite_30. Placed inside DefineSprite_31 at depth 1.
    // AS: DefineSprite_30/frame_1/DoAction.as
    //   roti = 70 + 60 * Math.random();
    //   c._rotation = roti;          ← c is the placed sprite29 child ("c")
    //   dv = 1.05 + 0.2 * Math.random();
    //   v = 3 + 10 * Math.random();
    //   vx = v * Math.cos(roti * PI/180);
    //   vy = v * Math.sin(roti * PI/180);
    //   p = 60 - random(30);         ← threshold used by sprite29's enterFrame
    //   cacc = 1.3 + 0.3 * Math.random();
    //   this.onEnterFrame = function() {
    //     if(c._y < p) {
    //       c._y += cacc;
    //       _X += vx; _Y += vy;
    //       vx /= dv; vy /= dv;
    //     }
    //   };
    this.sprite30Sym = {
      name: "sprite30",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite30"),
      anchorX: sprite30Anchor.x,
      anchorY: sprite30Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_30/frame_1/DoAction.as
            const roti = 70 + 60 * Math.random();
            const dv = 1.05 + 0.2 * Math.random();
            const v = 3 + 10 * Math.random();
            const vx0 = v * Math.cos((roti * Math.PI) / 180);
            const vy0 = v * Math.sin((roti * Math.PI) / 180);
            const p = 60 - Math.floor(Math.random() * 30);
            const cacc = 1.3 + 0.3 * Math.random();

            clip.vars.dv = dv;
            clip.vars.vx = vx0;
            clip.vars.vy = vy0;
            clip.vars.p = p;
            clip.vars.cacc = cacc;

            // Place sprite29 as child "c" at depth 1
            // AS: c is accessed as a named child — it's placed via PlaceObject2_29_1
            const c = clip.attach(this.sprite29Sym, "c", 1, ctx);
            // AS: c._rotation = roti (degrees → radians)
            c.rotation = (roti * Math.PI) / 180;

            // AS: this.onEnterFrame = function() { if(c._y < p) { ... } }
            clip.onEnterFrame = (self) => {
              const child = self.children.get("c");
              if (!child) {
                return;
              }
              const pVal = self.vars.p as number;
              if (child.y < pVal) {
                const cacc2 = self.vars.cacc as number;
                let vxCur = self.vars.vx as number;
                let vyCur = self.vars.vy as number;
                const dvCur = self.vars.dv as number;
                child.y += cacc2;
                self.x += vxCur;
                self.y += vyCur;
                vxCur /= dvCur;
                vyCur /= dvCur;
                self.vars.vx = vxCur;
                self.vars.vy = vyCur;
              }
            };
          },
        ],
      ]),
    };

    // ---- sprite31 — 1-frame wrapper (directlyDynamic: true) -------------
    // This is DefineSprite_31. Placed in sprite_32 (frame 79, depth 3) and
    // in sprite_33 (frame 102, depth 7).
    // AS: DefineSprite_31/frame_1/PlaceObject2_30_1/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndStop(random(_totalframes) + 1);
    //   (_totalframes of sprite30 = 1, so this always lands on frame 1 = gotoAndStop(0))
    // sprite31 contains sprite30 placed at depth 1.
    // Also: onLoad from both placement sites seeds _rotation = random(360) on
    // the sprite31 clip itself (DefineSprite_33/frame_102 and DefineSprite_32/frame_79
    // CLIPACTIONRECORD onClipEvent(load)).
    this.sprite31Sym = {
      name: "sprite31",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite31"),
      anchorX: sprite31Anchor.x,
      anchorY: sprite31Anchor.y,
      onLoad: (clip, ctx) => {
        // AS: from both placement sites — CLIPACTIONRECORD onClipEvent(load):
        //   _rotation = random(360)
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;

        // AS: DefineSprite_31/frame_1/PlaceObject2_30_1/CLIPACTIONRECORD onClipEvent(load):
        //   gotoAndStop(random(_totalframes) + 1)
        // Place sprite30 as child at depth 1. The gotoAndStop on sprite30 lands
        // on frame 1 (totalFrames=1) → gotoAndStop(0). We trigger its frame_1
        // script via attach() which calls frameScripts[0] automatically.
        clip.attach(this.sprite30Sym, "sprite30_1", 1, ctx);
      },
    };

    // ---- sprite32 — 198-frame sparkle/flash (directlyDynamic: true) -----
    // AS: DefineSprite_32/frame_1/DoAction.as
    //   r = _rotation;
    //   _rotation = r + 40 * (-0.5 + Math.random());
    //   _xscale = 50 + random(50);
    //   _yscale = 80 + random(60);
    //   gotoAndPlay(random(45));
    // AS: DefineSprite_32/frame_79 places sprite31 at depth 3 (PlaceObject2_31_3)
    //   matrix: { scaleX:-1, scaleY:-1, translateX:4.75, translateY:-4.95 }
    //   CLIPACTIONRECORD onClipEvent(load): _rotation = random(360)
    // AS: DefineSprite_32/frame_136/DoAction.as: stop()
    this.sprite32Sym = {
      name: "sprite32",
      totalFrames: 198,
      frames: textures.getFrames("lib_sprite32"),
      anchorX: sprite32Anchor.x,
      anchorY: sprite32Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_32/frame_1/DoAction.as
            const rDeg = (clip.rotation * 180) / Math.PI;
            const newRDeg = rDeg + 40 * (-0.5 + Math.random());
            clip.rotation = (newRDeg * Math.PI) / 180;
            clip.scaleX = (50 + Math.floor(Math.random() * 50)) / 100;
            clip.scaleY = (80 + Math.floor(Math.random() * 60)) / 100;
            clip.gotoAndPlay(Math.floor(Math.random() * 45));
          },
        ],
        [
          78,
          (clip, ctx) => {
            // AS: DefineSprite_32/frame_79 — PlaceObject2_31_3 places sprite31
            // matrix: { scaleX:-1, scaleY:-1, translateX:4.75, translateY:-4.95 }
            // CLIPACTIONRECORD onClipEvent(load): _rotation = random(360)
            // (handled inside sprite31's onLoad)
            if (!clip.children.has("sprite31_3")) {
              const child = clip.attach(this.sprite31Sym, "sprite31_3", 3, ctx, {
                x: 4.75,
                y: -4.95,
              });
              child.scaleX = -1;
              child.scaleY = -1;
            }
          },
        ],
        [
          135,
          (clip) => {
            // AS: DefineSprite_32/frame_136/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_20 — caster-side composite timeline (WorldAbsolute) ------
    // AS: DefineSprite_20/frame_1/DoAction.as: SOMA.playSound("dodge_616a")
    // AS: DefineSprite_20/frame_1/DoAction_2.as: _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y
    // AS: DefineSprite_20/frame_103/DoAction.as: stop()
    this.sprite20Sym = {
      name: "sprite_20",
      totalFrames: 103,
      frames: textures.getFrames("sprite_20"),
      anchorX: calculateAnchor({
        width: 157.5,
        height: 191.5,
        offsetX: -109.35,
        offsetY: -182.85,
      }).x,
      anchorY: calculateAnchor({
        width: 157.5,
        height: 191.5,
        offsetX: -109.35,
        offsetY: -182.85,
      }).y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_20/frame_1/DoAction.as — SOMA.playSound("dodge_616a")
            this.playSound?.("dodge_616a");
            // AS: DefineSprite_20/frame_1/DoAction_2.as — position at cellFrom
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y;
            }
          },
        ],
        [
          102,
          (clip) => {
            // AS: DefineSprite_20/frame_103/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_33 — target-side composite timeline (WorldAbsolute) ------
    // AS: DefineSprite_33/frame_1/DoAction.as: _X = _parent.cellTo.x; _Y = _parent.cellTo.y
    // AS: DefineSprite_33/frame_64/DoAction.as: SOMA.playSound("dodge_616b")
    // AS: DefineSprite_33/frame_97/DoAction.as: this.end() → signalHit
    // AS: DefineSprite_33/frame_181/DoAction.as: _parent.removeMovieClip(); stop()
    // At frame 42 (0-based 41): 7 placements of sprite32 at various depths/offsets/flips
    // At frame 102 (0-based 101): 1 placement of sprite31 at depth 7
    this.sprite33Sym = {
      name: "sprite_33",
      totalFrames: 181,
      frames: textures.getFrames("sprite_33"),
      anchorX: calculateAnchor({
        width: 127,
        height: 187.35,
        offsetX: -62.7,
        offsetY: -159.6,
      }).x,
      anchorY: calculateAnchor({
        width: 127,
        height: 187.35,
        offsetX: -62.7,
        offsetY: -159.6,
      }).y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_33/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y
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
          41,
          (clip, ctx) => {
            // AS: 7 PlaceObject2 placements of sprite32 (characterId 32) at frame 42
            // Each at a different depth, offset, and scale flip.
            // Placement 1: depth 1, matrix { scaleX:-1, scaleY:-1, tx:-5.2, ty:-16.3 }
            const p1 = clip.attach(this.sprite32Sym, "sprite32_1", 1, ctx, {
              x: -5.2,
              y: -16.3,
            });
            p1.scaleX = -1;
            p1.scaleY = -1;

            // Placement 2: depth 9, matrix { scaleX:-1, scaleY:-1, tx:6.3, ty:-27.8 }
            const p2 = clip.attach(this.sprite32Sym, "sprite32_9", 9, ctx, {
              x: 6.3,
              y: -27.8,
            });
            p2.scaleX = -1;
            p2.scaleY = -1;

            // Placement 3: depth 13, matrix { scaleX:1, scaleY:-1, tx:7.8, ty:-10.8 }
            const p3 = clip.attach(this.sprite32Sym, "sprite32_13", 13, ctx, {
              x: 7.8,
              y: -10.8,
            });
            p3.scaleX = 1;
            p3.scaleY = -1;

            // Placement 4: depth 17, matrix { scaleX:1, scaleY:-1, tx:-6.2, ty:-6.8 }
            const p4 = clip.attach(this.sprite32Sym, "sprite32_17", 17, ctx, {
              x: -6.2,
              y: -6.8,
            });
            p4.scaleX = 1;
            p4.scaleY = -1;

            // Placement 5: depth 21, matrix { scaleX:-1, scaleY:-1, tx:-1.7, ty:-29.8 }
            const p5 = clip.attach(this.sprite32Sym, "sprite32_21", 21, ctx, {
              x: -1.7,
              y: -29.8,
            });
            p5.scaleX = -1;
            p5.scaleY = -1;

            // Placement 6: depth 25, matrix { scaleX:1, scaleY:-1, tx:-7.2, ty:-25.8 }
            const p6 = clip.attach(this.sprite32Sym, "sprite32_25", 25, ctx, {
              x: -7.2,
              y: -25.8,
            });
            p6.scaleX = 1;
            p6.scaleY = -1;

            // Placement 7: depth 29, matrix { scaleX:1, scaleY:-1, tx:3.8, ty:-18.55 }
            const p7 = clip.attach(this.sprite32Sym, "sprite32_29", 29, ctx, {
              x: 3.8,
              y: -18.55,
            });
            p7.scaleX = 1;
            p7.scaleY = -1;
          },
        ],
        [
          63,
          () => {
            // AS: DefineSprite_33/frame_64/DoAction.as — SOMA.playSound("dodge_616b")
            this.playSound?.("dodge_616b");
          },
        ],
        [
          96,
          () => {
            // AS: DefineSprite_33/frame_97/DoAction.as — this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          101,
          (clip, ctx) => {
            // AS: DefineSprite_33/frame_102 places sprite31 at depth 7
            // matrix: { scaleX:1, scaleY:~1, translateX:-10.95, translateY:-31.9 }
            // CLIPACTIONRECORD onClipEvent(load): _rotation = random(360) (in sprite31.onLoad)
            if (!clip.children.has("sprite31_7")) {
              clip.attach(this.sprite31Sym, "sprite31_7", 7, ctx, {
                x: -10.95,
                y: -31.9,
              });
            }
          },
        ],
        [
          180,
          (clip) => {
            // AS: DefineSprite_33/frame_181/DoAction.as — _parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite29Sym);
    this.registry.register(this.sprite30Sym);
    this.registry.register(this.sprite31Sym);
    this.registry.register(this.sprite32Sym);
    this.registry.register(this.sprite20Sym);
    this.registry.register(this.sprite33Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture playSound for use inside frame scripts
    this.playSound = callbacks.playSound;

    // Main timeline frame_1 implicitly places sprite_20 and sprite_33.
    // frame_2/DoAction.as: stop() — main timeline halts; children tick independently.
    this.root.attach(this.sprite20Sym, "sprite20", 1, context);
    this.root.attach(this.sprite33Sym, "sprite33", 2, context);
  }
}
