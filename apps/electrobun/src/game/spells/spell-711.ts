/**
 * Spell 711 — Grina (Osamodas).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/711/scripts/scripts/
 *
 * displayType=11 (TargetCell). This is a single-impact animation at the
 * target cell. There is no projectile, no caster reference, no dual-
 * anchored layout. The outer sprite (DefineSprite_30, 129 frames) lands
 * at the target and plays through, calling _parent.removeMovieClip() at
 * frame 127.
 *
 * Library symbols (all `lib_` prefixed in texture provider):
 *
 *   - sprite5 (DefineSprite_5, characterId=5) — single-frame rotating
 *     "spark" disc. onEnterFrame flickers alpha randomly [25, 50).
 *     Placed INSIDE sprite23 at depth 1, position (0,0).
 *
 *   - sprite23 (DefineSprite_23, characterId=23) — 96-frame spiral ring
 *     that contains sprite5. onLoad seeds rotation velocity v=150.
 *     onEnterFrame integrates: _rotation += (v *= 0.94575).
 *     Placed INSIDE sprite29 at depth 1 with a skew/scale matrix.
 *     10 instances of sprite28 are also pre-placed inside sprite29 at
 *     various depths (23,27,31,35,39,43,47,51,55,59) — all with the
 *     same onClipEvent(load): gotoAndPlay(random(10)).
 *
 *   - sprite28 (DefineSprite_28, characterId=28) — 37-frame spark
 *     element. frame_1: _rotation = -random(180). frame_37: stop().
 *     onLoad on each instance: gotoAndPlay(random(10)).
 *
 *   - sprite29 (DefineSprite_29, characterId=29) — 225-frame composite
 *     container holding sprite23 + 10 sprite28 instances.
 *     Placed inside DefineSprite_30 at frame 0 with fade-in color tween
 *     (frames 0-36) and fade-out (frames 112-123) via alphaMult.
 *
 *   - DefineSprite_30 (the outer clip, anim1 / "sprite30") — 129 frames.
 *     frame_4: SOMA.playSound("grina_711").
 *     frame_127: _parent.removeMovieClip(); stop().
 *
 * The outer composite (anim1) is attached as the root child.
 * signalHit fires at frame_4 (the canonical impact / sound frame).
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

// Bounds from manifest.json librarySymbols[]

const SPRITE5_BOUNDS = {
  width: 107.65,
  height: 107.65,
  offsetX: -53.8,
  offsetY: -53.8,
};

const SPRITE23_BOUNDS = {
  width: 228.4,
  height: 228.4,
  offsetX: -115.25,
  offsetY: -114.8,
};

const SPRITE29_BOUNDS = {
  width: 343,
  height: 181.5,
  offsetX: -172.75,
  offsetY: -90.55,
};

// DefineSprite_30 / anim1 shares the same bounds as sprite29
const SPRITE30_BOUNDS = {
  width: 343,
  height: 181.5,
  offsetX: -172.75,
  offsetY: -90.55,
};

export class Spell711 extends RuntimeSpell {
  readonly spellId = 711;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold symbol refs so onSpellStart can attach the outer clip
  private sprite30Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite5Anchor = calculateAnchor(SPRITE5_BOUNDS);
    const sprite23Anchor = calculateAnchor(SPRITE23_BOUNDS);
    const sprite29Anchor = calculateAnchor(SPRITE29_BOUNDS);
    const sprite30Anchor = calculateAnchor(SPRITE30_BOUNDS);

    // ----------------------------------------------------------------
    // sprite5 — single-frame spark disc with alpha flicker
    // AS: scripts/DefineSprite_5/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // ----------------------------------------------------------------
    const sprite5Sym: SymbolDefinition = {
      name: "sprite5",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
      onEnterFrame: (clip) => {
        // AS: _alpha = random(25) + 25;
        clip.alpha = (Math.floor(Math.random() * 25) + 25) / 100;
      },
    };

    // ----------------------------------------------------------------
    // sprite23 — 96-frame spiral ring, contains sprite5
    // AS onLoad:   scripts/DefineSprite_23/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS enterFrame: scripts/DefineSprite_23/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // ----------------------------------------------------------------
    const sprite23Sym: SymbolDefinition = {
      name: "sprite23",
      totalFrames: 96,
      frames: textures.getFrames("lib_sprite23"),
      anchorX: sprite23Anchor.x,
      anchorY: sprite23Anchor.y,
      onLoad: (clip, ctx) => {
        // AS: v = 150;
        clip.vars.v = 150;
        // Place sprite5 at depth 1 inside sprite23 at (0,0) — mirrors
        // PlaceObject2_5_1 placement at frame 0 inside DefineSprite_23.
        clip.attach(sprite5Sym, "sprite5", 1, ctx);
      },
      onEnterFrame: (clip) => {
        // AS: _rotation = _rotation + (v *= 0.94575);
        let v = clip.vars.v as number;
        v *= 0.94575;
        clip.vars.v = v;
        // AS rotation in degrees → radians delta
        clip.rotation += (v * Math.PI) / 180;
      },
    };

    // ----------------------------------------------------------------
    // sprite28 — 37-frame spark element with random phase start
    // AS frame_1:  scripts/DefineSprite_28/frame_1/DoAction.as
    //              _rotation = -random(180)
    // AS frame_37: scripts/DefineSprite_28/frame_37/DoAction.as
    //              stop()
    // Each placement inside sprite29 has:
    //   onClipEvent(load): gotoAndPlay(random(10))
    //   (scripts/DefineSprite_29/frame_1/PlaceObject2_28_*/CLIPACTIONRECORD onClipEvent(load).as)
    // ----------------------------------------------------------------
    const sprite28Sym: SymbolDefinition = {
      name: "sprite28",
      totalFrames: 37,
      frames: textures.getFrames("lib_sprite28"),
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS (per PlaceObject2_28_*): onClipEvent(load){ gotoAndPlay(random(10)); }
        clip.gotoAndPlay(Math.floor(Math.random() * 10));
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_28/frame_1/DoAction.as: _rotation = -random(180);
            clip.rotation = (-(Math.floor(Math.random() * 180)) * Math.PI) / 180;
          },
        ],
        [
          36,
          (clip) => {
            // AS DefineSprite_28/frame_37/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite29 — 225-frame composite container
    // Holds sprite23 (at depth 1 with skew matrix) and 10 sprite28
    // instances at various depths.
    //
    // Placement matrix for sprite23 inside sprite29 (from manifest):
    //   scaleX=0.7578, scaleY=0.3869, rotateSkew0=-0.4079, rotateSkew1=0.7439
    //   translateX=0, translateY=0
    // We decompose via atan2: rotation = atan2(rotateSkew0, scaleX)
    //
    // The 10 sprite28 instances are at depths 23,27,31,35,39,43,47,51,55,59
    // (from the PlaceObject2_28_* filenames inside DefineSprite_29).
    //
    // sprite29 itself has a long color-tween schedule (alphaMult fade-in
    // frames 0-36, full opacity frames 36-112, fade-out frames 112-123).
    // This is encoded in the sprite29 PlaceObject2 placements inside
    // DefineSprite_30, and we handle it via the sprite30 frameScripts
    // on the sprite29 child clip.
    // ----------------------------------------------------------------
    const sprite29Sym: SymbolDefinition = {
      name: "sprite29",
      totalFrames: 225,
      frames: textures.getFrames("lib_sprite29"),
      anchorX: sprite29Anchor.x,
      anchorY: sprite29Anchor.y,
      onLoad: (clip, ctx) => {
        // Attach sprite23 at depth 1 with the PlaceObject2 skew matrix.
        // Matrix from manifest: scaleX=0.757843, scaleY=0.3869, rotateSkew0=-0.4079, rotateSkew1=0.7439
        // Rotation = atan2(rotateSkew1, scaleX) = atan2(0.7439, 0.7578)
        const rot23 = Math.atan2(0.7438812255859375, 0.757843017578125);
        const child23 = clip.attach(sprite23Sym, "sprite23", 1, ctx, {
          x: 0,
          y: 0,
          rotation: rot23,
        });
        child23.scaleX = Math.sqrt(
          0.757843017578125 * 0.757843017578125 +
            (-0.4078826904296875) * (-0.4078826904296875),
        );
        child23.scaleY = Math.sqrt(
          0.7438812255859375 * 0.7438812255859375 +
            0.3869476318359375 * 0.3869476318359375,
        );

        // Attach 10 sprite28 instances at the depths matching the
        // PlaceObject2_28_* placements in DefineSprite_29 frame_1.
        // Depths from filenames: 23,27,31,35,39,43,47,51,55,59
        const depths = [23, 27, 31, 35, 39, 43, 47, 51, 55, 59];
        for (let i = 0; i < depths.length; i++) {
          clip.attach(sprite28Sym, `sprite28_${depths[i]}`, depths[i], ctx);
        }
      },
    };

    // ----------------------------------------------------------------
    // DefineSprite_30 / outer clip ("sprite30") — 129 frames
    // This is the outermost spell clip placed at the target.
    // frame_4:   SOMA.playSound("grina_711")  → signalHit
    // frame_127: _parent.removeMovieClip(); stop() → complete()
    //
    // It also drives the sprite29 alpha tween via PlaceObject2 "move"
    // color transforms from frame 0 (alphaMult=0, white flash) through
    // frame 36 (alphaMult=256, normal), then fade-out starting frame
    // 112 down to 0 at frame 123. We implement this as an onEnterFrame
    // on the sprite30 clip that reads its currentFrame and updates
    // sprite29's alpha accordingly.
    // ----------------------------------------------------------------
    const sprite30Sym: SymbolDefinition = {
      name: "sprite30",
      totalFrames: 129,
      frames: textures.getFrames("anim1"),
      anchorX: sprite30Anchor.x,
      anchorY: sprite30Anchor.y,
      onLoad: (clip, ctx) => {
        // Place sprite29 at depth 1 with identity matrix, starting
        // with alphaMult=0 (pure white flash at frame 0 of sprite30).
        const child29 = clip.attach(sprite29Sym, "sprite29", 1, ctx);
        // Frame 0 of sprite30: alphaMult=0 (fully white/transparent content)
        child29.alpha = 0;
      },
      onEnterFrame: (clip) => {
        // Drive the sprite29 alpha tween that the PlaceObject2 "move"
        // color transforms encode in the canonical SWF.
        // Fade-in: frames 0-36 → alphaMult goes from 0 to 256 (step ~7 per frame)
        // Full:    frames 36-112 → alphaMult = 256
        // Fade-out: frames 112-123 → alphaMult steps 235,213,192,171,149,128,107,85,64,43,21,0
        const cf = clip.currentFrame;
        const child29 = clip.children.get("sprite29");
        if (!child29) {
          return;
        }
        if (cf <= 36) {
          // linear fade-in: at frame N, alphaMult = N * 7 (approx)
          // Exact values from manifest: frame 0 = alphaMult 0, frame 36 = 256
          child29.alpha = (cf / 36);
        } else if (cf <= 112) {
          child29.alpha = 1;
        } else if (cf <= 123) {
          // Fade-out steps from manifest placements:
          // 112→235/256, 113→213/256, 114→192/256, 115→171/256,
          // 116→149/256, 117→128/256, 118→107/256, 119→85/256,
          // 120→64/256, 121→43/256, 122→21/256, 123→0/256
          const fadeAlphaMults = [235, 213, 192, 171, 149, 128, 107, 85, 64, 43, 21, 0];
          const idx = cf - 112;
          const alphaMult = fadeAlphaMults[idx] ?? 0;
          child29.alpha = alphaMult / 256;
        } else {
          child29.alpha = 0;
        }
      },
      frameScripts: new Map([
        [
          3,
          (_clip) => {
            // AS DefineSprite_30/frame_4/DoAction.as: SOMA.playSound("grina_711")
            // Sound is played from onSpellStart; but canonical frame_4
            // also marks the impact moment — signal hit here.
            this.runtime.signalHit();
          },
        ],
        [
          126,
          (clip) => {
            // AS DefineSprite_30/frame_127/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.sprite30Sym = sprite30Sym;

    this.registry.register(sprite5Sym);
    this.registry.register(sprite23Sym);
    this.registry.register(sprite28Sym);
    this.registry.register(sprite29Sym);
    this.registry.register(sprite30Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline frame_1/DoAction.as is empty for spell 711.
    // The sound "grina_711" fires at frame_4 of DefineSprite_30 (=
    // frameScripts[3] above). We play it here as well to match the
    // canonical "sounds" manifest entry at frame 3 of the main timeline.
    callbacks.playSound("grina_711");

    // Attach the outer clip (sprite30 / anim1) at the root so it
    // starts ticking from the next runtime frame.
    this.root.attach(this.sprite30Sym, "sprite30", 1, context);
  }
}
