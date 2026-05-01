/**
 * Spell 306 — Lancement de Pierres (Osamodas earth throw).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/306/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single `shoot` animation
 * anchored at the target cell. There is no `move` symbol, no caster-side
 * projectile, no WorldAbsolute dual-anchor — just a 75-frame impact
 * composite at the target. The `DefineSprite_6_shoot/frame_73/DoAction.as`
 * calls `_parent.removeMovieClip()` which is the outer mc removal → complete().
 *
 * Library symbols:
 *   - lib_pierres — small stone particle. onLoad seeds vx/vy/lim + random
 *     scatter position + rotation to match launch direction. onEnterFrame
 *     integrates gravity (vy += 0.3) and bounces off the floor
 *     (vy *= -0.6, vx *= 0.6 when _Y > lim).
 *   - lib_sprite5 — 184-frame animated composite (directlyDynamic clipEvent).
 *     onLoad: initialise c = 0. onEnterFrame: while c < 6, attach one
 *     new `pierres` particle per frame (6 total over 6 frames).
 *
 * Main timeline (frame_1/DoAction.as):
 *   SOMA.playSound("lakam_405");
 *   level = 5;    ← hardcoded in the AS; we honour context.level via harness
 *
 * The top-level `shoot` animation is in `animations[]` (not librarySymbols[]).
 * Per manifest placements, sprite5 is placed inside shoot at frame index 12
 * (depth 1, translate -6.05 / 16.85) and fades out via colorTransform
 * alphaMult 246→18 across shoot frames 46-69.
 *
 * signalHit: DefineSprite_23/frame_16 fires `this.end()` — we fire
 * runtime.signalHit() from shoot's frameScripts at index 15.
 *
 * complete(): DefineSprite_6_shoot/frame_73 → `_parent.removeMovieClip()` →
 * frameScripts index 72 → runtime.complete().
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

// Bounds from manifest librarySymbols[] entry for "pierres" (characterId 17)
const PIERRES_BOUNDS = {
  width: 40.2,
  height: 14.95,
  offsetX: 45.75,
  offsetY: -4.7,
};

// Bounds from manifest librarySymbols[] entry for "sprite5" (characterId 5)
const SPRITE5_BOUNDS = {
  width: 65.9,
  height: 65.9,
  offsetX: -33.35,
  offsetY: -69.8,
};

// Bounds for the top-level "shoot" animation from manifest animations[]
const SHOOT_BOUNDS = {
  width: 65.9,
  height: 65.9,
  offsetX: -39.4,
  offsetY: -52.95,
};

export class Spell306 extends RuntimeSpell {
  readonly spellId = 306;
  readonly displayType = SpellDisplayType.TargetCell;

  private pierresSym!: SymbolDefinition;
  private sprite5Sym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const sprite5Anchor = calculateAnchor(SPRITE5_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- lib_pierres — stone particle ----------------------------
    // Drives per-tick ballistic physics. Both onLoad and onEnterFrame
    // MUST be ported — the dynamic position/rotation/velocity state
    // they produce is not captured in any pre-rendered SVG frame.
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,

      onLoad: (clip) => {
        // AS: DefineSprite_17_pierres/frame_1/PlaceObject2_16_1/
        //     CLIPACTIONRECORD onClipEvent(load).as
        //
        // _X = (Math.random() - 0.5) * 10;
        // _Y = (Math.random() - 0.5) * 10;
        // vx = (Math.random() - 0.5) * 3.5;
        // vy = (-Math.random()) * 7.5;
        // lim = 50 + (Math.random() - 0.5) * 20;
        // _rotation = Math.atan2(vy, vx) * 57.29746936176985;
        clip.x = (Math.random() - 0.5) * 10;
        clip.y = (Math.random() - 0.5) * 10;
        const vx = (Math.random() - 0.5) * 3.5;
        const vy = -Math.random() * 7.5;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.lim = 50 + (Math.random() - 0.5) * 20;
        // AS stores rotation in degrees via * 57.29…; atan2 already
        // yields radians so we assign directly — no conversion needed.
        clip.rotation = Math.atan2(vy, vx);
      },

      onEnterFrame: (clip) => {
        // AS: DefineSprite_17_pierres/frame_1/PlaceObject2_16_1/
        //     CLIPACTIONRECORD onClipEvent(enterFrame).as
        //
        // _X = _X + vx;
        // _Y = _Y + (vy += 0.3);
        // if (_Y > lim) { _Y = lim; vy = (-vy) * 0.6; vx *= 0.6; }
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const lim = clip.vars.lim as number;

        vy += 0.3;
        clip.x += vx;
        clip.y += vy;

        if (clip.y > lim) {
          clip.y = lim;
          vy = -vy * 0.6;
          vx *= 0.6;
        }

        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- lib_sprite5 — pierres particle emitter ------------------
    // directlyDynamic: true. The SWF places this via PlaceObject2 with
    // its own CLIPACTIONRECORD handlers. Both onLoad and onEnterFrame
    // are runtime-only behaviours that drive the attachMovie loop —
    // they cannot be captured in any static SVG frame.
    this.sprite5Sym = {
      name: "sprite5",
      totalFrames: 184,
      frames: textures.getFrames("lib_sprite5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,

      onLoad: (clip) => {
        // AS: DefineSprite_5/frame_1/PlaceObject2_3_3/
        //     CLIPACTIONRECORD onClipEvent(load).as
        //
        // c = 0;
        clip.vars.c = 0;
      },

      onEnterFrame: (clip, ctx) => {
        // AS: DefineSprite_5/frame_1/PlaceObject2_3_3/
        //     CLIPACTIONRECORD onClipEvent(enterFrame).as
        //
        // if (c < 6) { c += 1; this.attachMovie("pierres","pierres" + c, c); }
        let c = clip.vars.c as number;
        if (c < 6) {
          c += 1;
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
          clip.vars.c = c;
        }
      },
    };

    // ---- shoot — 75-frame top-level impact composite -------------
    // shoot is in animations[] (not librarySymbols[]) → no lib_ prefix.
    //
    // Manifest placements inside shoot (parentSpriteId 6):
    //   kind:"place" at frame index 12, depth 1, translate (-6.05, 16.85)
    //   → attach sprite5 child here.
    //
    //   kind:"move" frames 46-69 → alphaMult fades 246 → 18 (~9.9/frame).
    //   Handled in onEnterFrame by linear interpolation over that range.
    //
    // DefineSprite_23/frame_16 → this.end() → signalHit at index 15.
    // DefineSprite_6_shoot/frame_73 → _parent.removeMovieClip() at index 72.
    this.shootSym = {
      name: "shoot",
      totalFrames: 75,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,

      onEnterFrame: (clip) => {
        // Handle the alphaMult tween for the sprite5 child.
        // Manifest move placements: frames 46-69, alphaMult 246 → 18.
        // 246 at frame 46, 18 at frame 69 → 228 units over 23 steps.
        const f = clip.currentFrame;
        if (f >= 46 && f <= 69) {
          const sprite5Child = clip.children.get("sprite5");
          if (sprite5Child) {
            const alphaMult = 246 - ((f - 46) / 23) * 228;
            sprite5Child.alpha = alphaMult / 256;
          }
        }
      },

      frameScripts: new Map([
        [
          // Manifest: kind:"place", frame 12 (0-indexed), depth 1,
          // matrix translate (-6.05, 16.85) → attach sprite5.
          12,
          (clip, ctx) => {
            // AS: PlaceObject2 at depth 1 inside DefineSprite_6_shoot frame 12
            clip.attach(this.sprite5Sym, "sprite5", 1, ctx, {
              x: -6.05,
              y: 16.85,
            });
          },
        ],
        [
          // DefineSprite_23/frame_16 → this.end() → signalHit.
          // Inner sprite_23 starts at shoot frame 0; its frame_16 = index 15
          // fires at the equivalent absolute shoot frame 15.
          15,
          (_clip) => {
            // AS: DefineSprite_23/frame_16/DoAction.as → this.end()
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_6_shoot/frame_73/DoAction.as (0-based index 72)
          // _parent.removeMovieClip(); stop();
          72,
          (clip) => {
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.sprite5Sym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: scripts/frame_1/DoAction.as
    // SOMA.playSound("lakam_405");
    // level = 5;   ← root.vars.level already set by harness from context.level
    callbacks.playSound("lakam_405");

    // Attach the shoot animation at root (displayType=11 → container
    // is already positioned at the target cell by the harness).
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
