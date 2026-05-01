/**
 * Spell 304 — Tremblement de Terre (Sacrieur / Earth).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/304/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main SWF places sprite_54 (the
 * outer composite) whose frame_1 positions itself at cellTo in world
 * coords — the canonical pattern for WorldAbsolute spells. The harness
 * stores cellFrom/cellTo/angle on root.vars and leaves the container at
 * world origin (0,0); per-spell scripts position children at absolute
 * world coords.
 *
 * Canonical AS layout:
 *
 *   - sprite_54 (197 frames, outer composite) — placed by onSpellStart
 *       at root depth 1. Acts as the orchestrator.
 *       frame_1/DoAction.as:  positions self at cellTo.
 *       frame_1/PlaceObject2_9_1/onClipEvent(enterFrame): over the first
 *           20 frames, attaches one "pierres" particle per tick.
 *       frame_7/DoAction.as:  sets haut=1 on self (high-arc physics).
 *       frame_10/DoAction.as: SOMA.playSound("grina_709") + signalHit.
 *       frame_10/PlaceObject2_9_81/onClipEvent(load): bulk-attaches
 *           15 "pierres" (depths 100-114) + 20 "or" (depths 200-219).
 *       frame_84/DoAction.as: SOMA.playSound("setag_301").
 *       frame_195/DoAction.as: _parent.removeMovieClip() → complete.
 *
 *   - lib_pierres — tiny stone particle (1 frame). clipEvents:
 *       onLoad: seeds vx/vy (scatter), t (scale 60-100), alpha
 *           (20-109), v (upward velocity), vr (rotation drift ±20 deg).
 *           Also randomises parent x/y position (±10 / ±5).
 *       onEnterFrame: integrates physics (gravity 1.5/tick), rotates
 *           by vr, bounces at Y=0; when settled (t==1) fades alpha and
 *           removes parent when alpha≤5.
 *
 *   - lib_or — empty/invisible 1-frame gold-dust particle. No runtime
 *       clip event scripts — pure visual stub.
 *
 *   - lib_sprite8 (terre, characterId=8) — earth geyser visual (1 frame).
 *       onEnterFrame: bounces Y with gravity (v increments by 1/tick,
 *           resets to random negative on ground contact).
 *       No onLoad script in AS; v initialised to 0.
 *
 * Library symbols registered: "pierres", "or", "sprite8", "sprite_54".
 *
 * Signal timing:
 *   - signalHit: frame_10 (index 9) of sprite_54 (the impact burst).
 *   - complete:  frame_195 (index 194) of sprite_54.
 *
 * Main timeline: frame_2/DoAction.as → stop(). No looping timeline at root.
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

const PIERRES_BOUNDS = {
  width: 6.4,
  height: 3.85,
  offsetX: -3.2,
  offsetY: -2.2,
};

const SPRITE8_BOUNDS = {
  width: 46.95,
  height: 88,
  offsetX: -24.3,
  offsetY: -64.4,
};

const SPRITE54_BOUNDS = {
  width: 66.35,
  height: 364.9,
  offsetX: -33.6,
  offsetY: -246,
};

export class Spell304 extends RuntimeSpell {
  readonly spellId = 304;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  // Sound callback stored at onSpellStart time for use inside frameScripts.
  private playSound: ((id: string) => void) | null = null;

  // Symbol definitions stored as fields so frameScripts closures can reference them.
  private pierresSym!: SymbolDefinition;
  private orSym!: SymbolDefinition;
  private sprite8Sym!: SymbolDefinition;
  private sprite54Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const sprite8Anchor = calculateAnchor(SPRITE8_BOUNDS);
    const sprite54Anchor = calculateAnchor(SPRITE54_BOUNDS);

    // ---- lib_pierres — stone particle ----------------------------
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // In the AS tree: the innermost clip (the one with clipEvents) is
    // a child of a container placed at various depths inside sprite_54.
    // The onLoad does `_parent._x = ...` / `_parent._y = ...` — i.e.
    // moves the container. In our model we create a thin wrapper
    // SymbolDefinition for each placement; the pierres clip's
    // onLoad walks clip.parent to move that wrapper.
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
        //    CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.vx = 2 * (Math.random() - 0.5);
        clip.vars.vy = 1 * (Math.random() - 0.5);

        // _parent._x = 20*(Math.random()-0.5); _parent._y = 10*(Math.random()-0.5)
        // Moves the wrapper container that holds this pierres clip.
        if (clip.parent) {
          clip.parent.x = 20 * (Math.random() - 0.5);
          clip.parent.y = 10 * (Math.random() - 0.5);
        }

        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;

        // _parent._parent._parent.haut — walk: pierres → wrapper → sprite_54 → root
        // In our tree: clip.parent = wrapper, clip.parent.parent = sprite_54 clip.
        const sprite54Clip = clip.parent?.parent;
        const haut = (sprite54Clip?.vars.haut as number | undefined) ?? 0;

        let v: number;
        if (haut === 1) {
          v = -20 * Math.random() - 5;
        } else {
          v = -5 * Math.random() - 5;
        }
        clip.vars.v = v;
        clip.vars.vr = 40 * (-0.5 + Math.random());
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
        //    CLIPACTIONRECORD onClipEvent(enterFrame).as
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let v = clip.vars.v as number;
        const vr = clip.vars.vr as number;
        let t = clip.vars.t as number;

        // _parent._x += vx; _parent._y += vy
        if (clip.parent) {
          clip.parent.x += vx;
          clip.parent.y += vy;
        }

        if (t === 1) {
          // Settled — fade out and eventually remove wrapper
          const newAlpha = clip.alpha - 2 / 100;
          clip.alpha = newAlpha;
          if (newAlpha <= 5 / 100) {
            clip.parent?.remove();
          }
        } else {
          // In-flight physics
          clip.y += v;
          clip.rotation += (vr * Math.PI) / 180;
          v += 1.5;

          if (clip.y > 0) {
            // Bounce at ground (Y=0)
            vx = vx / 2;
            vy = vy / 2;
            clip.rotation = 0;
            clip.y = 0;
            v = (-v) / 4;
            if (Math.abs(v) < 1) {
              vx = 0;
              vy = 0;
              t = 1;
            }
          }

          clip.vars.vx = vx;
          clip.vars.vy = vy;
          clip.vars.v = v;
          clip.vars.t = t;
        }
      },
    };

    // ---- lib_or — gold dust stub ---------------------------------
    // AS: No dynamic clipEvent scripts for "or". Pure visual stub.
    // Width/height are 0 in manifest so anchor defaults to 0.5/0.5.
    this.orSym = {
      name: "or",
      totalFrames: 1,
      frames: textures.getFrames("lib_or"),
      anchorX: 0.5,
      anchorY: 0.5,
    };

    // ---- lib_sprite8 (terre) — earth geyser visual ---------------
    // AS: DefineSprite_8_terre/frame_1/PlaceObject2_7_2/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    // No onLoad script; v starts at 0 by convention.
    this.sprite8Sym = {
      name: "sprite8",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      onLoad: (clip) => {
        // No canonical onLoad script. Initialise v=0 as default.
        clip.vars.v = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_8_terre/frame_1/PlaceObject2_7_2/
        //    CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _Y = _Y + v; v += 1; if(_Y >= 0) { v = -6*Math.random(); }
        let v = clip.vars.v as number;
        clip.y += v;
        v += 1;
        if (clip.y >= 0) {
          clip.y = 0;
          v = -6 * Math.random();
        }
        clip.vars.v = v;
      },
    };

    // ---- sprite_54 — outer composite orchestrator ----------------
    // AS: DefineSprite_54 frame scripts + PlaceObject2_9 clip events.
    //
    // The rolling-pierres spawner (PlaceObject2_9_1 onClipEvent(enterFrame))
    // runs for the first 20 ticks after frame_1. We model this as a
    // counter `c` on the sprite_54 clip, checked in its onEnterFrame.
    //
    // Each pierres attachment needs a thin wrapper container so that
    // onLoad's `_parent._x/y` mutations do not collide — each stone has
    // its own parent.
    //
    // The bulk spawner (PlaceObject2_9_81 onClipEvent(load)) fires at
    // frame_10 (index 9). We port it into the frameScripts[9] handler.

    // Capture symbol refs + runtime accessor for use in closures.
    const pierresSym = this.pierresSym;
    const orSym = this.orSym;
    const sprite8Sym = this.sprite8Sym;
    const getRuntime = () => this.runtime;
    const getPlaySound = () => this.playSound;

    this.sprite54Sym = {
      name: "sprite_54",
      totalFrames: 197,
      frames: textures.getFrames("sprite_54"),
      anchorX: sprite54Anchor.x,
      anchorY: sprite54Anchor.y,

      // Models PlaceObject2_9_1/onClipEvent(enterFrame):
      // "if(c < 20) { attachMovie("pierres","pierres"+c, c+1); c++; }"
      // c is initialised to 0 in the frame_1 frameScript.
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_54/frame_1/PlaceObject2_9_1/
        //    CLIPACTIONRECORD onClipEvent(enterFrame).as
        const c = (clip.vars.c as number | undefined) ?? 0;
        if (c < 20) {
          // Create a wrapper container at depth (c+1) so that
          // the pierres onLoad can move _parent independently.
          const wrapperDef: SymbolDefinition = {
            name: `__pw_${c}`,
            totalFrames: 1,
            frames: [],
            anchorX: 0.5,
            anchorY: 0.5,
          };
          const wrapper = clip.attach(wrapperDef, `pierresWrap${c}`, c + 1, ctx);
          wrapper.attach(pierresSym, "stone", 1, ctx);
          clip.vars.c = c + 1;
        }
      },

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_54/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }

            // Static placement of sprite8 (terre) per manifest placements[]:
            // parentSpriteId=54, frame=0, depth=3, matrix=(-0.1, 0.15).
            clip.attach(sprite8Sym, "terre", 3, ctx, {
              x: -0.1,
              y: 0.15,
            });

            // Initialise rolling-spawner counter used by onEnterFrame.
            clip.vars.c = 0;
          },
        ],
        [
          6,
          (clip) => {
            // AS DefineSprite_54/frame_7/DoAction.as
            // haut = 1;
            clip.vars.haut = 1;
          },
        ],
        [
          9,
          (clip, ctx) => {
            // AS DefineSprite_54/frame_10/DoAction.as
            // SOMA.playSound("grina_709");
            getPlaySound()?.("grina_709");

            // Signal hit at the canonical impact frame.
            getRuntime().signalHit();

            // AS DefineSprite_54/frame_10/PlaceObject2_9_81/
            //    CLIPACTIONRECORD onClipEvent(load).as
            // c=100; while(c<115){ attachMovie("pierres","pierres"+c,c); c++; }
            // b=200; while(b<220){ attachMovie("or","or"+b,b); b++; }
            let c = 100;
            while (c < 115) {
              const wrapperDef: SymbolDefinition = {
                name: `__pw_${c}`,
                totalFrames: 1,
                frames: [],
                anchorX: 0.5,
                anchorY: 0.5,
              };
              const wrapper = clip.attach(wrapperDef, `pierresWrap${c}`, c, ctx);
              wrapper.attach(pierresSym, "stone", 1, ctx);
              c++;
            }
            let b = 200;
            while (b < 220) {
              clip.attach(orSym, `or${b}`, b, ctx);
              b++;
            }
          },
        ],
        [
          83,
          (_clip) => {
            // AS DefineSprite_54/frame_84/DoAction.as
            // SOMA.playSound("setag_301");
            getPlaySound()?.("setag_301");
          },
        ],
        [
          194,
          (clip) => {
            // AS DefineSprite_54/frame_195/DoAction.as
            // _parent.removeMovieClip();
            clip.remove();
            getRuntime().complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.orSym);
    this.registry.register(this.sprite8Sym);
    this.registry.register(this.sprite54Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Store sound callback for use inside frameScripts closures.
    this.playSound = callbacks.playSound;

    // Attach sprite_54 at root depth 1. Its frame_1 frameScript
    // self-positions at cellTo on the first tick.
    // Main timeline frame_2/DoAction.as: stop() — no looping at root.
    this.root.attach(this.sprite54Sym, "sprite54", 1, context);
  }
}
