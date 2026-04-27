/**
 * Spell 2065 — (Cra fire arrow / bubble spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2065/scripts/scripts/
 *
 * displayType=51 (WorldAbsoluteAlt). The spell has TWO parallel authored timelines:
 *   - sprite_10 (48 frames): caster-side effect, positions itself at cellFrom, plays
 *     a "boo_up" sound, contains an inner sprite_9 that rotates to face the target.
 *   - sprite_11 (135 frames): target-side effect, positions itself at cellTo, rotates
 *     to angle, spawns 6 "bulle" particles at frame 70, signals hit at frame 70,
 *     and removes the outer mc at frame 133 (spell complete).
 *
 * Library symbols:
 *   - lib_bulle — single-frame bubble particle. onLoad seeds rx, ry, vx, vy, alpha,
 *     and jumps to a random frame. onEnterFrame integrates x/y with friction.
 *
 * Main timeline (frame_2/DoAction.as): SOMA.playSound("jet_903"); stop();
 * Main timeline also attaches sprite_10 and sprite_11 at frame 1 (implicit).
 *
 * sprite_10 (DefineSprite_10):
 *   frame_1: playSound("boo_up"); positions at cellFrom.x, cellFrom.y - 25.
 *   frame_46: stop().
 *   Its child sprite_9 (placed at frame_46): onLoad rotates to _parent._parent.angle.
 *   DefineSprite_9/frame_25: stop().
 *
 * sprite_11 (DefineSprite_11):
 *   frame_1: positions at cellTo.x, cellTo.y - 30; rotates to angle.
 *   frame_70: spawns 6 bulle particles (c=1..6); calls this.end() → signalHit.
 *   frame_133: _parent.removeMovieClip() → spell complete.
 *
 * bulle (DefineSprite_5_bulle):
 *   frame_1/DoAction.as: seeds rx, ry, vx, vy, alpha; attaches onEnterFrame.
 *   inner clip onLoad: gotoAndPlay(random(10) + 1).
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
  width: 215.5,
  height: 37.6,
  offsetX: -47.1,
  offsetY: -18.8,
};

const SPRITE_10_BOUNDS = {
  width: 215.5,
  height: 72.45,
  offsetX: -48.1,
  offsetY: -60,
};

const SPRITE_11_BOUNDS = {
  width: 238.5,
  height: 50.05,
  offsetX: -236.15,
  offsetY: -24.9,
};

export class Spell2065 extends RuntimeSpell {
  readonly spellId = 2065;
  readonly displayType = SpellDisplayType.WorldAbsoluteAlt;

  private bulleSym!: SymbolDefinition;
  private sprite4Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;

  private soundCallbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const bulleAnchor = calculateAnchor(BULLE_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE_4_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE_9_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE_10_BOUNDS);
    const sprite11Anchor = calculateAnchor(SPRITE_11_BOUNDS);

    // ---- lib_bulle — bubble particle spawned at target impact ----
    // AS: DefineSprite_5_bulle/frame_1/DoAction.as
    // AS: DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
    this.bulleSym = {
      name: "bulle",
      totalFrames: 1,
      frames: textures.getFrames("lib_bulle"),
      anchorX: bulleAnchor.x,
      anchorY: bulleAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as:
        //   gotoAndPlay(random(10) + 1);
        const targetFrame = Math.floor(Math.random() * 10) + 1;
        clip.gotoAndPlay(targetFrame - 1);
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_5_bulle/frame_1/DoAction.as:
            //   rx = 0.7 + 0.15 * Math.random();
            //   ry = 0.8 + 0.15 * Math.random();
            //   vx = 20 + random(25);
            //   vy = -15 + random(30);
            //   _alpha = random(50) + 50;
            //   this.onEnterFrame = function() { _X += vx *= rx; _Y += vy *= ry; };
            clip.vars.rx = 0.7 + 0.15 * Math.random();
            clip.vars.ry = 0.8 + 0.15 * Math.random();
            clip.vars.vx = 20 + Math.floor(Math.random() * 25);
            clip.vars.vy = -15 + Math.floor(Math.random() * 30);
            clip.alpha = (Math.floor(Math.random() * 50) + 50) / 100;
            clip.onEnterFrame = (c) => {
              // AS onEnterFrame: _X += vx *= rx; _Y += vy *= ry;
              let vx = c.vars.vx as number;
              let vy = c.vars.vy as number;
              const rx = c.vars.rx as number;
              const ry = c.vars.ry as number;
              vx *= rx;
              vy *= ry;
              c.x += vx;
              c.y += vy;
              c.vars.vx = vx;
              c.vars.vy = vy;
            };
          },
        ],
      ]),
    };

    // ---- sprite_4 — small caster-side sprite (54 frames) --------
    // No authored scripts other than frame_52/DoAction.as: stop().
    // Positioned by the outer container (sprite_10).
    this.sprite4Sym = {
      name: "sprite_4",
      totalFrames: 54,
      frames: textures.getFrames("sprite_4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      frameScripts: new Map([
        [
          51,
          (clip) => {
            // AS DefineSprite_4/frame_52/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_9 — inner sprite inside sprite_10 (27 frames) ---
    // Placed as a child of sprite_10 at frame_46 via PlaceObject2.
    // Its onLoad: _rotation = _parent._parent.angle (degrees).
    // frame_25: stop().
    this.sprite9Sym = {
      name: "sprite_9",
      totalFrames: 27,
      frames: textures.getFrames("sprite_9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_10/frame_46/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as:
        //   _rotation = _parent._parent.angle;
        // clip's parent is sprite_10; sprite_10's parent is root.
        const root = clip.parent?.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        clip.rotation = (angleDeg * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          24,
          (clip) => {
            // AS DefineSprite_9/frame_25/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_10 — caster-side timeline (48 frames) -----------
    // AS DefineSprite_10/frame_1/DoAction.as: SOMA.playSound("boo_up");
    // AS DefineSprite_10/frame_1/DoAction_2.as: _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 25;
    // At frame_46: stop(); + sprite_9 is placed as child with onLoad rotation.
    // NOTE: The sound "boo_up" is played in the context of this sprite's frame_1.
    // We capture it via the callbacks stored in onSpellStart.
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
            // AS DefineSprite_10/frame_1/DoAction.as: SOMA.playSound("boo_up");
            this.soundCallbacks?.playSound("boo_up");
            // AS DefineSprite_10/frame_1/DoAction_2.as:
            //   _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 25;
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 25;
            }
            // Attach sprite_4 as visual child (authored PlaceObject2 at frame_1)
            clip.attach(this.sprite4Sym, "sprite_4", 1, ctx);
          },
        ],
        [
          45,
          (clip, ctx) => {
            // AS DefineSprite_10/frame_46/DoAction.as: stop();
            // Also: PlaceObject2 places sprite_9 at this frame with onLoad.
            clip.stop();
            clip.attach(this.sprite9Sym, "sprite_9", 1, ctx);
          },
        ],
      ]),
    };

    // ---- sprite_11 — target-side timeline (135 frames) ----------
    // AS DefineSprite_11/frame_1/DoAction.as:
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 30; _rotation = _parent.angle;
    // AS DefineSprite_11/frame_70/DoAction.as:
    //   c = 1; while(c < 7) { this.attachMovie("bulle","bulle"+c,c); c++; }
    // AS DefineSprite_11/frame_70/DoAction_2.as: this.end(); (→ signalHit)
    // AS DefineSprite_11/frame_133/DoAction.as: _parent.removeMovieClip();
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
            //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 30; _rotation = _parent.angle;
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
            //   c = 1; while(c < 7) { this.attachMovie("bulle","bulle"+c,c); c++; }
            for (let c = 1; c < 7; c++) {
              clip.attach(this.bulleSym, `bulle${c}`, c, ctx);
            }
            // AS DefineSprite_11/frame_70/DoAction_2.as: this.end(); → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          132,
          (clip) => {
            // AS DefineSprite_11/frame_133/DoAction.as: _parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.bulleSym);
    this.registry.register(this.sprite4Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite11Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Store callbacks so sprite_10's frame_1 script can play "boo_up".
    this.soundCallbacks = callbacks;

    // AS frame_2/DoAction.as: SOMA.playSound("jet_903"); stop();
    callbacks.playSound("jet_903");

    // Implicit main-timeline frame_1 placement of sprite_10 and sprite_11.
    this.root.attach(this.sprite10Sym, "sprite_10", 1, context);
    this.root.attach(this.sprite11Sym, "sprite_11", 2, context);
  }
}
