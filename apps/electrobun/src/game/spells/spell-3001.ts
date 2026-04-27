/**
 * Spell 3001 — Élément Polyvalent (multi-element impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/3001/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no caster-anchored pieces,
 * no projectile motion, and no WorldAbsolute dual-anchor logic. All
 * visual content renders at the target cell. The main timeline is a
 * single `stop()` on frame_2 (no sound call, no explicit child
 * attaches from the main timeline — sprite_4, sprite_12, sprite_15,
 * sprite_26, and sprite_29 are placed statically on the authored SWF
 * timeline in frame_1). We attach them all in onSpellStart.
 *
 * Animation symbols (from animations[]):
 *   - sprite_4   — 63-frame composite fire burst at target. frame_1
 *                  seeds random rotation/scale/position/phase, installs
 *                  an onEnterFrame that slowly rotates with decaying vr.
 *                  frame_61 stops.
 *   - sprite_12  — 33-frame air/wind symbol. frame_1 seeds random
 *                  rotation/position/phase. frame_31 stops.
 *   - sprite_15  — 33-frame earth symbol. frame_1 seeds random
 *                  rotation/scale/position/phase. frame_31 stops.
 *   - sprite_26  — 42-frame water symbol. frame_1 seeds random
 *                  rotation/scale/position/phase. frame_40 stops.
 *   - sprite_29  — 40-frame composite container. Its frame_1 carries
 *                  a PlaceObject2 clip whose onClipEvent(load) reads
 *                  _parent._parent.params and conditionally spawns
 *                  part_f / part_w / part_e / part_a library particles.
 *                  frame_39 does _parent.removeMovieClip() — this is
 *                  the outermost removal, so we call runtime.complete()
 *                  there plus runtime.signalHit() (since displayType≠30/31).
 *
 * Library symbols (from librarySymbols[]):
 *   - part_f — single-frame fire particle. Attached by sprite_29's inner
 *              PlaceObject2 clip when params.fire == 1.
 *   - part_w — single-frame water particle. Attached when params.water == 1.
 *   - part_e — single-frame earth particle. Attached when params.earth == 1.
 *   - part_a — single-frame air particle. Attached when params.air == 1.
 *
 * The sprite_29 inner clip logic uses _parent._parent.params which in
 * our tree corresponds to: innerClip → sprite_29 → root. We resolve
 * params from root.vars.params.
 *
 * Main timeline: frame_2/DoAction.as → stop(). No sound.
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

// ---- Bounds for library symbols (from manifest.json librarySymbols[]) ----

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

// ---- Bounds for animation symbols (from manifest.json animations[]) ----

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
  // width/height are 0 in manifest; use identity anchor (0.5, 0.5)
  // offsetY: -17 is noted but with zero dimensions anchor calculation
  // would divide by zero — fall back to 0.5/0.5.
  width: 1,
  height: 1,
  offsetX: 0,
  offsetY: 0,
};

export class Spell3001 extends RuntimeSpell {
  readonly spellId = 3001;
  readonly displayType = SpellDisplayType.TargetCell;

  // Keep references so onSpellStart can attach them.
  private sprite4Sym!: SymbolDefinition;
  private sprite12Sym!: SymbolDefinition;
  private sprite15Sym!: SymbolDefinition;
  private sprite26Sym!: SymbolDefinition;
  private sprite29Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ----------------------------------------------------------------
    // Library symbols — particles spawned inside sprite_29's inner clip
    // ----------------------------------------------------------------

    const partFAnchor = calculateAnchor(PART_F_BOUNDS);
    const partFSym: SymbolDefinition = {
      name: "part_f",
      totalFrames: 1,
      frames: textures.getFrames("lib_part_f"),
      anchorX: partFAnchor.x,
      anchorY: partFAnchor.y,
      // No authored frame scripts or clip events for part_f — it is
      // a static single-frame symbol placed at the clip origin.
    };

    const partWAnchor = calculateAnchor(PART_W_BOUNDS);
    const partWSym: SymbolDefinition = {
      name: "part_w",
      totalFrames: 1,
      frames: textures.getFrames("lib_part_w"),
      anchorX: partWAnchor.x,
      anchorY: partWAnchor.y,
    };

    const partEAnchor = calculateAnchor(PART_E_BOUNDS);
    const partESym: SymbolDefinition = {
      name: "part_e",
      totalFrames: 1,
      frames: textures.getFrames("lib_part_e"),
      anchorX: partEAnchor.x,
      anchorY: partEAnchor.y,
    };

    const partAAnchor = calculateAnchor(PART_A_BOUNDS);
    const partASym: SymbolDefinition = {
      name: "part_a",
      totalFrames: 1,
      frames: textures.getFrames("lib_part_a"),
      anchorX: partAAnchor.x,
      anchorY: partAAnchor.y,
    };

    this.registry.register(partFSym);
    this.registry.register(partWSym);
    this.registry.register(partESym);
    this.registry.register(partASym);

    // ----------------------------------------------------------------
    // sprite_4 — 63-frame composite fire burst
    // AS: DefineSprite_4/frame_1/DoAction.as  (frameScripts[0])
    // AS: DefineSprite_4/frame_61/DoAction.as (frameScripts[60])
    // ----------------------------------------------------------------

    const sprite4Anchor = calculateAnchor(SPRITE_4_BOUNDS);
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
            clip.gotoAndPlay(Math.floor(Math.random() * 15)); // random(15)+1 → 0-based: random(15)
            const vr = Math.floor(Math.random() * 10);
            clip.vars.vr = vr;
            // AS: this.onEnterFrame = function() { _rotation += vr *= 0.9 }
            // Port as onEnterFrame on the clip itself via vars.
            clip.onEnterFrame = (c) => {
              // AS DefineSprite_4 onClipEvent(enterFrame) installed in frame_1
              let vrVal = c.vars.vr as number;
              vrVal *= 0.9;
              c.vars.vr = vrVal;
              c.rotation += (vrVal * Math.PI) / 180;
            };
          },
        ],
        [
          60,
          (clip) => {
            // AS DefineSprite_4/frame_61/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite_12 — 33-frame air/wind symbol
    // AS: DefineSprite_12/frame_1/DoAction.as  (frameScripts[0])
    // AS: DefineSprite_12/frame_31/DoAction.as (frameScripts[30])
    // ----------------------------------------------------------------

    const sprite12Anchor = calculateAnchor(SPRITE_12_BOUNDS);
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
            // AS: gotoAndPlay(random(10) + 1) → 0-based: random(10)
            clip.gotoAndPlay(Math.floor(Math.random() * 10));
          },
        ],
        [
          30,
          (clip) => {
            // AS DefineSprite_12/frame_31/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite_15 — 33-frame earth symbol
    // AS: DefineSprite_15/frame_1/DoAction.as  (frameScripts[0])
    // AS: DefineSprite_15/frame_31/DoAction.as (frameScripts[30])
    // ----------------------------------------------------------------

    const sprite15Anchor = calculateAnchor(SPRITE_15_BOUNDS);
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
            // AS: gotoAndPlay(random(10) + 1) → 0-based: random(10)
            clip.gotoAndPlay(Math.floor(Math.random() * 10));
          },
        ],
        [
          30,
          (clip) => {
            // AS DefineSprite_15/frame_31/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite_26 — 42-frame water symbol
    // AS: DefineSprite_26/frame_1/DoAction.as  (frameScripts[0])
    // AS: DefineSprite_26/frame_40/DoAction.as (frameScripts[39])
    // ----------------------------------------------------------------

    const sprite26Anchor = calculateAnchor(SPRITE_26_BOUNDS);
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
            // AS: gotoAndPlay(random(5) + 1) → 0-based: random(5)
            clip.gotoAndPlay(Math.floor(Math.random() * 5));
          },
        ],
        [
          39,
          (clip) => {
            // AS DefineSprite_26/frame_40/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite_29 — 40-frame composite container with inner particle spawner
    // AS: DefineSprite_29/frame_1/PlaceObject2_28_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_29/frame_39/DoAction.as
    //
    // The canonical AS places a sub-clip (PlaceObject2_28_1) at frame_1
    // whose onClipEvent(load) reads _parent._parent.params (i.e.
    // sprite_29's parent's parent = root) and conditionally spawns
    // part_f / part_w / part_e / part_a particles into ITSELF ("this").
    //
    // In the SpellClip model:
    //   innerClip (the PlaceObject2_28_1 clip) → sprite_29Clip → root
    //
    // We model the PlaceObject2_28_1 as a container-only SymbolDefinition
    // whose onLoad performs the particle spawning logic.
    // ----------------------------------------------------------------

    // Inner container for PlaceObject2_28_1 — no authored texture.
    const innerContainerSym: SymbolDefinition = {
      name: "inner_29",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_29/frame_1/PlaceObject2_28_1/CLIPACTIONRECORD onClipEvent(load).as
        //
        // _parent._parent = sprite_29's parent = root (in our tree:
        // clip → sprite_29Clip → root, so clip.parent?.parent === root).
        const sprite29Clip = clip.parent;
        const root = sprite29Clip?.parent;
        const params = (root?.vars.params ?? ctx.params) as
          | { fire: boolean; water: boolean; earth: boolean; air: boolean }
          | undefined;

        const fire = params?.fire === true ? 1 : 0;
        const water = params?.water === true ? 1 : 0;
        const earth = params?.earth === true ? 1 : 0;
        const air = params?.air === true ? 1 : 0;

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
          // c2++ not needed after last block
        }
      },
    };

    this.registry.register(innerContainerSym);

    this.sprite29Sym = {
      name: "sprite_29",
      totalFrames: 40,
      frames: textures.getFrames("sprite_29"),
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_29 frame_1 — the authored PlaceObject2_28_1
            // is placed here. We attach our inner container clip which
            // reproduces the onClipEvent(load) particle spawning logic.
            clip.attach(innerContainerSym, "inner_29", 28, ctx);
          },
        ],
        [
          38,
          (clip) => {
            // AS DefineSprite_29/frame_39/DoAction.as
            // _parent.removeMovieClip() — sprite_29 is the outermost
            // long-lived symbol; its removal drives spell completion.
            // We also fire signalHit here (displayType=11, not 30/31,
            // so the harness does not auto-signal).
            this.runtime.signalHit();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

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
    // Store params on root.vars so sprite_29's inner clip can reach them
    // via the _parent._parent.params traversal pattern.
    this.root.vars.params = context.params ?? {
      fire: false,
      water: false,
      earth: false,
      air: false,
    };

    // AS frame_2/DoAction.as: stop() — no sound on main timeline.
    // Attach the five authored timeline symbols that the canonical SWF
    // places statically in frame_1 of the main timeline.
    this.root.attach(this.sprite4Sym, "sprite_4", 1, context);
    this.root.attach(this.sprite12Sym, "sprite_12", 2, context);
    this.root.attach(this.sprite15Sym, "sprite_15", 3, context);
    this.root.attach(this.sprite26Sym, "sprite_26", 4, context);
    this.root.attach(this.sprite29Sym, "sprite_29", 5, context);
  }
}
