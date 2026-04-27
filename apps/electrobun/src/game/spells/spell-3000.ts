/**
 * Spell 3000 — Triade / Multi-Element (Xelor / Eliotrope composite).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/3000/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no caster reference, no
 * projectile motion, no beam line — it is a pure impact at the target
 * cell. The main timeline has a single `stop()` on frame_2 (no sound).
 *
 * Layout:
 *   - sprite_4   (63-frame composite)   — per-particle rotating fire
 *       burst. frame_1 seeds random rotation/scale/position, sets a
 *       spinning onEnterFrame (vr decays by 0.9). frame_61 stops.
 *   - sprite_12  (33-frame)             — air/water element hit.
 *       frame_1 seeds random rotation/position/phase.
 *       frame_31 stops.
 *   - sprite_15  (33-frame)             — earth element hit.
 *       frame_1 seeds random rotation/scale/position/phase.
 *       frame_31 stops.
 *   - sprite_26  (42-frame)             — fire slash streak.
 *       frame_1 seeds random rotation/scale/position/phase.
 *       frame_40 stops.
 *   - sprite_29  (60-frame, composite)  — outer controller driving
 *       element particle spawning. frame_1 onClipEvent(load) reads
 *       _parent._parent.params to determine which element particles
 *       to attach (part_f / part_w / part_e / part_a). frame_58
 *       does _parent.removeMovieClip() + stop() → spell complete.
 *
 * Library symbols (used by sprite_29's onClipEvent(load)):
 *   - part_f  — fire particle    (single frame)
 *   - part_w  — water particle   (single frame)
 *   - part_e  — earth particle   (single frame)
 *   - part_a  — air particle     (single frame)
 *
 * The sprite_29 container is the outermost timeline; its frame_58
 * removes the parent (the outer mc) and signals completion.
 * signalHit is fired from sprite_29 frame_1 onLoad (once particles
 * are spawned — canonical impact point).
 *
 * Main timeline: frame_2/DoAction.as → stop() only. No sound.
 * All four display sprites (sprite_4, sprite_12, sprite_15, sprite_26,
 * sprite_29) are attached from onSpellStart at the canonical root.
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

// ---- Manifest bounds for library symbols ----
const PART_F_BOUNDS = {
  width: 29.35,
  height: 27.6,
  offsetX: -4.5,
  offsetY: -18,
};
const PART_W_BOUNDS = {
  width: 49.75,
  height: 48.4,
  offsetX: -14,
  offsetY: -35.05,
};
const PART_E_BOUNDS = {
  width: 61.75,
  height: 60.6,
  offsetX: -16.3,
  offsetY: -25.95,
};
const PART_A_BOUNDS = {
  width: 32.2,
  height: 37.45,
  offsetX: -29,
  offsetY: -37.45,
};

// ---- Manifest bounds for animation symbols ----
const SPRITE_4_BOUNDS = {
  width: 78.3,
  height: 101,
  offsetX: -41.15,
  offsetY: -94.25,
};
const SPRITE_12_BOUNDS = {
  width: 37.2,
  height: 66.85,
  offsetX: -11,
  offsetY: -62.55,
};
const SPRITE_15_BOUNDS = {
  width: 102.25,
  height: 121.35,
  offsetX: -16.8,
  offsetY: -87.3,
};
const SPRITE_26_BOUNDS = {
  width: 108.45,
  height: 18.75,
  offsetX: -110.35,
  offsetY: -18.3,
};
const SPRITE_29_BOUNDS = {
  width: 0,
  height: 0,
  offsetX: 0,
  offsetY: -17,
};

export class Spell3000 extends RuntimeSpell {
  readonly spellId = 3000;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite4Sym!: SymbolDefinition;
  private sprite12Sym!: SymbolDefinition;
  private sprite15Sym!: SymbolDefinition;
  private sprite26Sym!: SymbolDefinition;
  private sprite29Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ---- Library symbol anchors ----
    const partFAnchor = calculateAnchor(PART_F_BOUNDS);
    const partWAnchor = calculateAnchor(PART_W_BOUNDS);
    const partEAnchor = calculateAnchor(PART_E_BOUNDS);
    const partAAnchor = calculateAnchor(PART_A_BOUNDS);

    // ---- Animation symbol anchors ----
    const sprite4Anchor = calculateAnchor(SPRITE_4_BOUNDS);
    const sprite12Anchor = calculateAnchor(SPRITE_12_BOUNDS);
    const sprite15Anchor = calculateAnchor(SPRITE_15_BOUNDS);
    const sprite26Anchor = calculateAnchor(SPRITE_26_BOUNDS);

    // ---- part_f — fire particle (single frame) ----
    // No frame scripts or clip events — pure visual.
    const partFSym: SymbolDefinition = {
      name: "part_f",
      totalFrames: 1,
      frames: textures.getFrames("lib_part_f"),
      anchorX: partFAnchor.x,
      anchorY: partFAnchor.y,
    };

    // ---- part_w — water particle (single frame) ----
    const partWSym: SymbolDefinition = {
      name: "part_w",
      totalFrames: 1,
      frames: textures.getFrames("lib_part_w"),
      anchorX: partWAnchor.x,
      anchorY: partWAnchor.y,
    };

    // ---- part_e — earth particle (single frame) ----
    const partESym: SymbolDefinition = {
      name: "part_e",
      totalFrames: 1,
      frames: textures.getFrames("lib_part_e"),
      anchorX: partEAnchor.x,
      anchorY: partEAnchor.y,
    };

    // ---- part_a — air particle (single frame) ----
    const partASym: SymbolDefinition = {
      name: "part_a",
      totalFrames: 1,
      frames: textures.getFrames("lib_part_a"),
      anchorX: partAAnchor.x,
      anchorY: partAAnchor.y,
    };

    // ---- sprite_4 — rotating element composite (63 frames) ----
    // AS DefineSprite_4/frame_1/DoAction.as:
    //   _rotation = random(360);
    //   t = 20 + 60 * Math.random();
    //   _xscale = t; _yscale = t;
    //   _X = 20 * (Math.random() - 0.5); _Y = 20 * (Math.random() - 0.5);
    //   gotoAndPlay(random(15) + 1);
    //   vr = random(10);
    //   this.onEnterFrame = function() { _rotation = _rotation + (vr *= 0.9); };
    //
    // AS DefineSprite_4/frame_61/DoAction.as: stop();
    this.sprite4Sym = {
      name: "sprite_4",
      totalFrames: 63,
      frames: textures.getFrames("sprite_4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_4/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            const t = 20 + 60 * Math.random();
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.x = 20 * (Math.random() - 0.5);
            clip.y = 20 * (Math.random() - 0.5);
            clip.gotoAndPlay(Math.floor(Math.random() * 15));
            clip.vars.vr = Math.floor(Math.random() * 10);
            clip.onEnterFrame = (c) => {
              // AS: _rotation = _rotation + (vr *= 0.9)
              let vr = c.vars.vr as number;
              vr *= 0.9;
              c.vars.vr = vr;
              c.rotation += (vr * Math.PI) / 180;
            };
          },
        ],
        [
          60,
          (clip) => {
            // AS DefineSprite_4/frame_61/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_12 — element hit (33 frames) ----
    // AS DefineSprite_12/frame_1/DoAction.as:
    //   _rotation = random(360);
    //   _X = 20 * (Math.random() - 0.5); _Y = 20 * (Math.random() - 0.5);
    //   gotoAndPlay(random(10) + 1);
    //
    // AS DefineSprite_12/frame_31/DoAction.as: stop();
    this.sprite12Sym = {
      name: "sprite_12",
      totalFrames: 33,
      frames: textures.getFrames("sprite_12"),
      anchorX: sprite12Anchor.x,
      anchorY: sprite12Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_12/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            clip.x = 20 * (Math.random() - 0.5);
            clip.y = 20 * (Math.random() - 0.5);
            clip.gotoAndPlay(Math.floor(Math.random() * 10));
          },
        ],
        [
          30,
          (clip) => {
            // AS DefineSprite_12/frame_31/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_15 — earth element hit (33 frames) ----
    // AS DefineSprite_15/frame_1/DoAction.as:
    //   _rotation = random(360);
    //   _X = 20 * (Math.random() - 0.5); _Y = 20 * (Math.random() - 0.5);
    //   t = 60 * Math.random();
    //   _xscale = t; _yscale = t;
    //   gotoAndPlay(random(10) + 1);
    //
    // AS DefineSprite_15/frame_31/DoAction.as: stop();
    this.sprite15Sym = {
      name: "sprite_15",
      totalFrames: 33,
      frames: textures.getFrames("sprite_15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_15/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            clip.x = 20 * (Math.random() - 0.5);
            clip.y = 20 * (Math.random() - 0.5);
            const t = 60 * Math.random();
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.gotoAndPlay(Math.floor(Math.random() * 10));
          },
        ],
        [
          30,
          (clip) => {
            // AS DefineSprite_15/frame_31/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_26 — fire slash streak (42 frames) ----
    // AS DefineSprite_26/frame_1/DoAction.as:
    //   _rotation = random(360);
    //   _X = 20 * (Math.random() - 0.5); _Y = 20 * (Math.random() - 0.5);
    //   t = 60 * Math.random();
    //   _xscale = t; _yscale = t;
    //   gotoAndPlay(random(5) + 1);
    //
    // AS DefineSprite_26/frame_40/DoAction.as: stop();
    this.sprite26Sym = {
      name: "sprite_26",
      totalFrames: 42,
      frames: textures.getFrames("sprite_26"),
      anchorX: sprite26Anchor.x,
      anchorY: sprite26Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_26/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            clip.x = 20 * (Math.random() - 0.5);
            clip.y = 20 * (Math.random() - 0.5);
            const t = 60 * Math.random();
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.gotoAndPlay(Math.floor(Math.random() * 5));
          },
        ],
        [
          39,
          (clip) => {
            // AS DefineSprite_26/frame_40/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_29 — outer controller (60 frames) ----
    // AS DefineSprite_29/frame_1/PlaceObject2_28_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   Reads _parent._parent.params.{fire,water,earth,air} to determine
    //   which element particles to spawn, and how many (14 - 3*fire - 3*water
    //   - 3*earth - 3*air), attaches part_f / part_w / part_e / part_a.
    //
    // AS DefineSprite_29/frame_58/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    //
    // The onClipEvent(load) is implemented as onLoad on the symbol
    // definition. The inner PlaceObject2_28_1 is the clip that carries
    // the load event — it's a child placed inside sprite_29 at frame_1.
    // Since we treat sprite_29 as a single SpellClip, we fire the load
    // logic from the sprite_29 onLoad handler, which runs when sprite_29
    // is attached (matching canonical Flash behaviour: child clips with
    // load events fire on the same tick the parent is placed).
    this.sprite29Sym = {
      name: "sprite_29",
      totalFrames: 60,
      frames: textures.getFrames("sprite_29"),
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_29/frame_1/PlaceObject2_28_1/CLIPACTIONRECORD onClipEvent(load).as
        // _parent._parent refers to the outer mc (root) which holds params.
        // In our tree: clip (sprite_29) → parent (root).
        const params = ctx.params;
        const fire = params?.fire ? 1 : 0;
        const water = params?.water ? 1 : 0;
        const earth = params?.earth ? 1 : 0;
        const air = params?.air ? 1 : 0;
        const n = 14 - 3 * fire - 3 * water - 3 * earth - 3 * air;

        let c2 = 100;

        if (fire === 1) {
          let c = c2;
          while (c < c2 + n) {
            clip.attach(partFSym, "part_f" + c, c, ctx);
            c++;
          }
          c2++;
        }
        if (water === 1) {
          let c = c2;
          while (c < c2 + n) {
            clip.attach(partWSym, "part_w" + c, c, ctx);
            c++;
          }
          c2++;
        }
        if (earth === 1) {
          let c = c2;
          while (c < c2 + n) {
            clip.attach(partESym, "part_e" + c, c, ctx);
            c++;
          }
          c2++;
        }
        if (air === 1) {
          let c = c2;
          while (c < c2 + n) {
            clip.attach(partASym, "part_a" + c, c, ctx);
            c++;
          }
          c2++;
        }

        // Signal hit when particles are spawned (canonical impact point).
        this.runtime.signalHit();
      },
      frameScripts: new Map([
        [
          57,
          (clip) => {
            // AS DefineSprite_29/frame_58/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(partFSym);
    this.registry.register(partWSym);
    this.registry.register(partESym);
    this.registry.register(partASym);
    this.registry.register(this.sprite4Sym);
    this.registry.register(this.sprite12Sym);
    this.registry.register(this.sprite15Sym);
    this.registry.register(this.sprite26Sym);
    this.registry.register(this.sprite29Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_2/DoAction.as: stop() — no sound on main timeline.
    // Attach the authored timeline children at the root so they start
    // ticking from the next runtime frame.
    // The canonical SWF places sprite_4, sprite_12, sprite_15, sprite_26,
    // and sprite_29 on the main timeline at frame_1.
    this.root.attach(this.sprite4Sym, "sprite4", 1, context);
    this.root.attach(this.sprite12Sym, "sprite12", 2, context);
    this.root.attach(this.sprite15Sym, "sprite15", 3, context);
    this.root.attach(this.sprite26Sym, "sprite26", 4, context);
    this.root.attach(this.sprite29Sym, "sprite29", 5, context);
  }
}
