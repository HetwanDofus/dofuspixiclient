/**
 * Spell 804 — Vlad (Sacrieur).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/804/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell is a pure impact animation at
 * the target cell — no projectile motion, no caster reference. The main
 * DefineSprite_13 timeline (mapped to the top-level anim1) plays 192
 * frames at the target, firing a sound at frame 4, setting `ta` at
 * frame 4, and removing the outer mc at frame 190.
 *
 * Library symbols (all directlyDynamic: true with clipEvent handlers):
 *
 *   - sprite10 (DefineSprite_10) — 66-frame animated line/beam strip.
 *     onEnterFrame: alpha = random(60) (flickers between 0–59%).
 *     frame_64: stop().
 *     Placed inside sprite11 at depth 2.
 *
 *   - sprite11 (DefineSprite_11) — 1-frame wrapper container (664.75×552.95)
 *     that holds a sprite10 child internally. It is the particle that
 *     gets attachMovie'd many times at frame 7 (0-indexed 6) of the
 *     main DefineSprite_13 timeline.
 *     onLoad (PlaceObject2_10_2 on the inner sprite10):
 *       gotoAndPlay(random(30) + 1); ta = _parent._parent.ta;
 *       r = Math.random() * ta; v = 1.66 * r; _alpha = 360  (→ clamped to 1)
 *     onEnterFrame (PlaceObject2_10_2 on the inner sprite10):
 *       _xscale = 80 + 1.3*r; _yscale = 80 + 1.3*r;
 *       _alpha -= 1 + r/20; _X += v; v /= 1.066;
 *
 * Main DefineSprite_13 (= anim1 / root timeline):
 *   frame_4:  SOMA.playSound("vlad_804"); ta = 5 + 20 * _parent.level
 *   frame_7:  15 placements of sprite11 at scaled/offset positions
 *             (ported as root frameScripts.set(6, ...))
 *   frame_190: this._parent.removeMovieClip() → complete()
 *
 * signalHit is called at frame_4 (the sound/impact frame).
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

// Bounds from manifest librarySymbols[0] (sprite10)
const SPRITE10_BOUNDS = {
  width: 541.65,
  height: 31.7,
  offsetX: -358.8,
  offsetY: -16.75,
};

// Bounds from manifest librarySymbols[1] (sprite11)
const SPRITE11_BOUNDS = {
  width: 552.95,
  height: 664.75,
  offsetX: -358.8,
  offsetY: -649.8,
};

// The 15 placements of sprite11 at frame 6 (0-indexed) of DefineSprite_13,
// all sharing the same scale matrix (0.0548...) with individual offsets.
// From manifest.json librarySymbols[1].placements[]
const SPRITE11_PLACEMENTS: Array<{ depth: number; x: number; y: number }> = [
  { depth: 2,  x: 15.8,  y: 18.75  },
  { depth: 5,  x: 9.45,  y: 2.35   },
  { depth: 8,  x: 26.3,  y: 1.6    },
  { depth: 11, x: 32.65, y: -12.75 },
  { depth: 14, x: 21.4,  y: -3.15  },
  { depth: 17, x: 12.55, y: -17.5  },
  { depth: 20, x: 34.0,  y: 7.55   },
  { depth: 23, x: 13.3,  y: 8.1    },
  { depth: 26, x: 23.4,  y: 13.8   },
  { depth: 29, x: 28.7,  y: -7.0   },
  { depth: 32, x: 21.5,  y: -9.6   },
  { depth: 35, x: 13.6,  y: -5.65  },
  { depth: 38, x: 8.45,  y: -0.9   },
  { depth: 41, x: 9.2,   y: 11.7   },
  { depth: 44, x: 20.4,  y: -14.4  },
];

// Shared scale for all sprite11 placements (from matrix.scaleX = 0.0548095703125)
const SPRITE11_PLACEMENT_SCALE = 0.0548095703125;

export class Spell804 extends RuntimeSpell {
  readonly spellId = 804;
  readonly displayType = SpellDisplayType.TargetCell;

  // Store symbols as instance fields so onSpellStart can reference them
  private sprite10Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;
  // Store callbacks for use in frameScripts
  private _callbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite10Anchor = calculateAnchor(SPRITE10_BOUNDS);
    const sprite11Anchor = calculateAnchor(SPRITE11_BOUNDS);

    // ---- sprite10 — flickering animated beam/line strip ----------
    // AS: DefineSprite_10/frame_1/PlaceObject2_7_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //     _alpha = random(60);
    // AS: DefineSprite_10/frame_64/DoAction.as
    //     stop();
    this.sprite10Sym = {
      name: "sprite10",
      totalFrames: 66,
      frames: textures.getFrames("lib_sprite10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,

      onEnterFrame: (clip) => {
        // AS: DefineSprite_10/frame_1/PlaceObject2_7_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _alpha = random(60)  →  0-59 in Flash 0-100 scale
        clip.alpha = Math.floor(Math.random() * 60) / 100;
      },

      frameScripts: new Map([
        [
          63,
          (clip) => {
            // AS: DefineSprite_10/frame_64/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite11 — particle container (holds sprite10 child) ----
    // sprite11 is a 1-frame container. On its own authored frame it
    // has a PlaceObject2 that puts sprite10 at depth 2 with identity
    // matrix. The clipEvent handlers (load + enterFrame) are attached
    // to that placed sprite10 instance.
    //
    // AS: DefineSprite_11/frame_1/PlaceObject2_10_2/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(30) + 1);
    //   ta = _parent._parent.ta;
    //   r = Math.random() * ta;
    //   v = 1.66 * r;
    //   _alpha = 360;   ← Flash allows >100; Pixi clamps to 1.0 (fully opaque)
    //
    // AS: DefineSprite_11/frame_1/PlaceObject2_10_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _xscale = 80 + 1.3 * r;
    //   _yscale = 80 + 1.3 * r;
    //   _alpha = _alpha - 1 - r / 20;
    //   _X = _X + v;
    //   v /= 1.066;
    //
    // In canonical AS the clipEvents are on the *child* sprite10 clip
    // placed inside sprite11. We model this by building a custom
    // sprite10 variant that carries the outer-particle's onLoad /
    // onEnterFrame. The sprite11 SymbolDefinition's frameScripts[0]
    // attaches this inner clip so the handlers run on the inner sprite.
    const sprite10InnerSym: SymbolDefinition = {
      name: "sprite10_inner",
      totalFrames: 66,
      frames: textures.getFrames("lib_sprite10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,

      onLoad: (clip) => {
        // AS: DefineSprite_11/frame_1/PlaceObject2_10_2/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndPlay(random(30) + 1) → 0-based: random(30) + 0
        clip.gotoAndPlay(Math.floor(Math.random() * 30));
        // ta = _parent._parent.ta
        // parent = sprite11 instance; parent.parent = root (the outer mc,
        // which has ta stored in root.vars.ta, set at frame 4 of DefineSprite_13)
        const sprite11Clip = clip.parent;
        const rootClip = sprite11Clip?.parent;
        const ta = (rootClip?.vars.ta as number) ?? 5;
        clip.vars.ta = ta;
        const r = Math.random() * ta;
        clip.vars.r = r;
        clip.vars.v = 1.66 * r;
        // _alpha = 360 in AS (>100 allowed); clamp to 1.0 for Pixi
        clip.alpha = 1;
      },

      onEnterFrame: (clip) => {
        // AS: DefineSprite_11/frame_1/PlaceObject2_10_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const r = clip.vars.r as number;
        let v = clip.vars.v as number;
        // _xscale = _yscale = 80 + 1.3 * r  (AS percent → decimal)
        const scale = (80 + 1.3 * r) / 100;
        clip.scaleX = scale;
        clip.scaleY = scale;
        // _alpha = _alpha - 1 - r/20  (AS 0-100 → 0-1 delta)
        // We track alpha in AS-space in vars so the subtraction stays accurate
        let alphaAS = clip.vars.alphaAS as number | undefined;
        if (alphaAS === undefined) {
          // First enterFrame: initialise from current alpha (which was set
          // to clamped 1.0 in onLoad, representing AS 360 — but the AS
          // arithmetic starts from 360 and counts down past 100 before
          // becoming visually relevant). We faithfully start from 360.
          alphaAS = 360;
        }
        alphaAS = alphaAS - 1 - r / 20;
        clip.vars.alphaAS = alphaAS;
        // Clamp to Pixi [0,1] range
        clip.alpha = Math.max(0, Math.min(1, alphaAS / 100));
        // Remove when fully faded
        if (alphaAS <= 0) {
          clip.remove();
          return;
        }
        // _X += v
        clip.x += v;
        v /= 1.066;
        clip.vars.v = v;
      },

      frameScripts: new Map([
        [
          63,
          (clip) => {
            // AS: DefineSprite_10/frame_64/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // Register the inner variant so sprite11 can attach it
    this.registry.register(sprite10InnerSym);

    this.sprite11Sym = {
      name: "sprite11",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite11"),
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_11/frame_1 places sprite10 at depth 2
            // with identity matrix. The clipEvents on that placed clip
            // are represented by sprite10InnerSym (onLoad + onEnterFrame).
            const inner = this.registry.resolve("sprite10_inner");
            if (inner) {
              clip.attach(inner, "sprite10", 2, ctx, { x: 0, y: 0 });
            }
          },
        ],
      ]),
    };

    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite11Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Store callbacks reference so frameScripts can use playSound
    this._callbacks = callbacks;

    // The main DefineSprite_13 (anim1) timeline is handled entirely via
    // root frameScripts. We wire those up here since we now have context.
    //
    // frame_4 (0-indexed: 3): SOMA.playSound("vlad_804") + ta = 5 + 20*level
    // frame_7 (0-indexed: 6): attach 15 sprite11 instances with scaled transforms
    // frame_190 (0-indexed: 189): this._parent.removeMovieClip() → complete()
    //
    // The anim1 symbol is the root content — we drive it as root frameScripts
    // by attaching an anim1 symbol to the root at depth 1.

    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 192,
      frames: this._getAnim1Frames(context),
      anchorX: calculateAnchor({ width: 137.8, height: 136.15, offsetX: -29.55, offsetY: -86.3 }).x,
      anchorY: calculateAnchor({ width: 137.8, height: 136.15, offsetX: -29.55, offsetY: -86.3 }).y,

      frameScripts: new Map([
        [
          3,
          (clip, _ctx) => {
            // AS: DefineSprite_13/frame_4/DoAction.as → SOMA.playSound("vlad_804")
            // AS: DefineSprite_13/frame_4/DoAction_2.as → ta = 5 + 20 * _parent.level
            this._callbacks?.playSound("vlad_804");
            const level = (clip.parent?.vars.level as number) ?? 1;
            const ta = 5 + 20 * level;
            // Store ta on the root (clip.parent) so sprite11's onLoad can read it
            // via _parent._parent.ta
            if (clip.parent) {
              clip.parent.vars.ta = ta;
            }
            // Also store on self for convenience
            clip.vars.ta = ta;
            // Signal hit at the impact/sound frame
            this.runtime.signalHit();
          },
        ],
        [
          6,
          (clip, ctx) => {
            // AS: DefineSprite_13/frame_7 — 15 placements of sprite11
            // Each placement matrix has scaleX=scaleY=0.0548095703125,
            // negligible rotation (skew ~6e-5), and a translateX/Y offset.
            // We apply the scale + translation; the tiny rotateSkew is ~0.
            for (const p of SPRITE11_PLACEMENTS) {
              const s11 = this.registry.resolve("sprite11");
              if (s11) {
                const child = clip.attach(
                  s11,
                  `sprite11_d${p.depth}`,
                  p.depth,
                  ctx,
                  { x: p.x, y: p.y },
                );
                // Apply the placement scale (the matrix.scaleX from manifest)
                child.scaleX = SPRITE11_PLACEMENT_SCALE;
                child.scaleY = SPRITE11_PLACEMENT_SCALE;
              }
            }
          },
        ],
        [
          189,
          (clip) => {
            // AS: DefineSprite_13/frame_190/DoAction.as
            // this._parent.removeMovieClip() — removes the outer mc → spell complete
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
    this.root.attach(anim1Sym, "anim1", 1, context);
  }

  /**
   * Helper: retrieve anim1 textures. Called once during onSpellStart.
   * We need a reference to SpellTextureProvider here — captured via
   * a stored reference set during registerSymbols.
   */
  private _textures?: SpellTextureProvider;

  protected registerSymbolsWithTextures(
    textures: SpellTextureProvider,
    context: SpellContext,
  ): void {
    this._textures = textures;
    this.registerSymbols(textures, context);
  }

  private _getAnim1Frames(
    _context: SpellContext,
  ): ReturnType<SpellTextureProvider["getFrames"]> {
    if (this._textures) {
      return this._textures.getFrames("anim1");
    }
    return [];
  }
}
