/**
 * Spell 2013 — Boo (Osamodas bubble/ghost spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2013/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Two parallel authored timelines:
 *   - sprite_10 (48 frames) — caster-side: positions at cellFrom, plays
 *     "boo_up" sound on frame_1, stops at frame_46. At frame_46 a child
 *     sprite_9 (DefineSprite_9) is placed with onClipEvent(load) that
 *     sets its rotation to _parent._parent.angle.
 *   - sprite_11 (90 frames) — target-side: positions at cellTo on frame_1,
 *     rotates to angle. At frame_47 spawns 6 "bulle" particles + signals
 *     hit (this.end()). At frame_58 and frame_66 places faded "sprite5"
 *     instances at specific offsets. At frame_89 removes the outer mc →
 *     spell complete.
 *
 * Library symbols:
 *   - bulle — bubble particle. frame_1/DoAction.as seeds rx/ry/vx/vy/alpha
 *     and defines onEnterFrame to drift with friction. The inner sprite_4
 *     (PlaceObject2_4_1) has onClipEvent(load) that calls gotoAndPlay with
 *     a random start frame (random(15)+1).
 *   - sprite5 — directlyDynamic clipEvent bubble variant (same characterId 5
 *     as bulle). Placed at specific positions inside sprite_11 at frames 58
 *     and 66 with reduced alpha (46/256). Shares the same frame_1 DoAction
 *     physics seeding and onEnterFrame drift as bulle. Inner PlaceObject2_4_1
 *     onClipEvent(load) randomizes start frame of inner sprite_4.
 *
 * Main timeline: frame_2 plays "jet_903" + stop(). frame_1 implicitly
 * places sprite_10 and sprite_11 — attached in onSpellStart.
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

// Bounds from manifest.json librarySymbols[] — "bulle"
const BULLE_BOUNDS = {
  width: 28,
  height: 30.65,
  offsetX: -16.6,
  offsetY: -14.85,
};

// Bounds from manifest.json librarySymbols[] — "sprite5" (same characterId as bulle)
const SPRITE5_BOUNDS = {
  width: 28,
  height: 30.65,
  offsetX: -16.6,
  offsetY: -14.85,
};

// Bounds from manifest.json animations[] — sprite_4 (inner child of bulle/sprite5)
const SPRITE_4_BOUNDS = {
  width: 19.5,
  height: 21.35,
  offsetX: -11.55,
  offsetY: -10.35,
};

// Bounds from manifest.json animations[] — sprite_9 (inner child of sprite_10)
const SPRITE_9_BOUNDS = {
  width: 214.45,
  height: 36.7,
  offsetX: -47,
  offsetY: -18.35,
};

// Bounds from manifest.json animations[] — sprite_10 (caster-side)
const SPRITE_10_BOUNDS = {
  width: 214.45,
  height: 62.75,
  offsetX: -48,
  offsetY: -60.05,
};

// Bounds from manifest.json animations[] — sprite_11 (target-side)
const SPRITE_11_BOUNDS = {
  width: 237.45,
  height: 50.05,
  offsetX: -236.15,
  offsetY: -24.9,
};

export class Spell2013 extends RuntimeSpell {
  readonly spellId = 2013;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite4Sym!: SymbolDefinition;
  private bulleSym!: SymbolDefinition;
  private sprite5Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite4Anchor = calculateAnchor(SPRITE_4_BOUNDS);
    const bulleAnchor = calculateAnchor(BULLE_BOUNDS);
    const sprite5Anchor = calculateAnchor(SPRITE5_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE_9_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE_10_BOUNDS);
    const sprite11Anchor = calculateAnchor(SPRITE_11_BOUNDS);

    // ---- sprite_4 — inner animated sprite inside bulle / sprite5 ----
    // AS: DefineSprite_4/frame_52/DoAction.as — stop()
    // AS: DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(15) + 1)
    this.sprite4Sym = {
      name: "sprite_4",
      totalFrames: 54,
      frames: textures.getFrames("sprite_4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndPlay(random(15) + 1)
        const startFrame = Math.floor(Math.random() * 15) + 1;
        clip.gotoAndPlay(startFrame - 1);
      },
      frameScripts: new Map([
        [
          51,
          (clip) => {
            // AS: DefineSprite_4/frame_52/DoAction.as — stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- lib_bulle — bubble particle attached by sprite_11 at frame_47 --
    // AS: DefineSprite_5_bulle/frame_1/DoAction.as
    //   rx = 0.7 + 0.15 * Math.random()
    //   ry = 0.8 + 0.15 * Math.random()
    //   vx = 20 + random(25)
    //   vy = -15 + random(30)
    //   _alpha = random(50) + 50
    //   this.onEnterFrame = function() { _X += (vx *= rx); _Y += (vy *= ry); }
    this.bulleSym = {
      name: "bulle",
      totalFrames: 1,
      frames: textures.getFrames("lib_bulle"),
      anchorX: bulleAnchor.x,
      anchorY: bulleAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_5_bulle/frame_1/DoAction.as
            clip.vars.rx = 0.7 + 0.15 * Math.random();
            clip.vars.ry = 0.8 + 0.15 * Math.random();
            clip.vars.vx = 20 + Math.floor(Math.random() * 25);
            clip.vars.vy = -15 + Math.floor(Math.random() * 30);
            clip.alpha = (Math.floor(Math.random() * 50) + 50) / 100;
            // Place the inner sprite_4 animation inside bulle (PlaceObject2_4_1)
            clip.attach(this.sprite4Sym, "sprite4_inner", 1, ctx);
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS: DefineSprite_5_bulle/frame_1/DoAction.as — this.onEnterFrame
        // _X = _X + (vx *= rx); _Y = _Y + (vy *= ry)
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const rx = clip.vars.rx as number;
        const ry = clip.vars.ry as number;
        vx *= rx;
        vy *= ry;
        clip.x += vx;
        clip.y += vy;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- sprite5 — directlyDynamic clipEvent bubble variant --------
    // Same characterId (5) as bulle, same physics, but placed at specific
    // positions inside sprite_11 at frames 58 (depth 5) and 66 (depth 1)
    // with alphaMult=46/256 ≈ 0.18 and scale ~1.2 / ~1.63 respectively.
    //
    // AS: DefineSprite_5_bulle/frame_1/DoAction.as (shared with bulle)
    //   rx/ry/vx/vy/alpha seeding + onEnterFrame drift physics
    // AS: DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(15) + 1) — randomises inner sprite_4 start frame
    this.sprite5Sym = {
      name: "sprite5",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_5_bulle/frame_1/DoAction.as
            clip.vars.rx = 0.7 + 0.15 * Math.random();
            clip.vars.ry = 0.8 + 0.15 * Math.random();
            clip.vars.vx = 20 + Math.floor(Math.random() * 25);
            clip.vars.vy = -15 + Math.floor(Math.random() * 30);
            // Alpha from DoAction.as: random(50) + 50 — but placement
            // colorTransform.alphaMult=46 overrides it at attach time.
            // We apply the placement alpha in the parent frameScripts
            // after attaching, matching canonical Flash execution order
            // (PlaceObject2 colorTransform is applied by the player
            // before onLoad / frame scripts run on the placed clip).
            clip.alpha = (Math.floor(Math.random() * 50) + 50) / 100;
            // Place inner sprite_4 (PlaceObject2_4_1 onClipEvent(load))
            clip.attach(this.sprite4Sym, "sprite4_inner", 1, ctx);
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS: DefineSprite_5_bulle/frame_1/DoAction.as — this.onEnterFrame
        // _X = _X + (vx *= rx); _Y = _Y + (vy *= ry)
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const rx = clip.vars.rx as number;
        const ry = clip.vars.ry as number;
        vx *= rx;
        vy *= ry;
        clip.x += vx;
        clip.y += vy;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- sprite_9 — inner composite inside sprite_10, placed at frame_46 --
    // AS: DefineSprite_9/frame_17/DoAction.as — stop()
    // AS: DefineSprite_10/frame_46/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
    //   _rotation = _parent._parent.angle
    this.sprite9Sym = {
      name: "sprite_9",
      totalFrames: 18,
      frames: textures.getFrames("sprite_9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_10/frame_46/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
        // _rotation = _parent._parent.angle
        // _parent is sprite_10, _parent._parent is the outer mc (root).
        const sprite10 = clip.parent;
        const root = sprite10?.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        clip.rotation = (angleDeg * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          16,
          (clip) => {
            // AS: DefineSprite_9/frame_17/DoAction.as — stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_10 — caster-side 48-frame timeline ---------------
    // AS: DefineSprite_10/frame_1/DoAction.as — SOMA.playSound("boo_up")
    // AS: DefineSprite_10/frame_1/DoAction_2.as
    //   _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 25
    // AS: DefineSprite_10/frame_46/DoAction.as — stop()
    // PlaceObject2_9_1 at frame_46 places sprite_9 inside sprite_10
    this.sprite10Sym = {
      name: "sprite_10",
      totalFrames: 48,
      frames: textures.getFrames("sprite_10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_10/frame_1/DoAction_2.as
            // _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 25
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 25;
            }
          },
        ],
        [
          45,
          (clip, ctx) => {
            // AS: DefineSprite_10/frame_46/DoAction.as — stop()
            // PlaceObject2_9_1 at frame_46 places sprite_9 inside sprite_10.
            // onClipEvent(load) fires and sets _rotation = _parent._parent.angle
            clip.attach(this.sprite9Sym, "sprite9_1", 1, ctx);
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_11 — target-side 90-frame timeline ---------------
    // AS: DefineSprite_11/frame_1/DoAction.as
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 30; _rotation = _parent.angle
    // AS: DefineSprite_11/frame_47/DoAction.as
    //   c = 1; while(c < 7) { this.attachMovie("bulle","bulle"+c,c); c++ }
    // AS: DefineSprite_11/frame_47/DoAction_2.as — this.end() → signalHit
    // manifest librarySymbols sprite5 placements inside sprite_11:
    //   frame 58 (0-based 57), depth 5, matrix translateX=-80.8 translateY=-0.9,
    //     scaleX=scaleY=1.1988, alphaMult=46
    //   frame 66 (0-based 65), depth 1, matrix translateX=-36 translateY=-0.65,
    //     scaleX=scaleY=1.6329, alphaMult=46
    // AS: DefineSprite_11/frame_89/DoAction.as — _parent.removeMovieClip()
    this.sprite11Sym = {
      name: "sprite_11",
      totalFrames: 90,
      frames: textures.getFrames("sprite_11"),
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_11/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 30
            // _rotation = _parent.angle
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y - 30;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          46,
          (clip, ctx) => {
            // AS: DefineSprite_11/frame_47/DoAction.as
            // c = 1; while(c < 7) { this.attachMovie("bulle","bulle"+c,c); c++ }
            for (let c = 1; c < 7; c++) {
              clip.attach(this.bulleSym, `bulle${c}`, c, ctx);
            }
            // AS: DefineSprite_11/frame_47/DoAction_2.as — this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          57,
          (clip, ctx) => {
            // manifest librarySymbols sprite5 placement at frame 58 (0-based 57)
            // depth 5, translateX=-80.8, translateY=-0.9, scaleX=scaleY=1.1988,
            // alphaMult=46 (46/256 ≈ 0.18)
            const child = clip.attach(this.sprite5Sym, "sprite5_58", 5, ctx, {
              x: -80.8,
              y: -0.9,
            });
            child.scaleX = 1.1988372802734375;
            child.scaleY = 1.1988372802734375;
            child.alpha = 46 / 256;
          },
        ],
        [
          65,
          (clip, ctx) => {
            // manifest librarySymbols sprite5 placement at frame 66 (0-based 65)
            // depth 1, translateX=-36, translateY=-0.65, scaleX=scaleY=1.6329,
            // alphaMult=46 (46/256 ≈ 0.18)
            const child = clip.attach(this.sprite5Sym, "sprite5_66", 1, ctx, {
              x: -36,
              y: -0.65,
            });
            child.scaleX = 1.632904052734375;
            child.scaleY = 1.632904052734375;
            child.alpha = 46 / 256;
          },
        ],
        [
          88,
          (clip) => {
            // AS: DefineSprite_11/frame_89/DoAction.as — _parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite4Sym);
    this.registry.register(this.bulleSym);
    this.registry.register(this.sprite5Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite11Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline frame_2/DoAction.as: SOMA.playSound("jet_903"); stop()
    // DefineSprite_10/frame_1/DoAction.as: SOMA.playSound("boo_up")
    // Both sounds fire at spell start per the manifest sounds[] entries
    // (frame 0 = "boo_up", frame 1 = "jet_903").
    callbacks.playSound("boo_up");
    callbacks.playSound("jet_903");

    // Implicit main-timeline frame_1 placement of sprite_10 and sprite_11.
    // displayType=50 (WorldAbsolute) — root is at world (0,0).
    // Each sub-sprite positions itself at cellFrom/cellTo in their frame_1.
    this.root.attach(this.sprite10Sym, "sprite10", 1, context);
    this.root.attach(this.sprite11Sym, "sprite11", 2, context);
  }
}
