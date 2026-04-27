/**
 * Spell 2013 — (Boo-up / Jet 903 combo, WorldAbsolute-style).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2013/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Two parallel authored timelines are placed
 * on the main timeline: sprite_10 (caster-side, 48 frames) and sprite_11
 * (target-side, 90 frames). Both read _parent.cellFrom / _parent.cellTo and
 * position themselves at WORLD coords in their frame_1 — the canonical
 * WorldAbsolute pattern. The container sits at world (0,0) and children
 * are positioned at absolute screen coords from cellFrom / cellTo.
 *
 * Additionally, sprite_9 (18 frames) is a sub-sprite nested inside
 * sprite_10 (placed via PlaceObject2 at frame_46 with onClipEvent(load)
 * that reads _parent._parent.angle). It is registered as a library-style
 * symbol and attached by sprite_10's frame_46 script.
 *
 * sprite_4 (54 frames) is another sub-sprite nested inside sprite_11 —
 * its canonical role is part of the target-side impact composite.
 * It has only a stop() at frame_52.
 *
 * Library symbols:
 *   - bulle — single-frame bubble particle. onLoad jumps to random frame
 *     1-15 and seeds rx/ry/vx/vy/alpha; onEnterFrame drifts with damping.
 *     Spawned 6× inside sprite_11 at frame_47.
 *
 * Main timeline:
 *   - frame_1: plays sound "boo_up" (from DefineSprite_10/frame_1/DoAction.as)
 *   - frame_2: SOMA.playSound("jet_903"); stop()
 *   Both sprites (sprite_10 + sprite_11) are attached in onSpellStart.
 *
 * Completion: sprite_11/frame_89 calls _parent.removeMovieClip() → complete().
 * Hit signal: sprite_11/frame_47 calls this.end() → signalHit().
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

const SPRITE_4_BOUNDS = {
  width: 19.5,
  height: 21.35,
  offsetX: -11.55,
  offsetY: -10.35,
};

const SPRITE_9_BOUNDS = {
  width: 214.45,
  height: 36.7,
  offsetX: -47,
  offsetY: -18.35,
};

const SPRITE_10_BOUNDS = {
  width: 214.45,
  height: 62.75,
  offsetX: -48,
  offsetY: -60.05,
};

const SPRITE_11_BOUNDS = {
  width: 237.45,
  height: 50.05,
  offsetX: -236.15,
  offsetY: -24.9,
};

export class Spell2013 extends RuntimeSpell {
  readonly spellId = 2013;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite10Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const bulleAnchor = calculateAnchor(BULLE_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE_4_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE_9_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE_10_BOUNDS);
    const sprite11Anchor = calculateAnchor(SPRITE_11_BOUNDS);

    // ---- lib_bulle — bubble particle spawned at impact --------------
    // AS: DefineSprite_5_bulle/frame_1/DoAction.as
    //     DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
    const bulleSym: SymbolDefinition = {
      name: "bulle",
      totalFrames: 1,
      frames: textures.getFrames("lib_bulle"),
      anchorX: bulleAnchor.x,
      anchorY: bulleAnchor.y,
      onLoad: (clip, ctx) => {
        // AS: DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndPlay(random(15) + 1)
        clip.gotoAndPlay(Math.floor(Math.random() * 15));

        // AS: DefineSprite_5_bulle/frame_1/DoAction.as
        // rx = 0.7 + 0.15 * Math.random()
        // ry = 0.8 + 0.15 * Math.random()
        // vx = 20 + random(25)
        // vy = -15 + random(30)
        // _alpha = random(50) + 50
        clip.vars.rx = 0.7 + 0.15 * Math.random();
        clip.vars.ry = 0.8 + 0.15 * Math.random();
        clip.vars.vx = 20 + Math.floor(Math.random() * 25);
        clip.vars.vy = -15 + Math.floor(Math.random() * 30);
        clip.alpha = (Math.floor(Math.random() * 50) + 50) / 100;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_5_bulle/frame_1/DoAction.as — this.onEnterFrame
        // _X = _X + (vx *= rx)
        // _Y = _Y + (vy *= ry)
        const rx = clip.vars.rx as number;
        const ry = clip.vars.ry as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        vx *= rx;
        vy *= ry;
        clip.x += vx;
        clip.y += vy;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- sprite_4 — sub-sprite inside sprite_11 (target-side composite)
    // AS: DefineSprite_4/frame_52/DoAction.as → stop()
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
            // AS: DefineSprite_4/frame_52/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_9 — sub-sprite inside sprite_10 (caster-side) ------
    // AS: DefineSprite_9/frame_17/DoAction.as → stop()
    // AS: DefineSprite_10/frame_46/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
    //     _rotation = _parent._parent.angle
    const sprite9Sym: SymbolDefinition = {
      name: "sprite_9",
      totalFrames: 18,
      frames: textures.getFrames("sprite_9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_10/frame_46/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
        // _rotation = _parent._parent.angle
        // _parent is sprite_10 clip, _parent._parent is the root (outer mc)
        const root = clip.parent?.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        clip.rotation = (angleDeg * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          16,
          (clip) => {
            // AS: DefineSprite_9/frame_17/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_10 — caster-side timeline (48 frames) ---------------
    // AS: DefineSprite_10/frame_1/DoAction.as → SOMA.playSound("boo_up")
    // AS: DefineSprite_10/frame_1/DoAction_2.as → _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 25
    // AS: DefineSprite_10/frame_46/DoAction.as → stop()
    // (sprite_9 is placed via PlaceObject2 at frame_46 internally — we attach it in frame 45 script)
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
            // AS: DefineSprite_10/frame_1/DoAction.as + DoAction_2.as
            // playSound handled by onSpellStart (main timeline)
            // _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 25
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 25;
            }
            // Attach sprite_9 which is placed on the authored timeline
            // at frame_1 via PlaceObject2 (it starts playing immediately)
            clip.attach(sprite9Sym, "sprite_9", 1, ctx);
          },
        ],
        [
          45,
          (clip) => {
            // AS: DefineSprite_10/frame_46/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_11 — target-side timeline (90 frames) ---------------
    // AS: DefineSprite_11/frame_1/DoAction.as
    //     _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 30; _rotation = _parent.angle
    // AS: DefineSprite_11/frame_47/DoAction.as
    //     c = 1; while(c < 7) { this.attachMovie("bulle","bulle"+c,c); c++ }
    // AS: DefineSprite_11/frame_47/DoAction_2.as
    //     this.end() → signalHit
    // AS: DefineSprite_11/frame_89/DoAction.as
    //     _parent.removeMovieClip() → complete
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
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 30; _rotation = _parent.angle
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
              clip.attach(bulleSym, `bulle${c}`, c, ctx);
            }
            // AS: DefineSprite_11/frame_47/DoAction_2.as
            // this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          88,
          (clip) => {
            // AS: DefineSprite_11/frame_89/DoAction.as
            // _parent.removeMovieClip() → spell complete
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(bulleSym);
    this.registry.register(sprite4Sym);
    this.registry.register(sprite9Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite11Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: DefineSprite_10/frame_1/DoAction.as → SOMA.playSound("boo_up")
    // AS: scripts/frame_2/DoAction.as → SOMA.playSound("jet_903"); stop()
    callbacks.playSound("boo_up");
    callbacks.playSound("jet_903");

    // Attach the two parallel authored timelines to the root.
    // displayType=50 (WorldAbsolute): container at (0,0); each sprite
    // positions itself at world coords from cellFrom / cellTo in its frame_1.
    this.root.attach(this.sprite10Sym, "sprite10", 1, context);
    this.root.attach(this.sprite11Sym, "sprite11", 2, context);
  }
}
