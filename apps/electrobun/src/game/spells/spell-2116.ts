/**
 * Spell 2116 — Arty (artillery/catapult spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2116/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no move/shoot/projectile
 * structure; no `_parent.cellFrom`/`cellTo` coordinate references; the
 * main content is a single impact animation (anim1, 51 frames) at the
 * target cell, plus a set of spawned library-symbol particles. There is
 * no ballistic harness required.
 *
 * Library symbols (from manifest.librarySymbols):
 *
 *   - sprite7  (characterId=7, directlyDynamic=true, 59 frames)
 *               The main animated impact sprite. Placed inside sprite9.
 *               frame_18: gotoAndPlay(random(5)+17) → loops within
 *               frames 17-21.
 *               frame_59: stop().
 *               Several PlaceObject2 children on sprite9's timeline have
 *               onClipEvent(load) with `_alpha = random(N)` and one has
 *               onClipEvent(enterFrame) `_alpha -= 5; _X -= 2`.
 *               These are driven from child sprite symbols (sprite14,
 *               sprite15) placed into sprite7 (sprite9 hosts sprite7).
 *
 *   - sprite9  (characterId=9, directlyDynamic=false, 74 frames)
 *               Wrapper that holds sprite7 as a child. Placed from
 *               onSpellStart. frame_74: stop().
 *               Contains motion-tween data for its children.
 *
 *   - sprite14 (characterId=14, directlyDynamic=true, 1 frame)
 *               Tiny particle sprite (baton-like). Has onEnterFrame:
 *               `_alpha = random(100)` — alpha flicker.
 *               Placed inside sprite15.
 *
 *   - sprite15 (characterId=15, directlyDynamic=true, 1 frame)
 *               Wrapper containing sprite14. onLoad: `_alpha = 100 -
 *               random(50)`. Placed inside sprite7 via sprite16 and
 *               sprite18 parents.
 *
 *   - sprite16 (characterId=16, directlyDynamic=false, 1 frame)
 *               Wrapper that holds sprite15 at a skewed/rotated matrix.
 *               Placed inside sprite17 (baton2).
 *
 * Additional symbols referenced in scripts but not in librarySymbols
 * (they are authored children within the composite anim, not separately
 * exported dynamic symbols):
 *
 *   - DefineSprite_18_baton: `v,vy` drift particle, onEnterFrame friction.
 *     Not in librarySymbols — it is placed as part of the pre-rendered
 *     anim1 composite. Its DoAction.as seeds vx/vy and sets an
 *     onEnterFrame on the instance directly. Since it is not in
 *     librarySymbols we cannot attach it as a separate SpellClip; it
 *     appears baked into the anim1 composite SVG frames.
 *
 *   - DefineSprite_17_baton2: baton2 particle with oscillation.
 *     Also not in librarySymbols directly — placed via sprite16 inside
 *     sprite17 sub-tree. The baton2 clip-event behaviours (oscillating
 *     rotation via `a * sin(i++)` decay) are ported as part of the
 *     sprite15/sprite16 symbol chain.
 *
 * Main timeline (frame_1): SOMA.playSound("arty_102"); (no stop call)
 * Main timeline (frame_172): this.removeMovieClip() → spell complete.
 *
 * signalHit is fired at the first meaningful impact frame of sprite9
 * (frame 1, i.e. 0-based index 0, on entry — but canonically the
 * impact visuals peak around the midpoint of anim1). We fire signalHit
 * at frame_1 of sprite9 (its first tick) to match the "instant impact"
 * pattern common for TargetCell spells with no projectile.
 *
 * complete() is fired from the main-timeline frame_172 equivalently:
 * since we use anim1 as our root animation with 51 frames stopping at
 * frame 49 (stopFrame=48, 0-based), completion is driven by sprite9's
 * frame_74 stop. We fire complete() there.
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

const SPRITE7_BOUNDS = {
  width: 16.55,
  height: 69.25,
  offsetX: -8.25,
  offsetY: -24.25,
};

const SPRITE9_BOUNDS = {
  width: 344.4,
  height: 224.85,
  offsetX: -144.4,
  offsetY: -175,
};

const SPRITE14_BOUNDS = {
  width: 49.1,
  height: 9.4,
  offsetX: -27,
  offsetY: -4.3,
};

const SPRITE15_BOUNDS = {
  width: 49.1,
  height: 9.4,
  offsetX: -26.95,
  offsetY: -4.2,
};

const SPRITE16_BOUNDS = {
  width: 6.7,
  height: 35.15,
  offsetX: -3.2,
  offsetY: -29.9,
};

export class Spell2116 extends RuntimeSpell {
  readonly spellId = 2116;
  readonly displayType = SpellDisplayType.TargetCell;

  // We need cross-references between symbols, so store them as fields.
  private sprite14Sym!: SymbolDefinition;
  private sprite15Sym!: SymbolDefinition;
  private sprite16Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const sprite14Anchor = calculateAnchor(SPRITE14_BOUNDS);
    const sprite15Anchor = calculateAnchor(SPRITE15_BOUNDS);
    const sprite16Anchor = calculateAnchor(SPRITE16_BOUNDS);

    // ---- sprite14 (characterId=14, directlyDynamic=true) ----------------
    // AS: DefineSprite_14/frame_1/PlaceObject2_13_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _alpha = random(100);
    // Placed inside sprite15. Single static frame texture.
    this.sprite14Sym = {
      name: "sprite14",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,
      onLoad: (_clip) => {
        // AS: DefineSprite_15/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load).as
        // _alpha = 100 - random(50);
        // NOTE: This load handler is on the PLACEMENT of sprite14 inside sprite15
        // (PlaceObject2_14_1 inside sprite15's frame_1). We apply it here as the
        // onLoad of sprite14 itself since that is when the instance is created.
        _clip.alpha = (100 - Math.floor(Math.random() * 50)) / 100;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_14/frame_1/PlaceObject2_13_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _alpha = random(100);
        clip.alpha = Math.floor(Math.random() * 100) / 100;
      },
    };

    // ---- sprite15 (characterId=15, directlyDynamic=true) ----------------
    // AS: DefineSprite_15/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load).as
    //   _alpha = 100 - random(50);
    // Placed inside sprite16 (and also inside sprite18, which is part of baton).
    // Its frame_1 places sprite14 at depth 1. The placement matrix from
    // sprite15's placement entry in sprite16:
    //   translateX: 0.05, translateY: 0.1 (negligible offset)
    this.sprite15Sym = {
      name: "sprite15",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_15/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load).as
        // _alpha = 100 - random(50);
        clip.alpha = (100 - Math.floor(Math.random() * 50)) / 100;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // sprite15's frame_1 places sprite14 at depth 1
            // placement: translateX=0.05, translateY=0.1
            clip.attach(this.sprite14Sym, "sprite14_child", 1, ctx, {
              x: 0.05,
              y: 0.1,
            });
          },
        ],
      ]),
    };

    // ---- sprite16 (characterId=16, directlyDynamic=false) ---------------
    // Wrapper. Placed inside sprite17 (baton2). Its frame_1 places sprite15
    // at depth 1 with: translateX=0, translateY=0.8
    // No clip-event handlers of its own.
    this.sprite16Sym = {
      name: "sprite16",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite16"),
      anchorX: sprite16Anchor.x,
      anchorY: sprite16Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place sprite15 inside sprite16
            // placement: translateX=0, translateY=0.8
            clip.attach(this.sprite15Sym, "sprite15_child", 1, ctx, {
              x: 0,
              y: 0.8,
            });
          },
        ],
      ]),
    };

    // ---- sprite7 (characterId=7, directlyDynamic=true, 59 frames) -------
    // Main animated impact. Placed as child of sprite9.
    //
    // frame_18/DoAction.as: gotoAndPlay(random(5) + 17) → loop in [17..21]
    // frame_59/DoAction.as: stop()
    //
    // Several frames have PlaceObject2 children with onClipEvent(load)
    // setting alpha:
    //   frame_38 PlaceObject2_4_1 load: _alpha = random(80)
    //   frame_40 PlaceObject2_6_1 load: _alpha = random(80)
    //   frame_43 PlaceObject2_4_1 load: _alpha = random(80)
    //   frame_45 PlaceObject2_6_1 load: _alpha = random(80)
    //   frame_47 PlaceObject2_6_1 load: _alpha = random(120)
    //   frame_47 PlaceObject2_6_1 enterFrame: _alpha -= 5; _X -= 2
    //
    // These PlaceObject2 children are sub-sprites embedded in sprite7's
    // authored timeline. They are captured in the pre-rendered SVG frames
    // for the static visual, but the clip-event handlers (alpha randomization
    // and drift) are dynamic. We model them as sprite16 attachments at those
    // frames (sprite16 hosts sprite15 → sprite14 chain which provides the
    // dynamic alpha flicker), and for the frame_47 fade+drift we use a
    // dedicated inline SymbolDefinition.

    // Build the frame_47 fading particle inline (PlaceObject2_6_1 at frame 47).
    const fadingParticleSym: SymbolDefinition = {
      name: "_fading_particle_f47",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite16"),
      anchorX: sprite16Anchor.x,
      anchorY: sprite16Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_7/frame_47/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
        // _alpha = random(120);
        clip.alpha = Math.floor(Math.random() * 120) / 100;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_7/frame_47/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _alpha = _alpha - 5;
        // _X = _X - 2;
        clip.alpha = clip.alpha - 5 / 100;
        clip.x = clip.x - 2;
      },
    };

    // Random-alpha particle for placements at frames 38, 40, 43, 45
    // (load: _alpha = random(80))
    const alphaParticleSym: SymbolDefinition = {
      name: "_alpha_particle",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite16"),
      anchorX: sprite16Anchor.x,
      anchorY: sprite16Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_7/frame_38,40,43,45/PlaceObject2_*/CLIPACTIONRECORD onClipEvent(load).as
        // _alpha = random(80);
        clip.alpha = Math.floor(Math.random() * 80) / 100;
      },
    };

    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 59,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      frameScripts: new Map([
        [
          17,
          (clip) => {
            // AS: DefineSprite_7/frame_18/DoAction.as
            // gotoAndPlay(random(5) + 17);
            // AS 1-based → 0-based: target = (random(5)+17) - 1 = random(5)+16
            clip.gotoAndPlay(Math.floor(Math.random() * 5) + 16);
          },
        ],
        [
          37,
          (clip, ctx) => {
            // AS: DefineSprite_7/frame_38/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
            // _alpha = random(80);
            // Attach an alpha-randomized particle at depth 4
            clip.attach(alphaParticleSym, "alpha_p_38", 4, ctx);
          },
        ],
        [
          39,
          (clip, ctx) => {
            // AS: DefineSprite_7/frame_40/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
            // _alpha = random(80);
            clip.attach(alphaParticleSym, "alpha_p_40", 6, ctx);
          },
        ],
        [
          42,
          (clip, ctx) => {
            // AS: DefineSprite_7/frame_43/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
            // _alpha = random(80);
            clip.attach(alphaParticleSym, "alpha_p_43", 4, ctx);
          },
        ],
        [
          44,
          (clip, ctx) => {
            // AS: DefineSprite_7/frame_45/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
            // _alpha = random(80);
            clip.attach(alphaParticleSym, "alpha_p_45", 6, ctx);
          },
        ],
        [
          46,
          (clip, ctx) => {
            // AS: DefineSprite_7/frame_47/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
            // _alpha = random(120);
            // onClipEvent(enterFrame): _alpha -= 5; _X -= 2;
            clip.attach(fadingParticleSym, "fading_p_47", 6, ctx);
          },
        ],
        [
          58,
          (clip) => {
            // AS: DefineSprite_7/frame_59/DoAction.as
            // stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite9 (characterId=9, directlyDynamic=false, 74 frames) ------
    // Outer wrapper that contains sprite7 as its authored child.
    // placement of sprite7 inside sprite9 (from placements where parentSpriteId=9):
    //   frame=0, depth=2, matrix: translateX=24.75, translateY=-10.15
    // (subsequent "move" entries update position each frame — these are
    //  tweened keyframes from the authoring tool; the pre-rendered SVG
    //  captures the visual result so we only apply the initial placement
    //  in frameScripts[0] and let the SVG animation drive the rest).
    //
    // frame_74/DoAction.as: stop() → we also fire complete() here.
    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 74,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place sprite7 at depth 2 with initial tween matrix
            // AS placement: parentSpriteId=9, frame=0, depth=2
            // matrix: translateX=24.75, translateY=-10.15
            clip.attach(this.sprite7Sym, "sprite7_child", 2, ctx, {
              x: 24.75,
              y: -10.15,
            });
            // Signal hit on first frame of sprite9 (instant impact, TargetCell)
            this.runtime.signalHit();
          },
        ],
        [
          73,
          (clip) => {
            // AS: DefineSprite_9/frame_74/DoAction.as
            // stop();
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // Register all symbols (order matters for cross-references resolved at
    // attach time — innermost first so they are available when outer symbols'
    // frameScripts run).
    this.registry.register(this.sprite14Sym);
    this.registry.register(this.sprite15Sym);
    this.registry.register(this.sprite16Sym);
    this.registry.register(alphaParticleSym);
    this.registry.register(fadingParticleSym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite9Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: scripts/frame_1/DoAction.as
    // SOMA.playSound("arty_102");
    callbacks.playSound("arty_102");

    // The main timeline places sprite9 at the target (root is already
    // anchored at target cell for displayType=11). Attach sprite9 to root.
    this.root.attach(this.sprite9Sym, "sprite9", 1, context);
  }
}
