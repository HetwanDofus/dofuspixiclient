/**
 * Spell 2066 — Boo (Eniripsa bubble spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2066/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The spell has TWO parallel authored
 * timelines anchored at different world positions:
 *   - sprite_10 (DefineSprite_10): caster-side timeline (46 frames).
 *     frame_1 positions self at cellFrom, plays "boo_up" sound.
 *     Contains an inner sprite_9 (DefineSprite_9) placed at frame_46
 *     via PlaceObject2; sprite_9's onClipEvent(load) sets its rotation
 *     to _parent._parent.angle (i.e. root.vars.angle).
 *     sprite_9 has 27 frames (stops at frame 25).
 *   - sprite_11 (DefineSprite_11): target-side animated container (135 frames).
 *     frame_1 positions self at cellTo, rotates to angle.
 *     frame_70 spawns 6 "bulle" bubble particles + signals hit.
 *     frame_87 places sprite5 instance (depth 5, scaled ~1.2×, alpha ~18%).
 *     frame_99 places sprite5 instance (depth 1, scaled ~1.63×, alpha ~18%).
 *     frame_133 calls _parent.removeMovieClip() → spell complete.
 *
 * Library symbols:
 *   - bulle (DefineSprite_5_bulle) — single-frame bubble particle.
 *     frame_1/DoAction.as seeds rx, ry, vx, vy, alpha + onEnterFrame drift.
 *     PlaceObject2_4_1 onClipEvent(load): gotoAndPlay(random(10)+1).
 *   - sprite5 (DefineSprite_5, directlyDynamic, clipEvent) — same character
 *     as bulle but exported as a separate dynamic symbol. Two placements
 *     inside sprite_11: frame 87 (depth 5, scale 1.2, tx=-80.8, ty=-0.9,
 *     alpha=46/256) and frame 99 (depth 1, scale 1.63, tx=-36, ty=-0.65,
 *     alpha=46/256). onLoad: gotoAndPlay(random(10)+1). onEnterFrame: drift
 *     physics identical to bulle (rx/ry/vx/vy).
 *
 * Main timeline (frame_2/DoAction.as): SOMA.playSound("jet_903"); stop();
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

const BULLE_BOUNDS = {
  width: 28,
  height: 30.65,
  offsetX: -16.6,
  offsetY: -14.85,
};

// sprite5 shares characterId 5 with bulle — same visual bounds.
const SPRITE5_BOUNDS = {
  width: 28,
  height: 30.65,
  offsetX: -16.6,
  offsetY: -14.85,
};

const SPRITE9_BOUNDS = {
  width: 215.5,
  height: 37.6,
  offsetX: -47.1,
  offsetY: -18.8,
};

const SPRITE10_BOUNDS = {
  width: 215.5,
  height: 72.45,
  offsetX: -48.1,
  offsetY: -60,
};

const SPRITE11_BOUNDS = {
  width: 238.5,
  height: 50.05,
  offsetX: -236.15,
  offsetY: -24.9,
};

const SPRITE4_BOUNDS = {
  width: 19.5,
  height: 21.35,
  offsetX: -11.55,
  offsetY: -10.35,
};

export class Spell2066 extends RuntimeSpell {
  readonly spellId = 2066;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite10Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;
  private cachedPlaySound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const bulleAnchor = calculateAnchor(BULLE_BOUNDS);
    const sprite5Anchor = calculateAnchor(SPRITE5_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE10_BOUNDS);
    const sprite11Anchor = calculateAnchor(SPRITE11_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE4_BOUNDS);

    // ---- sprite_4 (DefineSprite_4) — small caster decorative sprite -------
    // frame_52/DoAction.as: stop()
    const sprite4Sym: SymbolDefinition = {
      name: "sprite_4",
      totalFrames: 54,
      frames: textures.getFrames("sprite_4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      frameScripts: new Map([
        [
          51,
          (clip) => {
            // AS DefineSprite_4/frame_52/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- bulle (DefineSprite_5_bulle) — bubble particle -------------------
    // AS DefineSprite_5_bulle/frame_1/DoAction.as seeds physics vars.
    // AS DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD
    //   onClipEvent(load): gotoAndPlay(random(10) + 1)
    // The inner PlaceObject2_4_1 is the sprite_4 sub-clip whose only authored
    // behavior is to jump to a random start frame. We model this by applying
    // the random gotoAndPlay on the bulle clip in onLoad.
    const bulleSym: SymbolDefinition = {
      name: "bulle",
      totalFrames: 1,
      frames: textures.getFrames("lib_bulle"),
      anchorX: bulleAnchor.x,
      anchorY: bulleAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD
        // onClipEvent(load): gotoAndPlay(random(10) + 1)
        // 0-based: random(10) + 1 - 1 = random(10)
        const startFrame = Math.floor(Math.random() * 10);
        clip.gotoAndPlay(startFrame);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_5_bulle/frame_1/DoAction.as onEnterFrame:
        //   _X = _X + (vx *= rx); _Y = _Y + (vy *= ry)
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        const rx = clip.vars.rx as number;
        const ry = clip.vars.ry as number;
        const newVx = vx * rx;
        const newVy = vy * ry;
        clip.x += newVx;
        clip.y += newVy;
        clip.vars.vx = newVx;
        clip.vars.vy = newVy;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_5_bulle/frame_1/DoAction.as:
            //   rx = 0.7 + 0.15 * Math.random()
            //   ry = 0.8 + 0.15 * Math.random()
            //   vx = 20 + random(25)
            //   vy = -15 + random(30)
            //   _alpha = random(50) + 50
            clip.vars.rx = 0.7 + 0.15 * Math.random();
            clip.vars.ry = 0.8 + 0.15 * Math.random();
            clip.vars.vx = 20 + Math.floor(Math.random() * 25);
            clip.vars.vy = -15 + Math.floor(Math.random() * 30);
            clip.alpha = (Math.floor(Math.random() * 50) + 50) / 100;
          },
        ],
      ]),
    };

    // ---- sprite5 (DefineSprite_5, directlyDynamic clipEvent) --------------
    // Same characterId as bulle (character 5). Exported separately because
    // the combat-exporter stripped it from sprite_11's pre-rendered SVG.
    // Two placements inside sprite_11 (parentSpriteId: 11):
    //   frame 87 (0-based: 86), depth 5: scale=1.1988, tx=-80.8, ty=-0.9,
    //                                     alphaMult=46 → alpha=46/256≈0.18
    //   frame 99 (0-based: 98), depth 1: scale=1.6329, tx=-36, ty=-0.65,
    //                                     alphaMult=46 → alpha=46/256≈0.18
    //
    // onLoad (from DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD):
    //   gotoAndPlay(random(10) + 1)
    // onEnterFrame (from DefineSprite_5_bulle/frame_1/DoAction.as):
    //   _X += (vx *= rx); _Y += (vy *= ry)
    // frameScripts[0] seeds the physics vars (same as bulle frame_1 DoAction).
    const sprite5Sym: SymbolDefinition = {
      name: "sprite5",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD
        // onClipEvent(load): gotoAndPlay(random(10) + 1)
        // 0-based: random(10) + 1 - 1 = random(10)
        const startFrame = Math.floor(Math.random() * 10);
        clip.gotoAndPlay(startFrame);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_5_bulle/frame_1/DoAction.as onEnterFrame:
        //   _X = _X + (vx *= rx); _Y = _Y + (vy *= ry)
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        const rx = clip.vars.rx as number;
        const ry = clip.vars.ry as number;
        const newVx = vx * rx;
        const newVy = vy * ry;
        clip.x += newVx;
        clip.y += newVy;
        clip.vars.vx = newVx;
        clip.vars.vy = newVy;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_5_bulle/frame_1/DoAction.as:
            //   rx = 0.7 + 0.15 * Math.random()
            //   ry = 0.8 + 0.15 * Math.random()
            //   vx = 20 + random(25)
            //   vy = -15 + random(30)
            //   _alpha = random(50) + 50
            clip.vars.rx = 0.7 + 0.15 * Math.random();
            clip.vars.ry = 0.8 + 0.15 * Math.random();
            clip.vars.vx = 20 + Math.floor(Math.random() * 25);
            clip.vars.vy = -15 + Math.floor(Math.random() * 30);
            clip.alpha = (Math.floor(Math.random() * 50) + 50) / 100;
          },
        ],
      ]),
    };

    // ---- sprite_9 (DefineSprite_9) — inner rotated beam inside sprite_10 --
    // Placed at frame_46 of sprite_10 (PlaceObject2_9_1).
    // onClipEvent(load): _rotation = _parent._parent.angle
    //   _parent = sprite_10, _parent._parent = root (outer mc)
    // frame_25/DoAction.as: stop()
    const sprite9Sym: SymbolDefinition = {
      name: "sprite_9",
      totalFrames: 27,
      frames: textures.getFrames("sprite_9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_10/frame_46/PlaceObject2_9_1/CLIPACTIONRECORD
        // onClipEvent(load): _rotation = _parent._parent.angle
        // _parent of sprite_9 = sprite_10; _parent._parent = root
        const sprite10 = clip.parent;
        const root = sprite10?.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        clip.rotation = (angleDeg * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          24,
          (clip) => {
            // AS DefineSprite_9/frame_25/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_10 (DefineSprite_10) — caster-side timeline (46 frames) ---
    // frame_1/DoAction.as:   SOMA.playSound("boo_up")
    // frame_1/DoAction_2.as: _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 25
    // frame_46/DoAction.as:  stop()
    // frame_46 also places sprite_9 (PlaceObject2_9_1) with onClipEvent(load)
    this.sprite10Sym = {
      name: "sprite_10",
      totalFrames: 46,
      frames: textures.getFrames("sprite_10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_10/frame_1/DoAction.as + DoAction_2.as:
            //   SOMA.playSound("boo_up")
            //   _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 25
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 25;
            }
            this.cachedPlaySound?.("boo_up");
          },
        ],
        [
          45,
          (clip, ctx) => {
            // AS DefineSprite_10/frame_46/DoAction.as: stop()
            // Also: PlaceObject2_9_1 places sprite_9 at this frame.
            // onLoad fires immediately via attach(), setting rotation to angle.
            clip.stop();
            clip.attach(sprite9Sym, "sprite9", 1, ctx);
          },
        ],
      ]),
    };

    // ---- sprite_11 (DefineSprite_11) — target-side timeline (135 frames) --
    // frame_1/DoAction.as:
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 30
    //   _rotation = _parent.angle
    // frame_70/DoAction.as:
    //   c = 1; while(c < 7) { attachMovie("bulle","bulle"+c,c); c++ }
    // frame_70/DoAction_2.as: this.end() → signalHit
    // frame_87 (0-based: 86): place sprite5 at depth 5, matrix tx=-80.8 ty=-0.9
    //   scale=1.1988, alphaMult=46/256
    // frame_99 (0-based: 98): place sprite5 at depth 1, matrix tx=-36 ty=-0.65
    //   scale=1.6329, alphaMult=46/256
    // frame_133/DoAction.as: _parent.removeMovieClip() → complete
    this.sprite11Sym = {
      name: "sprite_11",
      totalFrames: 135,
      frames: textures.getFrames("sprite_11"),
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_11/frame_1/DoAction.as:
            //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 30
            //   _rotation = _parent.angle
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
          69,
          (clip, ctx) => {
            // AS DefineSprite_11/frame_70/DoAction.as:
            //   c = 1; while(c < 7) { attachMovie("bulle","bulle"+c,c); c++ }
            // AS DefineSprite_11/frame_70/DoAction_2.as: this.end() → signalHit
            for (let c = 1; c < 7; c++) {
              clip.attach(bulleSym, `bulle${c}`, c, ctx);
            }
            this.runtime.signalHit();
          },
        ],
        [
          86,
          (clip, ctx) => {
            // Placement from manifest librarySymbols sprite5 placements[0]:
            //   parentSpriteId: 11, frame: 87 (0-based: 86), depth: 5
            //   matrix: scaleX=1.1988, scaleY=1.1988, tx=-80.8, ty=-0.9
            //   colorTransform: alphaMult=46 → alpha=46/256
            const child = clip.attach(sprite5Sym, "sprite5_d5", 5, ctx, {
              x: -80.8,
              y: -0.9,
            });
            child.scaleX = 1.1988372802734375;
            child.scaleY = 1.1988372802734375;
            child.alpha = 46 / 256;
          },
        ],
        [
          98,
          (clip, ctx) => {
            // Placement from manifest librarySymbols sprite5 placements[1]:
            //   parentSpriteId: 11, frame: 99 (0-based: 98), depth: 1
            //   matrix: scaleX=1.6329, scaleY=1.6329, tx=-36, ty=-0.65
            //   colorTransform: alphaMult=46 → alpha=46/256
            const child = clip.attach(sprite5Sym, "sprite5_d1", 1, ctx, {
              x: -36,
              y: -0.65,
            });
            child.scaleX = 1.632904052734375;
            child.scaleY = 1.632904052734375;
            child.alpha = 46 / 256;
          },
        ],
        [
          132,
          (clip) => {
            // AS DefineSprite_11/frame_133/DoAction.as:
            //   _parent.removeMovieClip()
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite4Sym);
    this.registry.register(bulleSym);
    this.registry.register(sprite5Sym);
    this.registry.register(sprite9Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite11Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Cache for use inside frame scripts that need to play sounds.
    this.cachedPlaySound = callbacks.playSound;

    // AS frame_2/DoAction.as (main timeline): SOMA.playSound("jet_903"); stop();
    callbacks.playSound("jet_903");

    // Attach the two parallel authored timelines — mirrors implicit main-
    // timeline placement of sprite_10 and sprite_11 at frame_1.
    this.root.attach(this.sprite10Sym, "sprite10", 1, context);
    this.root.attach(this.sprite11Sym, "sprite11", 2, context);
  }
}
