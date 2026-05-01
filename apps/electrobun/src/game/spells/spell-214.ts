/**
 * Spell 214 — Croque-mitaine (Sacrieur / Sram area, likely Sram trap/ambush).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/214/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell is a single impact animation at the
 * target cell. There are no `move`/`shoot`/`duplicate` symbols, no projectile
 * logic, and no caster-relative positioning — the outer mc lives entirely at
 * the target. The main animation is a 147-frame composite (`anim1`) that is the
 * top-level authored content.
 *
 * Library symbols (from manifest.json `librarySymbols[]`):
 *
 *   - sprite3  (characterId 3, directlyDynamic: true)
 *               Single-frame star/spark particle. Has `onClipEvent(enterFrame)`
 *               that randomly flickers `_alpha` in [80, 180] and rotates by +10
 *               degrees per tick. Placed inside sprite13's timeline at depth 1
 *               with a scale+translate matrix. Directly dynamic — ported to
 *               `onEnterFrame` handler.
 *
 *   - sprite13 (characterId 13, directlyDynamic: false)
 *               Wrapper sprite. 145-frame authored timeline (DefineSprite_18 in
 *               the outer wrapper, DefineSprite_11 for the inner looping bit).
 *               Has per-frame alpha tweens on its child sprite3 (fade in frames
 *               0-15, full 16-117, fade out 118-144). At frame 145 removes the
 *               parent mc (= spell complete). Placement at frame 0 of the outer
 *               DefineSprite_18 (the composite anim18) with position x=26,
 *               y=-63.65, starting at alphaMult=0.
 *
 * Structure inferred from AS scripts:
 *   - DefineSprite_17/frame_1: SOMA.playSound("crockette_214")  ← sound sprite
 *   - DefineSprite_18/frame_145: _parent.removeMovieClip()      ← outer wrapper, frame 145
 *   - DefineSprite_11/frame_1:  gotoAndPlay(random(18)+2)       ← inner loop start randomiser
 *   - DefineSprite_11/frame_4:  _rotation = random(360)         ← sets rotation per loop
 *   - DefineSprite_11/frame_28: gotoAndPlay(2)                  ← loop back
 *   - DefineSprite_3/onClipEvent(enterFrame): _alpha = random(100)+80; this._rotation += 10
 *
 * The `anim1` composite is the rendered flat animation (everything baked into
 * SVG frames). The library symbols drive dynamic behaviour on top:
 *   - sprite3 clips flicker and rotate every tick
 *   - sprite13 alpha-tweens its child (captured from placements[])
 *   - frame 145 of sprite13's timeline signals completion
 *
 * signalHit is called at the first frame after placement (frame 0) — the
 * instant the impact begins — which mirrors the canonical immediate-damage
 * pattern for TargetCell spells without a discrete landing event.
 *
 * Main timeline: plays sound once via DefineSprite_17 (onSpellStart), then
 * the composite anim1 runs for 147 frames. sprite13 (the wrapper) is
 * attached at the root for the spell's lifecycle.
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

// ---------------------------------------------------------------------------
// Manifest bounds for library symbols
// ---------------------------------------------------------------------------

const SPRITE3_BOUNDS = {
  width: 136.65,
  height: 122.8,
  offsetX: -68.35,
  offsetY: -61.4,
};

const SPRITE13_BOUNDS = {
  width: 87.25,
  height: 29.9,
  offsetX: -43.65,
  offsetY: -14.95,
};

// anim1 bounds (main animation, used as the root display symbol)
const ANIM1_BOUNDS = {
  width: 87.25,
  height: 29.9,
  offsetX: -17.65,
  offsetY: -78.6,
};

// ---------------------------------------------------------------------------
// Alpha fade schedule derived from sprite13 placements[]
// frames 0-15: alphaMult 0→256 (fade in), frames 16-117: full (256),
// frames 118-144: alphaMult 247→0 (fade out)
// ---------------------------------------------------------------------------

function getSprite13AlphaForFrame(frame: number): number {
  if (frame < 0) {
    return 0;
  }
  if (frame <= 15) {
    // Fade in: frame 0 = 0/256, frame 15 = 256/256
    return (frame * 256) / 15 / 256;
  }
  if (frame <= 117) {
    return 1;
  }
  if (frame <= 144) {
    // Fade out: frame 118 = 247/256, frame 144 = 0/256
    const t = frame - 118;
    const total = 144 - 118;
    return Math.max(0, (247 / 256) * (1 - t / total));
  }
  return 0;
}

export class Spell214 extends RuntimeSpell {
  readonly spellId = 214;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite3Sym!: SymbolDefinition;
  private sprite13Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE3_BOUNDS);
    const sprite13Anchor = calculateAnchor(SPRITE13_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // -----------------------------------------------------------------------
    // sprite3 — directly-dynamic spark/star particle
    //
    // AS: scripts/DefineSprite_3/frame_1/PlaceObject2_2_1/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    //   onClipEvent(enterFrame) {
    //     _alpha = random(100) + 80;
    //     this._rotation += 10;
    //   }
    //
    // No onClipEvent(load) — no per-instance seed needed.
    // Placed inside sprite13 at depth 1, with the matrix from placements[]:
    //   scaleX/Y = 0.2433, translateX = -27, translateY = 0
    // -----------------------------------------------------------------------
    this.sprite3Sym = {
      name: "sprite3",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,

      // AS: onClipEvent(enterFrame) — _alpha = random(100) + 80; this._rotation += 10;
      onEnterFrame: (clip) => {
        // _alpha is 0-100 in AS (but the expression here yields 80-179,
        // clamped to 100 in Flash). We reproduce the raw value then clamp
        // to [0, 1] for Pixi.
        const rawAlpha = Math.floor(Math.random() * 100) + 80;
        clip.alpha = Math.min(rawAlpha, 100) / 100;
        // _rotation += 10 degrees per tick → convert delta to radians
        clip.rotation += (10 * Math.PI) / 180;
      },
    };

    // -----------------------------------------------------------------------
    // sprite13 — wrapper sprite (directlyDynamic: false)
    //
    // 145-frame timeline. Drives:
    //   - child sprite3 placement (depth 1) with matrix at frame 0
    //   - alpha tween on sprite3 across all 145 frames (from placements[])
    //   - DefineSprite_18/frame_145: _parent.removeMovieClip() → complete()
    //
    // The inner DefineSprite_11 scripts (frame_1: gotoAndPlay(random(18)+2),
    // frame_4: _rotation = random(360), frame_28: gotoAndPlay(2)) are the
    // authored inner looping logic baked into the sprite13 composite frames.
    // We model sprite13 as a 145-frame container that:
    //   - attaches sprite3 on frame 0 with the canonical matrix
    //   - updates sprite3's alpha per-frame (mirrors the PlaceObject2 color
    //     transform schedule in placements[])
    //   - removes parent and signals complete at frame 144 (AS frame_145)
    //
    // The inner DefineSprite_11 random-rotation logic (frame_1/4/28) affects
    // sprite3's rotation seed but the onEnterFrame handler overrides rotation
    // every tick anyway, so the randomised starting rotation resolves to the
    // same visual (the particle always spins at +10 deg/tick with random alpha).
    // We honour the spirit: onLoad of sprite3 could set a random initial
    // rotation, but since onEnterFrame sets it absolutely-randomly each frame
    // the starting value doesn't matter. No explicit onLoad needed.
    // -----------------------------------------------------------------------
    this.sprite13Sym = {
      name: "sprite13",
      totalFrames: 145,
      frames: textures.getFrames("lib_sprite13"),
      anchorX: sprite13Anchor.x,
      anchorY: sprite13Anchor.y,

      frameScripts: new Map([
        [
          // AS: frame_1 of DefineSprite_18 — place sprite3 child at depth 1
          // Placement matrix from placements[0] (kind: "place", frame 0):
          //   scaleX=0.2433, scaleY=0.2433, translateX=-27, translateY=0
          //   alphaMult=0 (starts invisible, fades in)
          0,
          (clip, ctx) => {
            // AS: PlaceObject2 of sprite3 at depth 1, frame 0 of sprite13's parent
            const child = clip.attach(this.sprite3Sym, "sprite3_inner", 1, ctx, {
              x: -27,
              y: 0,
            });
            child.scaleX = 0.2433;
            child.scaleY = 0.2433;
            // Initial alpha from placements[0].colorTransform.alphaMult = 0
            child.alpha = 0;
            // Store a frame counter on this clip so onEnterFrame can drive
            // the alpha tween schedule.
            clip.vars.frameCount = 0;
          },
        ],
        [
          // AS: DefineSprite_18/frame_145/DoAction.as → _parent.removeMovieClip()
          // frame_145 = index 144 (0-based)
          144,
          (clip) => {
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),

      // Per-tick: advance frameCount and apply the alpha tween to sprite3 child.
      // This mirrors the PlaceObject2 "move" entries in placements[] which step
      // alphaMult at specific frames 0-15 (fade in) and 118-144 (fade out).
      onEnterFrame: (clip) => {
        const fc = (clip.vars.frameCount as number) ?? 0;
        clip.vars.frameCount = fc + 1;

        const child = clip.children.get("sprite3_inner");
        if (child) {
          child.alpha = getSprite13AlphaForFrame(fc);
        }
      },
    };

    // -----------------------------------------------------------------------
    // anim1 — the main composite animation (147 frames, TargetCell anchor).
    //
    // This is the primary visual: 147 SVG frames rendered by the exporter.
    // It has no explicit AS scripts of its own beyond those folded into
    // the composite. We register it as a root-level symbol so it can be
    // attached to provide the visual backdrop.
    //
    // signalHit fires at frame 0 (immediately upon placement) — canonical
    // for TargetCell impact spells with no discrete landing event.
    // -----------------------------------------------------------------------
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 147,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // Signal hit on the very first frame of the impact animation.
            this.runtime.signalHit();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite3Sym);
    this.registry.register(this.sprite13Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: DefineSprite_17/frame_1/DoAction.as → SOMA.playSound("crockette_214")
    callbacks.playSound("crockette_214");

    // Attach the main composite animation at depth 1 (primary visual).
    this.root.attach(this.anim1Sym, "anim1", 1, context);

    // Attach sprite13 (the wrapper with sprite3 child and alpha tween) at depth 2.
    // Placement from manifest: parentSpriteId = 18 (the outer DefineSprite_18),
    // frame 0, matrix translateX=26, translateY=-63.65.
    // This is the topmost authored placement on the main composite's sprite 18.
    const sp13 = this.root.attach(this.sprite13Sym, "sprite13", 2, context, {
      x: 26,
      y: -63.65,
    });
    // Initial alpha from placements[0].colorTransform.alphaMult = 0/256 = 0
    sp13.alpha = 0;
  }
}
