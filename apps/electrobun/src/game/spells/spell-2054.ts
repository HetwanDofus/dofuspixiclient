/**
 * Spell 2054 — (Cra/plant-type linear projectile with impact burst).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2054/scripts/scripts/
 *
 * displayType=51 (WorldAbsoluteAlt). Detected because:
 *   - DefineSprite_10/frame_1/DoAction_2.as explicitly sets:
 *       _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 25;
 *     and reads _parent.cellTo for dx/dy — both cellFrom AND cellTo used
 *     from _parent, indicating the container is at world (0,0).
 *   - DefineSprite_13/frame_1/DoAction.as similarly does:
 *       _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
 *   - No "move" + "shoot" projectile arc pattern, no "duplicate" beam.
 *   - Two parallel authored timelines (sprite_10 at caster, sprite_13 at
 *     target), each positioning themselves in world coordinates.
 *   - This matches exactly the WorldAbsolute / WorldAbsoluteAlt pattern.
 *
 * Library symbols:
 *   - sprite5 (bulle) — directlyDynamic: true, 1-frame bubble particle.
 *     Placed twice inside sprite_13:
 *       frame 29 (0-based 28), depth 7: matrix tx=-80.8, ty=-0.9, scale=1.199,
 *                                        alphaMult=46/256
 *       frame 33 (0-based 32), depth 3: matrix tx=-36.0, ty=-0.65, scale=1.633,
 *                                        alphaMult=46/256
 *     onLoad: gotoAndPlay(random(15) + 1) — phase randomization.
 *     frame_1 DoAction: rx/ry/vx/vy/_alpha seeded; onEnterFrame drifts X/Y.
 *
 * Authored timeline sprites (animations[], container symbols):
 *   - sprite_4  (54f) — small detail, stop at frame 52.
 *   - sprite_9  (27f) — beam/line element inside sprite_10; onLoad sets
 *                       _rotation = _parent.angle; stop at frame 25.
 *   - sprite_10 (48f) — caster-side composite (positions at cellFrom, holds
 *                       sprite_9 placed at frame 46).
 *   - sprite_12 (12f) — circular burst, onLoad sets _rotation =
 *                       -_parent._parent.angle; stop at frame 12.
 *   - sprite_13 (45f) — target-side composite (positions at cellTo, holds
 *                       sprite_12 placed at frame 24, sprite5 at 29 and 33).
 *                       frame 24: signalHit + playSound("coquille").
 *                       frame 45: _parent.removeMovieClip() → complete().
 *
 * Main timeline frame_2: SOMA.playSound("jet_903"); stop();
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

// Bounds from manifest librarySymbols[] entry for sprite5 (the "bulle" particle)
const BULLE_BOUNDS = {
  width: 28,
  height: 30.65,
  offsetX: -16.6,
  offsetY: -14.85,
};

// Bounds for the authored animations (container symbols)
const SPRITE_9_BOUNDS = {
  width: 215.4,
  height: 37.85,
  offsetX: -47.2,
  offsetY: -19.15,
};
const SPRITE_10_BOUNDS = {
  width: 215.4,
  height: 86.6,
  offsetX: -48.2,
  offsetY: -74.15,
};
const SPRITE_12_BOUNDS = {
  width: 127.9,
  height: 127.9,
  offsetX: -63.95,
  offsetY: -63.95,
};
const SPRITE_13_BOUNDS = {
  width: 279.7,
  height: 50.05,
  offsetX: -236.15,
  offsetY: -24.9,
};

export class Spell2054 extends RuntimeSpell {
  readonly spellId = 2054;
  readonly displayType = SpellDisplayType.WorldAbsoluteAlt;

  // Hold symbol references so onSpellStart can attach them
  private sprite10Sym!: SymbolDefinition;
  private sprite13Sym!: SymbolDefinition;

  // Hold sound callback for use inside frame scripts
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    // ---- lib_sprite5 (bulle) — bubble drift particle ----------------
    // directlyDynamic: true — owns CLIPACTIONRECORD handlers.
    //
    // AS: scripts/DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(15) + 1);
    //
    // AS: scripts/DefineSprite_5_bulle/frame_1/DoAction.as
    //   rx = 0.7 + 0.15 * Math.random();
    //   ry = 0.8 + 0.15 * Math.random();
    //   vx = 20 + random(25);
    //   vy = -15 + random(30);
    //   _alpha = random(50) + 50;
    //   this.onEnterFrame = function() {
    //     _X = _X + (vx *= rx);
    //     _Y = _Y + (vy *= ry);
    //   };
    //
    // Placements (from manifest librarySymbols[0].placements[]):
    //   [0]: parentSpriteId=13, frame=29 (0-based 28), depth=7,
    //        matrix: tx=-80.8, ty=-0.9, scale=1.199, alphaMult=46
    //   [1]: parentSpriteId=13, frame=33 (0-based 32), depth=3,
    //        matrix: tx=-36.0, ty=-0.65, scale=1.633, alphaMult=46
    const bulleAnchor = calculateAnchor(BULLE_BOUNDS);
    const bulleSym: SymbolDefinition = {
      name: "sprite5",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite5"),
      anchorX: bulleAnchor.x,
      anchorY: bulleAnchor.y,
      // AS: DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/onClipEvent(load)
      //   gotoAndPlay(random(15) + 1);
      onLoad: (clip) => {
        // random(15) → 0..14; gotoAndPlay(1..15) → 0-based 0..14
        const frame = Math.floor(Math.random() * 15);
        clip.gotoAndPlay(frame);
      },
      // AS: DefineSprite_5_bulle/frame_1/DoAction.as — per-tick drift
      //   _X = _X + (vx *= rx);
      //   _Y = _Y + (vy *= ry);
      onEnterFrame: (clip) => {
        const vxRaw = clip.vars.vx as number | undefined;
        // Skip until frame_1 DoAction has seeded the physics vars
        if (vxRaw === undefined) {
          return;
        }
        const rx = clip.vars.rx as number;
        const ry = clip.vars.ry as number;
        let vx = vxRaw * rx;
        let vy = (clip.vars.vy as number) * ry;
        clip.x += vx;
        clip.y += vy;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_5_bulle/frame_1/DoAction.as
            //   rx = 0.7 + 0.15 * Math.random();
            //   ry = 0.8 + 0.15 * Math.random();
            //   vx = 20 + random(25);
            //   vy = -15 + random(30);
            //   _alpha = random(50) + 50;
            clip.vars.rx = 0.7 + 0.15 * Math.random();
            clip.vars.ry = 0.8 + 0.15 * Math.random();
            clip.vars.vx = 20 + Math.floor(Math.random() * 25);
            clip.vars.vy = -15 + Math.floor(Math.random() * 30);
            clip.alpha = (Math.floor(Math.random() * 50) + 50) / 100;
          },
        ],
      ]),
    };

    // ---- sprite_9 — beam/line element inside sprite_10 ---------------
    // Authored 27-frame composite. frame_25 → stop().
    // PlaceObject2_9_1 onClipEvent(load): _rotation = _parent.angle;
    // Placed by DefineSprite_10 at frame_46 (0-based index 45).
    const sprite9Anchor = calculateAnchor(SPRITE_9_BOUNDS);
    const sprite9Sym: SymbolDefinition = {
      name: "sprite_9",
      totalFrames: 27,
      frames: textures.getFrames("sprite_9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      // AS: DefineSprite_10/frame_46/PlaceObject2_9_1/onClipEvent(load)
      //   _rotation = _parent.angle;
      onLoad: (clip) => {
        const parent = clip.parent;
        const angleDeg = (parent?.vars.angle as number) ?? 0;
        clip.rotation = (angleDeg * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          24,
          (clip) => {
            // AS: DefineSprite_9/frame_25/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_12 — circular burst at target inside sprite_13 -------
    // Authored 12-frame simple. frame_12 → stop().
    // PlaceObject2_12_1 onClipEvent(load): _rotation = -_parent._parent.angle;
    // Placed by DefineSprite_13 at frame_24 (0-based index 23).
    const sprite12Anchor = calculateAnchor(SPRITE_12_BOUNDS);
    const sprite12Sym: SymbolDefinition = {
      name: "sprite_12",
      totalFrames: 12,
      frames: textures.getFrames("sprite_12"),
      anchorX: sprite12Anchor.x,
      anchorY: sprite12Anchor.y,
      // AS: DefineSprite_13/frame_24/PlaceObject2_12_1/onClipEvent(load)
      //   _rotation = - _parent._parent.angle;
      // sprite_12's parent is sprite_13; sprite_13's parent is root.
      onLoad: (clip) => {
        const sprite13 = clip.parent;
        const root = sprite13?.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        clip.rotation = (-angleDeg * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          11,
          (clip) => {
            // AS: DefineSprite_12/frame_12/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_10 — caster-side composite (48f) ----------------------
    // frame_1 (index 0):
    //   DoAction.as:   SOMA.playSound("herbe")
    //   DoAction_2.as: _rotation = 0; _X = _parent.cellFrom.x;
    //                  _Y = _parent.cellFrom.y - 25;
    //                  dx = _parent.cellTo.x - _parent.cellFrom.x;
    //                  dy = _parent.cellTo.y - _parent.cellFrom.y + 25;
    //                  angle = Math.atan2(dy,dx) * 180 / 3.1415;
    // frame_46 (index 45): stop(); attach sprite_9 at depth 1.
    const sprite10Anchor = calculateAnchor(SPRITE_10_BOUNDS);
    this.sprite10Sym = {
      name: "sprite_10",
      totalFrames: 48,
      frames: textures.getFrames("sprite_10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_10/frame_1/DoAction.as
            //   SOMA.playSound("herbe");
            this.soundCallback?.("herbe");

            // AS: DefineSprite_10/frame_1/DoAction_2.as
            //   _rotation = 0;
            //   _X = _parent.cellFrom.x;
            //   _Y = _parent.cellFrom.y - 25;
            //   dx = _parent.cellTo.x - _parent.cellFrom.x;
            //   dy = _parent.cellTo.y - _parent.cellFrom.y + 25;
            //   angle = Math.atan2(dy, dx) * 180 / 3.1415;
            clip.rotation = 0;
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 25;
            }
            if (cellFrom && cellTo) {
              const dx = cellTo.x - cellFrom.x;
              const dy = cellTo.y - cellFrom.y + 25;
              const angleDeg = (Math.atan2(dy, dx) * 180) / 3.1415;
              clip.vars.angle = angleDeg;
            }
            void ctx;
          },
        ],
        [
          45,
          (clip, ctx) => {
            // AS: DefineSprite_10/frame_46/DoAction.as → stop()
            // PlaceObject2_9_1 is placed at this frame.
            clip.stop();
            clip.attach(sprite9Sym, "sprite_9_1", 1, ctx);
          },
        ],
      ]),
    };

    // ---- sprite_13 — target-side composite (45f) ----------------------
    // frame_1 (index 0):
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    //   _rotation = _parent.angle;
    // frame_24 (index 23):
    //   DoAction.as:   this.end() → signalHit
    //   DoAction_2.as: SOMA.playSound("coquille")
    //   Places sprite_12 at depth 1 via PlaceObject2_12_1.
    // frame_29 (index 28):
    //   Places sprite5 at depth 7 via PlaceObject2 (from placements[0]):
    //     matrix: tx=-80.8, ty=-0.9, scaleX=scaleY=1.199, alphaMult=46/256
    // frame_33 (index 32):
    //   Places sprite5 at depth 3 via PlaceObject2 (from placements[1]):
    //     matrix: tx=-36.0, ty=-0.65, scaleX=scaleY=1.633, alphaMult=46/256
    // frame_45 (index 44):
    //   _parent.removeMovieClip() → complete()
    const sprite13Anchor = calculateAnchor(SPRITE_13_BOUNDS);
    this.sprite13Sym = {
      name: "sprite_13",
      totalFrames: 45,
      frames: textures.getFrames("sprite_13"),
      anchorX: sprite13Anchor.x,
      anchorY: sprite13Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_13/frame_1/DoAction.as
            //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
            //   _rotation = _parent.angle;
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          23,
          (clip, ctx) => {
            // AS: DefineSprite_13/frame_24/DoAction.as → this.end() (signalHit)
            // AS: DefineSprite_13/frame_24/DoAction_2.as → SOMA.playSound("coquille")
            // PlaceObject2_12_1 places sprite_12 at depth 1 at this frame.
            this.runtime.signalHit();
            this.soundCallback?.("coquille");
            clip.attach(sprite12Sym, "sprite_12_1", 1, ctx);
          },
        ],
        [
          28,
          (clip, ctx) => {
            // Placement from manifest librarySymbols[0].placements[0]:
            //   parentSpriteId=13, frame=29 (0-based 28), depth=7
            //   matrix: tx=-80.8, ty=-0.9, scaleX=1.199, scaleY=1.199
            //   colorTransform: alphaMult=46  (46/256 ≈ 0.18)
            const inst = clip.attach(bulleSym, "bulle_7", 7, ctx, {
              x: -80.8,
              y: -0.9,
            });
            inst.scaleX = 1.1988372802734375;
            inst.scaleY = 1.1988372802734375;
            inst.alpha = 46 / 256;
          },
        ],
        [
          32,
          (clip, ctx) => {
            // Placement from manifest librarySymbols[0].placements[1]:
            //   parentSpriteId=13, frame=33 (0-based 32), depth=3
            //   matrix: tx=-36.0, ty=-0.65, scaleX=1.633, scaleY=1.633
            //   colorTransform: alphaMult=46  (46/256 ≈ 0.18)
            const inst = clip.attach(bulleSym, "bulle_3", 3, ctx, {
              x: -36.0,
              y: -0.65,
            });
            inst.scaleX = 1.632904052734375;
            inst.scaleY = 1.632904052734375;
            inst.alpha = 46 / 256;
          },
        ],
        [
          44,
          (clip) => {
            // AS: DefineSprite_13/frame_45/DoAction.as
            //   _parent.removeMovieClip();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // Register all symbols
    this.registry.register(bulleSym);
    this.registry.register(sprite9Sym);
    this.registry.register(sprite12Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite13Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Store sound callback for use inside frame scripts
    this.soundCallback = callbacks.playSound;

    // AS: scripts/frame_2/DoAction.as → SOMA.playSound("jet_903"); stop();
    callbacks.playSound("jet_903");

    // Attach the two parallel authored timelines at the root.
    // sprite_10 positions itself at cellFrom in its frame_1.
    // sprite_13 positions itself at cellTo in its frame_1.
    this.root.attach(this.sprite10Sym, "sprite10", 1, context);
    this.root.attach(this.sprite13Sym, "sprite13", 2, context);
  }
}
