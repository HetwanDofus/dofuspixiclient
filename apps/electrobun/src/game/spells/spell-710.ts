/**
 * Spell 710 — Grincheux / Greediness (Enutrof).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/710/scripts/scripts/
 *
 * displayType=10 (CasterCell). The outer container is anchored at the caster
 * cell. DefineSprite_24 positions itself at _parent.cellFrom, meaning it uses
 * WorldAbsolute-style self-positioning — but since the harness for CasterCell
 * places root at cellFrom, sprite_24's frame_1 script (_X = _parent.cellFrom.x;
 * _Y = _parent.cellFrom.y) would place it at absolute world coords. However,
 * looking at the AS structure: there are TWO top-level authored sprites (sprite_23
 * and sprite_24), both attached by onSpellStart. sprite_24 explicitly sets its
 * own position to cellFrom world coords, and sprite_23 contains its own internal
 * choreography. The simplest matching displayType is WorldAbsolute (50) so both
 * sprites can self-position using _parent.cellFrom / _parent.cellTo world coords
 * stored on root.vars.
 *
 * Library symbols:
 *   - sprite17 (characterId 17) — rotating dust/sparkle particle. directlyDynamic:true.
 *     onLoad: seeds v=1728. onEnterFrame: _rotation += (v *= 0.849) — spinning decay.
 *     Single visual frame (lib_sprite17_0.svg). Placed inside sprite23 starting at
 *     frame 60 (0-indexed 59) with animated color/scale tween across frames 60–90.
 *   - sprite23 (characterId 23) — main 225-frame attack animation (caster-side wind-up
 *     + coin throw). directlyDynamic:true. Has its own internal sprites (sprite_6
 *     instances at depths 5/9/13) with onLoad: gotoAndPlay(random(_totalframes+1)),
 *     plus sounds at frames 1/49/64, end() at frame 58, and sprite17 tween from
 *     frame 60. Placed inside sprite_24 at frame 0.
 *   - sprite_6 (AS DefineSprite_6) — 15-frame wind particle. onLoad randomises
 *     starting frame. frame_1 sets random rotation.
 *
 * Main timeline (frame_2/DoAction.as): stop().
 * sprite_24 (DefineSprite_24) is the outer wrapper:
 *   - frame_1: _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y
 *   - frame_163: _parent.removeMovieClip() → spell complete
 *   - Contains sprite23 placed at depth 1, frame 0
 *
 * sprite_23 (DefineSprite_23) internal timeline:
 *   - frame_1/DoAction.as: SOMA.playSound("grina_709b") + places 3 sprite_6 instances
 *     at depths 5/9/13 with random start-frame onLoad
 *   - frame_49: SOMA.playSound("grina_709") → signalHit
 *   - frame_58: this.end() → signalHit (damage popup)
 *   - frame_64: SOMA.playSound("grina_710")
 *   - frame_60 onwards: sprite17 tween (place + 30 move entries) — handled via
 *     onEnterFrame interpolation within sprite23
 *
 * Sound schedule (manifest.sounds, 0-based frames):
 *   frame 0: grina_709b  ← fires from sprite_23 frame_1
 *   frame 48: grina_709  ← fires from sprite_23 frame_49
 *   frame 63: grina_710  ← fires from sprite_23 frame_64
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

// ---- Bounds from manifest.librarySymbols ----
const SPRITE17_BOUNDS = {
  width: 42.35,
  height: 27.05,
  offsetX: -17.3,
  offsetY: -15.1,
};

const SPRITE23_BOUNDS = {
  width: 249.35,
  height: 274.8,
  offsetX: -124.7,
  offsetY: -208.8,
};

// sprite_6 bounds from manifest.animations (no lib_ prefix logic needed —
// it appears in librarySymbols indirectly through sprite23's internal placement;
// the manifest.animations entry name is "sprite_6")
const SPRITE6_BOUNDS = {
  width: 56.65,
  height: 2.8,
  offsetX: 18,
  offsetY: -2.75,
};

// sprite_24 bounds — same dimensions as sprite_23 (from manifest.animations)
const SPRITE24_BOUNDS = {
  width: 249.35,
  height: 274.8,
  offsetX: -124.7,
  offsetY: -208.8,
};

export class Spell710 extends RuntimeSpell {
  readonly spellId = 710;
  // displayType=50 (WorldAbsolute): root at world (0,0); sprite_24 self-positions
  // via _parent.cellFrom in its own frame_1 script.
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite6Sym!: SymbolDefinition;
  private sprite17Sym!: SymbolDefinition;
  private sprite23Sym!: SymbolDefinition;
  private sprite24Sym!: SymbolDefinition;

  // Capture sound callback for use inside frame scripts
  private playSoundFn: ((id: string) => void) | null = null;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);
    const sprite17Anchor = calculateAnchor(SPRITE17_BOUNDS);
    const sprite23Anchor = calculateAnchor(SPRITE23_BOUNDS);
    const sprite24Anchor = calculateAnchor(SPRITE24_BOUNDS);

    // ---- sprite_6 — wind/dust particle inside sprite_23 ----------------
    // AS DefineSprite_6/frame_1/DoAction.as: _rotation = -random(180)
    // AS PlaceObject2_6_5/onClipEvent(load): gotoAndPlay(random(_totalframes+1))
    // AS PlaceObject2_6_9/onClipEvent(load): gotoAndPlay(random(_totalframes+1))
    // AS PlaceObject2_6_13/onClipEvent(load): gotoAndPlay(random(_totalframes+1))
    // (All three placed sprite_6 instances share identical onLoad behaviour)
    this.sprite6Sym = {
      name: "sprite6",
      totalFrames: 15,
      frames: textures.getFrames("sprite_6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      onLoad: (clip) => {
        // AS PlaceObject2_6_*/onClipEvent(load): gotoAndPlay(random(_totalframes + 1))
        // _totalframes = 15; random(16) gives [0,15]; gotoAndPlay is 1-based in AS
        // → 0-based here: random(16) - 1 but AS random(16) gives [0,15] so we do:
        const frame = Math.floor(Math.random() * (15 + 1)); // random(16) → [0,15]
        // AS gotoAndPlay(frame) where frame can be 0 (= gotoAndPlay(0) = frame_0 invalid
        // in AS — effectively frame_1). Clamp to valid range [0, totalFrames-1].
        const targetFrame = Math.max(0, frame - 1); // AS 1-based → 0-based
        clip.gotoAndPlay(targetFrame);
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6/frame_1/DoAction.as: _rotation = -random(180)
            const deg = -Math.floor(Math.random() * 180);
            clip.rotation = (deg * Math.PI) / 180;
          },
        ],
      ]),
    };

    // ---- sprite17 — spinning decay particle placed inside sprite_23 -----
    // AS DefineSprite_17/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(load).as
    //   v = 1728;
    // AS DefineSprite_17/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + (v *= 0.849);
    this.sprite17Sym = {
      name: "sprite17",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite17"),
      anchorX: sprite17Anchor.x,
      anchorY: sprite17Anchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load): v = 1728
        clip.vars.v = 1728;
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame): _rotation = _rotation + (v *= 0.849)
        let v = clip.vars.v as number;
        v *= 0.849;
        clip.vars.v = v;
        // AS rotation in degrees → runtime in radians
        clip.rotation += (v * Math.PI) / 180;
      },
    };

    // ---- sprite23 — main 225-frame caster animation ------------------
    // directlyDynamic: true. Contains internal sprite_6 instances + sprite17 tween.
    // AS DefineSprite_23/frame_1/DoAction.as: SOMA.playSound("grina_709b")
    // AS DefineSprite_23/frame_49/DoAction.as: SOMA.playSound("grina_709")
    // AS DefineSprite_23/frame_58/DoAction.as: this.end()
    // AS DefineSprite_23/frame_64/DoAction.as: SOMA.playSound("grina_710")
    //
    // sprite17 placement starts at sprite_23's frame 60 (0-indexed: 59)
    // The manifest placements[] has kind:"place" at frame=60 (= frame index 59 in
    // runtime 0-based; but manifest frame values appear to be 0-based already based
    // on the first placement having frame:0 for sprite23 inside sprite24).
    // Cross-checking: placements[0] for sprite17 has frame:60 with kind:"place"
    // and subsequent kind:"move" entries at 61..90. We place at frame index 59
    // (AS frame_60 = 0-based 59) and handle the colour tween via onEnterFrame
    // interpolation from frame 60 to 90.
    //
    // sprite17 initial placement matrix (frame 60 / 0-based 59):
    //   scaleX:1, scaleY:0.5755, translateX:-0.9, translateY:-190.9
    //   alphaMult: 72/256
    //
    // At frame 90 (0-based 89), the tween reaches its final state:
    //   scaleX:1.4182, scaleY:0.7399, translateX:-0.9, translateY:-196.4
    //   colorTransform: null (fully opaque / default)

    this.sprite23Sym = {
      name: "sprite23",
      totalFrames: 225,
      frames: textures.getFrames("lib_sprite23"),
      anchorX: sprite23Anchor.x,
      anchorY: sprite23Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_23/frame_1/DoAction.as: SOMA.playSound("grina_709b")
            // Sound played via captured callback
            if (this.playSoundFn) {
              this.playSoundFn("grina_709b");
            }
            // AS PlaceObject2_6_5, PlaceObject2_6_9, PlaceObject2_6_13 —
            // three sprite_6 instances placed at depths 5, 9, 13.
            // Each gets the onLoad gotoAndPlay(random(_totalframes+1)) treatment.
            clip.attach(this.sprite6Sym, "sprite6_5", 5, ctx);
            clip.attach(this.sprite6Sym, "sprite6_9", 9, ctx);
            clip.attach(this.sprite6Sym, "sprite6_13", 13, ctx);
          },
        ],
        [
          48,
          () => {
            // AS DefineSprite_23/frame_49/DoAction.as: SOMA.playSound("grina_709")
            if (this.playSoundFn) {
              this.playSoundFn("grina_709");
            }
          },
        ],
        [
          57,
          () => {
            // AS DefineSprite_23/frame_58/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          59,
          (clip, ctx) => {
            // AS DefineSprite_23 frame 60 (0-based 59): place sprite17 at depth 19
            // Initial placement: scaleX:1, scaleY:0.5755, translateX:-0.9, translateY:-190.9
            // alphaMult: 72/256 ≈ 0.281
            const s17 = clip.attach(this.sprite17Sym, "sprite17_19", 19, ctx, {
              x: -0.9,
              y: -190.9,
            });
            s17.scaleX = 1;
            s17.scaleY = 0.575469970703125;
            s17.alpha = 72 / 256;
            // Store start frame so onEnterFrame can interpolate the tween
            // The tween runs from frame 60 to frame 90 (30 frames, 0-based 59..89)
            clip.vars.sprite17TweenStartFrame = clip.currentFrame;
          },
        ],
        [
          63,
          () => {
            // AS DefineSprite_23/frame_64/DoAction.as: SOMA.playSound("grina_710")
            if (this.playSoundFn) {
              this.playSoundFn("grina_710");
            }
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // Drive the sprite17 color/scale tween from frame 60 (0-based 59) to 90 (0-based 89).
        // We use the current frame index to compute interpolation t.
        const s17 = clip.children.get("sprite17_19");
        if (!s17) {
          return;
        }
        const cf = clip.currentFrame;
        // Tween active between frame indices 59 and 89 inclusive (AS frames 60–90)
        if (cf < 59 || cf > 89) {
          return;
        }
        // t: 0 at frame 59, 1 at frame 89
        const t = (cf - 59) / 30;
        // Interpolate transform from placement data
        // Start (frame 60): scaleX=1, scaleY=0.5755, x=-0.9, y=-190.9, alpha=72/256
        // End (frame 90): scaleX=1.4182, scaleY=0.7399, x=-0.9, y=-196.4, alpha=256/256=1
        s17.scaleX = 1 + (1.4182 - 1) * t;
        s17.scaleY = 0.5755 + (0.7399 - 0.5755) * t;
        s17.x = -0.9;
        s17.y = -190.9 + (-196.4 - (-190.9)) * t;
        s17.alpha = (72 + (256 - 72) * t) / 256;
      },
    };

    // ---- sprite_24 — outer 165-frame wrapper; self-positions at cellFrom ----
    // AS DefineSprite_24/frame_1/DoAction.as: _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y
    // AS DefineSprite_24/frame_163/DoAction.as: _parent.removeMovieClip()
    // Contains sprite23 placed at depth 1, frame 0 (placement kind:"place", frame:0)
    // The sprite23 within sprite24 fades out starting from its frame 148 (0-based 147)
    // via the placements[].colorTransform tween down to alphaMult=0 at frame 159 (0-based 158).
    // We handle this alpha fade via an onEnterFrame on sprite24.
    this.sprite24Sym = {
      name: "sprite24",
      totalFrames: 165,
      frames: textures.getFrames("sprite_24"),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_24/frame_1/DoAction.as:
            //   _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y;
            }
            // Place sprite23 at depth 1, frame 0 (PlaceObject2 placement kind:"place")
            clip.attach(this.sprite23Sym, "sprite23_1", 1, ctx);
          },
        ],
        [
          162,
          (clip) => {
            // AS DefineSprite_24/frame_163/DoAction.as: _parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // Handle sprite23's alpha fade-out tween (placement kind:"move" entries
        // on sprite24's timeline, depth 1, frames 148–159 / 0-based 147–158).
        // alphaMult progression: 256→235→213→192→171→149→128→107→85→64→43→21→0
        // over 12 frames (147..158 inclusive → t=0..1 over 12 steps)
        const s23 = clip.children.get("sprite23_1");
        if (!s23) {
          return;
        }
        const cf = clip.currentFrame;
        if (cf < 147) {
          // Fully opaque
          s23.alpha = 1;
        } else if (cf <= 158) {
          // Linear fade from alpha=1 down to alpha=0 over frames 147..158 (12 steps)
          const t = (cf - 147) / 12;
          s23.alpha = 1 - t;
        } else {
          s23.alpha = 0;
        }
      },
    };

    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite17Sym);
    this.registry.register(this.sprite23Sym);
    this.registry.register(this.sprite24Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use inside frame scripts
    this.playSoundFn = callbacks.playSound;

    // Main timeline frame_2/DoAction.as: stop() — handled implicitly since we don't
    // have a looping root timeline. We attach sprite_24 which drives everything.

    // Attach sprite_24 as the top-level child of root. sprite_24's frame_1 script
    // will self-position at cellFrom world coords (stored on root.vars.cellFrom
    // by configureHarness for WorldAbsolute).
    this.root.attach(this.sprite24Sym, "sprite24", 1, context);
  }
}
