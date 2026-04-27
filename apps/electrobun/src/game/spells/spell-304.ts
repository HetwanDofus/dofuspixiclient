/**
 * Spell 304 — Attaque des Tofus (or similar earth/rock-throw spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/304/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main timeline frame_2/DoAction.as
 * does `stop()`, and the sole top-level sprite (sprite_54 / DefineSprite_54)
 * positions itself at `_parent.cellTo.x / _parent.cellTo.y` in its own
 * frame_1, which is the canonical WorldAbsolute pattern (children read
 * _parent.cellFrom / _parent.cellTo directly). The harness places the
 * container at world (0,0).
 *
 * Canonical AS layout:
 *
 *   - lib_pierres  — tiny rock particle. onLoad seeds vx/vy/v/vr/t/alpha
 *                    and random position on parent; onEnterFrame drives
 *                    gravity bounce + fade-out + self-removal.
 *   - lib_or       — zero-size "or" (gold) particle; no scripts, purely visual.
 *
 *   - sprite_54 (DefineSprite_54, 197 frames) — outer container, self-
 *                    positions at cellTo in frame_1. Frame_7 sets haut=1.
 *                    Frame_10 plays sound "grina_709" and its placed child
 *                    (PlaceObject2_9_81) spawns 15 pierres + 20 or on load,
 *                    plus a persistent enterFrame loop on the frame_1 child
 *                    (PlaceObject2_9_1) that spawns one pierres per tick
 *                    while c < 20. Frame_84 plays "setag_301". Frame_195
 *                    calls _parent.removeMovieClip() → spell complete.
 *
 *   - sprite_53 (DefineSprite_53, 128 frames, stopFrame=29) — authored
 *                    visual, stops at frame_30 (index 29).
 *
 *   - sprite_43 (DefineSprite_43, 35 frames, stopFrame=33) — authored
 *                    visual, stops at frame_34 (index 33).
 *
 *   - sprite_30 (DefineSprite_30, 141 frames, stopFrame=138) — authored
 *                    visual, stops at frame_139 (index 138).
 *
 *   - sprite_46 (DefineSprite_46, 4 frames) — authored visual, no scripts.
 *
 *   - sprite_50 (DefineSprite_50, 6 frames) — authored visual, no scripts.
 *
 *   - sprite_40 (DefineSprite_40, 14 frames) — authored visual; its
 *                    placed child (terre / DefineSprite_8_terre) has an
 *                    enterFrame that makes it bounce with gravity.
 *
 * Main timeline: frame_2/DoAction.as → stop(). No sound on main timeline;
 * sounds are inside sprite_54 at frames 10 and 84.
 *
 * signalHit: fired from sprite_54's frame_10 script (the canonical impact
 * moment — rocks start spawning and the first sound plays).
 *
 * complete: fired from sprite_54's frame_195 script (canonical
 * _parent.removeMovieClip()).
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

// ---- Bounds from manifest.json librarySymbols[] ----
const PIERRES_BOUNDS = {
  width: 6.4,
  height: 3.85,
  offsetX: -3.2,
  offsetY: -2.2,
};

// lib_or has zero dimensions — use a safe fallback anchor of 0.5/0.5
const OR_BOUNDS = {
  width: 1,
  height: 1,
  offsetX: -0.5,
  offsetY: -0.5,
};

// ---- Bounds from manifest.json animations[] ----
const SPRITE_30_BOUNDS = {
  width: 34.2,
  height: 80.05,
  offsetX: -20.3,
  offsetY: -92.75,
};
const SPRITE_40_BOUNDS = {
  width: 14.2,
  height: 63.95,
  offsetX: -7.25,
  offsetY: -49.6,
};
const SPRITE_43_BOUNDS = {
  width: 99.25,
  height: 191.4,
  offsetX: -46.3,
  offsetY: -167.3,
};
const SPRITE_46_BOUNDS = {
  width: 72.4,
  height: 36,
  offsetX: -35.6,
  offsetY: -18,
};
const SPRITE_50_BOUNDS = {
  width: 30.6,
  height: 42.85,
  offsetX: -15.3,
  offsetY: -21.4,
};
const SPRITE_53_BOUNDS = {
  width: 58.95,
  height: 166,
  offsetX: -31.7,
  offsetY: -146.5,
};
const SPRITE_54_BOUNDS = {
  width: 66.35,
  height: 364.9,
  offsetX: -33.6,
  offsetY: -246,
};

export class Spell304 extends RuntimeSpell {
  readonly spellId = 304;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  // Symbols that need to be referenced across methods
  private pierresSym!: SymbolDefinition;
  private orSym!: SymbolDefinition;
  private sprite54Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const orAnchor = calculateAnchor(OR_BOUNDS);
    const sprite30Anchor = calculateAnchor(SPRITE_30_BOUNDS);
    const sprite40Anchor = calculateAnchor(SPRITE_40_BOUNDS);
    const sprite43Anchor = calculateAnchor(SPRITE_43_BOUNDS);
    const sprite46Anchor = calculateAnchor(SPRITE_46_BOUNDS);
    const sprite50Anchor = calculateAnchor(SPRITE_50_BOUNDS);
    const sprite53Anchor = calculateAnchor(SPRITE_53_BOUNDS);
    const sprite54Anchor = calculateAnchor(SPRITE_54_BOUNDS);

    // ---- lib_pierres — rock particle with gravity bounce + fade ----
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   vx = 2 * (Math.random() - 0.5)
        //   vy = 1 * (Math.random() - 0.5)
        //   _parent._x = 20 * (Math.random() - 0.5)
        //   _parent._y = 10 * (Math.random() - 0.5)
        //   t = 60 + 40 * Math.random()
        //   _xscale = _yscale = t
        //   _alpha = 20 + random(90)
        //   v = -5 * Math.random() - 5
        //   if (_parent._parent._parent.haut == 1) { v = -20 * Math.random() - 5 }
        //   vr = 40 * (-0.5 + Math.random())
        clip.vars.vx = 2 * (Math.random() - 0.5);
        clip.vars.vy = 1 * (Math.random() - 0.5);

        // _parent (the pierres container clip) position scatter
        const parent = clip.parent;
        if (parent) {
          parent.x = 20 * (Math.random() - 0.5);
          parent.y = 10 * (Math.random() - 0.5);
        }

        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;

        // Walk up: clip (pierres inner) → parent (pierres container) →
        // PlaceObject2_9_81 or PlaceObject2_9_1 clip → sprite_54 → root
        // In AS: _parent._parent._parent.haut
        // clip.parent = pierres container; .parent = the "terre-like" or
        // placed clip that owns it; .parent = sprite_54; .parent = root
        const grandParent = clip.parent?.parent;
        const greatGrandParent = grandParent?.parent;
        const haut = (greatGrandParent?.vars.haut as number | undefined) ?? 0;

        let v = -5 * Math.random() - 5;
        if (haut === 1) {
          v = -20 * Math.random() - 5;
        }
        clip.vars.v = v;
        clip.vars.vr = 40 * (-0.5 + Math.random());
        // t state flag: when t transitions to 1 we enter the fade mode.
        // AS uses t as a countdown that hits 1; here we store the initial
        // float and the fade flag separately via vars.fadeMode.
        clip.vars.fadeMode = 0;
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   _parent._x += vx; _parent._y += vy
        //   if (t == 1) { _alpha -= 2; if (_alpha <= 5) _parent.removeMovieClip() }
        //   if (t != 1) {
        //     _Y += v; _rotation += vr; v += 1.5
        //     if (_Y > 0) {
        //       vx /= 2; vy /= 2; _rotation = 0; _Y = 0
        //       v = -v / 4
        //       if (Math.abs(v) < 1) { vx = 0; vy = 0; t = 1 }
        //     }
        //   }
        const parent = clip.parent;
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        const fadeMode = clip.vars.fadeMode as number;

        if (parent) {
          parent.x += vx;
          parent.y += vy;
        }

        if (fadeMode === 1) {
          // t == 1 branch: fade out
          const newAlpha = clip.alpha - 2 / 100;
          clip.alpha = newAlpha;
          if (clip.alpha <= 5 / 100) {
            if (parent) {
              parent.remove();
            }
          }
        } else {
          // t != 1 branch: gravity + bounce
          let v = clip.vars.v as number;
          const vr = clip.vars.vr as number;

          clip.y += v;
          clip.rotation += (vr * Math.PI) / 180;
          v += 1.5;
          clip.vars.v = v;

          if (clip.y > 0) {
            let vxNew = vx / 2;
            let vyNew = vy / 2;
            clip.rotation = 0;
            clip.y = 0;
            const vBounced = -v / 4;
            clip.vars.v = vBounced;
            clip.vars.vx = vxNew;
            clip.vars.vy = vyNew;

            if (Math.abs(vBounced) < 1) {
              clip.vars.vx = 0;
              clip.vars.vy = 0;
              clip.vars.fadeMode = 1;
            }
          }
        }
      },
    };

    // ---- lib_or — zero-size gold particle, no clip scripts ----
    this.orSym = {
      name: "or",
      totalFrames: 1,
      frames: textures.getFrames("lib_or"),
      anchorX: orAnchor.x,
      anchorY: orAnchor.y,
    };

    // ---- sprite_30 — 141-frame authored visual, stops at frame 139 ----
    // AS: DefineSprite_30/frame_139/DoAction.as → stop()
    const sprite30Sym: SymbolDefinition = {
      name: "sprite_30",
      totalFrames: 141,
      frames: textures.getFrames("sprite_30"),
      anchorX: sprite30Anchor.x,
      anchorY: sprite30Anchor.y,
      frameScripts: new Map([
        [
          138,
          (clip) => {
            // AS DefineSprite_30/frame_139/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_40 — 14-frame authored visual with terre bounce child ----
    // AS: DefineSprite_8_terre/frame_1/PlaceObject2_7_2/onClipEvent(enterFrame)
    // The terre child is a placed object inside sprite_40 that bounces
    // vertically. We model it as a sub-symbol registered and attached here.
    const terreSym: SymbolDefinition = {
      name: "terre",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // Seed initial upward velocity
        clip.vars.v = -6 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_8_terre/frame_1/PlaceObject2_7_2/onClipEvent(enterFrame):
        //   _Y += v; v += 1; if (_Y >= 0) { v = -6 * Math.random() }
        let v = clip.vars.v as number;
        clip.y += v;
        v += 1;
        clip.vars.v = v;
        if (clip.y >= 0) {
          clip.y = 0;
          clip.vars.v = -6 * Math.random();
        }
      },
    };
    this.registry.register(terreSym);

    const sprite40Sym: SymbolDefinition = {
      name: "sprite_40",
      totalFrames: 14,
      frames: textures.getFrames("sprite_40"),
      anchorX: sprite40Anchor.x,
      anchorY: sprite40Anchor.y,
      onLoad: (clip, ctx) => {
        // Attach the terre bounce child that was placed in the authored SWF
        clip.attach(terreSym, "terre", 2, ctx);
      },
    };

    // ---- sprite_43 — 35-frame authored visual, stops at frame 34 ----
    // AS: DefineSprite_43/frame_34/DoAction.as → stop()
    const sprite43Sym: SymbolDefinition = {
      name: "sprite_43",
      totalFrames: 35,
      frames: textures.getFrames("sprite_43"),
      anchorX: sprite43Anchor.x,
      anchorY: sprite43Anchor.y,
      frameScripts: new Map([
        [
          33,
          (clip) => {
            // AS DefineSprite_43/frame_34/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_46 — 4-frame authored visual, no scripts ----
    const sprite46Sym: SymbolDefinition = {
      name: "sprite_46",
      totalFrames: 4,
      frames: textures.getFrames("sprite_46"),
      anchorX: sprite46Anchor.x,
      anchorY: sprite46Anchor.y,
    };

    // ---- sprite_50 — 6-frame authored visual, no scripts ----
    const sprite50Sym: SymbolDefinition = {
      name: "sprite_50",
      totalFrames: 6,
      frames: textures.getFrames("sprite_50"),
      anchorX: sprite50Anchor.x,
      anchorY: sprite50Anchor.y,
    };

    // ---- sprite_53 — 128-frame authored visual, stops at frame 30 ----
    // AS: DefineSprite_53/frame_30/DoAction.as → stop()
    const sprite53Sym: SymbolDefinition = {
      name: "sprite_53",
      totalFrames: 128,
      frames: textures.getFrames("sprite_53"),
      anchorX: sprite53Anchor.x,
      anchorY: sprite53Anchor.y,
      frameScripts: new Map([
        [
          29,
          (clip) => {
            // AS DefineSprite_53/frame_30/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_54 — 197-frame outer container, the main spell driver ----
    //
    // Two placed children coexist:
    //
    //   PlaceObject2_9_1 (depth 1) — present from frame_1. Its enterFrame
    //     loop (while c < 20) attaches one "pierres" per tick. c is
    //     initialised to 0 by the frame_1 DoAction `_X = ...; _Y = ...`.
    //     We model this as a container clip with its own onEnterFrame.
    //
    //   PlaceObject2_9_81 (depth 81) — placed at frame_10. Its onLoad
    //     fires once: attaches 15 pierres (c=100..114) and 20 or (b=200..219).
    //
    // Both placed children live inside sprite_54 (they call
    // `this.attachMovie(...)` on themselves, so pierres' _parent._parent
    // traversals reach sprite_54 and then root).
    //
    // We model them as sub-symbols.

    // The early placed child (depth 1) — spawns pierres one per tick
    const earlyChildSym: SymbolDefinition = {
      name: "_placed_early",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // c counter initialised to 0 (incremented in enterFrame)
        clip.vars.c = 0;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_54/frame_1/PlaceObject2_9_1/onClipEvent(enterFrame):
        //   if (c < 20) { this.attachMovie("pierres","pierres" + c, c + 1); c++ }
        const c = clip.vars.c as number;
        if (c < 20) {
          clip.attach(this.pierresSym, `pierres${c}`, c + 1, ctx);
          clip.vars.c = c + 1;
        }
      },
    };

    // The late placed child (depth 81) — spawns burst of pierres + or on load
    const lateChildSym: SymbolDefinition = {
      name: "_placed_late",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_54/frame_10/PlaceObject2_9_81/onClipEvent(load):
        //   c = 100; while (c < 115) { this.attachMovie("pierres","pierres"+c,c); c++ }
        //   b = 200; while (b < 220) { this.attachMovie("or","or"+b,b); b++ }
        let c = 100;
        while (c < 115) {
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
          c++;
        }
        let b = 200;
        while (b < 220) {
          clip.attach(this.orSym, `or${b}`, b, ctx);
          b++;
        }
      },
    };
    this.registry.register(earlyChildSym);
    this.registry.register(lateChildSym);

    this.sprite54Sym = {
      name: "sprite_54",
      totalFrames: 197,
      frames: textures.getFrames("sprite_54"),
      anchorX: sprite54Anchor.x,
      anchorY: sprite54Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_54/frame_1/DoAction.as:
            //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y
            // In WorldAbsolute mode the container is at world (0,0), so
            // we place sprite_54 directly at the world-space cellTo coords.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
            // Attach the early placed child (PlaceObject2_9_1, depth 1)
            // which starts its per-tick pierres spawning immediately.
            clip.attach(earlyChildSym, "_placed_early", 1, ctx);
          },
        ],
        [
          6,
          (clip) => {
            // AS DefineSprite_54/frame_7/DoAction.as: haut = 1
            clip.vars.haut = 1;
          },
        ],
        [
          9,
          (clip, ctx) => {
            // AS DefineSprite_54/frame_10/DoAction.as: SOMA.playSound("grina_709")
            // Sound is captured via the stored callback reference.
            this.soundCallback?.("grina_709");
            // Signal hit at the canonical impact moment (rocks start flying).
            this.runtime.signalHit();
            // Attach the late placed child (PlaceObject2_9_81, depth 81)
            // whose onLoad spawns the burst of pierres + or.
            clip.attach(lateChildSym, "_placed_late", 81, ctx);
          },
        ],
        [
          83,
          () => {
            // AS DefineSprite_54/frame_84/DoAction.as: SOMA.playSound("setag_301")
            this.soundCallback?.("setag_301");
          },
        ],
        [
          194,
          (clip) => {
            // AS DefineSprite_54/frame_195/DoAction.as: _parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.orSym);
    this.registry.register(sprite30Sym);
    this.registry.register(sprite40Sym);
    this.registry.register(sprite43Sym);
    this.registry.register(sprite46Sym);
    this.registry.register(sprite50Sym);
    this.registry.register(sprite53Sym);
    this.registry.register(this.sprite54Sym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use inside frame scripts
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_2/DoAction.as: stop() — the runtime handles
    // this implicitly since the root has no authored timeline scripts.
    // We just attach sprite_54 as the sole child of the root.
    this.root.attach(this.sprite54Sym, "sprite54", 1, context);
  }
}
