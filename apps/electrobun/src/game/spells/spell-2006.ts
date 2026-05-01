/**
 * Spell 2006 — Griffe (Sacrieur / Sram-type claw strike).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2006/scripts/scripts/
 *
 * displayType=11 (TargetCell). The outer sprite (sprite_26, 183 frames)
 * positions itself at _parent.cellTo in its frame_1 DoAction_2.as, which
 * is the canonical TargetCell pattern — no "move/shoot" projectile, no
 * caster reference, single impact at target.
 *
 * Canonical symbol layout:
 *
 *   sprite_26  — main outer container, 183 frames. Attached by harness
 *                as the root content for TargetCell. Key frames:
 *                  frame_1  : SOMA.playSound("grina_709"); self-position at cellTo.
 *                  frame_25 : SOMA.playSound("wab_2006").
 *                  frame_34 : this.end() → signalHit.
 *                  frame_97 : _parent.removeMovieClip() → complete.
 *                On frame_25 (0-indexed 24), lib_sprite24 is placed at depth 4.
 *
 *   lib_sprite24 — "sprite24", characterId 24, directlyDynamic: true.
 *                  Composite; 1 frame. Contains three placed lib_sprite23
 *                  instances (PlaceObject2_23_3, _23_7, _23_11) each with
 *                  an onClipEvent(load) that randomises their starting frame.
 *                  Placed into sprite_26 at frame 25 (0-indexed 24) at depth 4,
 *                  alpha fades from 256→0 over frames 73–93 of sprite_26.
 *
 *   lib_sprite23 — "sprite23", characterId 23, 15 frames. A spinning
 *                  glow/ring element placed 3 times inside sprite24.
 *                  onClipEvent(load): gotoAndPlay(random(_totalframes + 1)).
 *                  No enterFrame needed — the clip simply loops.
 *                  frame_1 of sprite_23: _rotation = -random(180) (baked into
 *                  the lib_sprite23 frameScript).
 *
 *   lib_sprite18 — "sprite18", characterId 18, directlyDynamic: true.
 *                  1 frame, a glowing disc placed inside sprite24 at depth 1
 *                  with a skewed matrix. onEnterFrame: _rotation += 1.67 deg/frame.
 *
 *   sprite_16    — "sprite16", 54 frames, a looping sub-element.
 *                  frame_1: gotoAndPlay(random(30) + 2).
 *                  frame_52: gotoAndPlay(2).
 *                  Placed on the main timeline (in sprite_26 composite).
 *
 * Main timeline (frame_2/DoAction.as): stop().
 * The main SWF only has 2 frames; frame_1 attaches sprite_26 implicitly.
 * We attach sprite_26 from onSpellStart with TargetCell placement.
 *
 * Alpha fade of sprite24 (inside sprite_26's authored timeline, frames 73–93):
 * This is expressed as a series of PlaceObject2 "move" records in the
 * manifest's placements[]. We implement this as a per-frame alpha interpolation
 * in sprite_26's frameScripts entries for those frames.
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

const SPRITE18_BOUNDS = {
  width: 85.7,
  height: 85.7,
  offsetX: -42.85,
  offsetY: -42.85,
};

const SPRITE24_BOUNDS = {
  width: 138.75,
  height: 68.1,
  offsetX: -64.35,
  offsetY: -34.05,
};

// sprite_23 is an animation entry (not a librarySymbol), so use bare key.
// Bounds from animations[]: width=56.65, height=2.8, offsetX=18, offsetY=-2.75
const SPRITE23_BOUNDS = {
  width: 56.65,
  height: 2.8,
  offsetX: 18,
  offsetY: -2.75,
};

// sprite_26 is an animation entry: width=162, height=355.3, offsetX=-80.95, offsetY=-306.55
const SPRITE26_BOUNDS = {
  width: 162,
  height: 355.3,
  offsetX: -80.95,
  offsetY: -306.55,
};

// sprite_16 is an animation entry: width=34.5, height=13.4, offsetX=-0.7, offsetY=-13.4
const SPRITE16_BOUNDS = {
  width: 34.5,
  height: 13.4,
  offsetX: -0.7,
  offsetY: -13.4,
};

export class Spell2006 extends RuntimeSpell {
  readonly spellId = 2006;
  readonly displayType = SpellDisplayType.TargetCell;

  // Stored for use in onSpellStart attach
  private sprite26Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite18Anchor = calculateAnchor(SPRITE18_BOUNDS);
    const sprite24Anchor = calculateAnchor(SPRITE24_BOUNDS);
    const sprite23Anchor = calculateAnchor(SPRITE23_BOUNDS);
    const sprite26Anchor = calculateAnchor(SPRITE26_BOUNDS);
    const sprite16Anchor = calculateAnchor(SPRITE16_BOUNDS);

    // ---- lib_sprite18 — rotating glowing disc --------------------
    // Placed inside sprite24 at depth 1 with a skewed matrix:
    //   scaleX=0.7578, scaleY=0.3869, rotateSkew0=-0.4079, rotateSkew1=0.7439
    //   translateX=0, translateY=0
    // AS: DefineSprite_18/frame_1/PlaceObject2_17_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + 1.67;
    const sprite18Sym: SymbolDefinition = {
      name: "sprite18",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite18"),
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_18/frame_1/PlaceObject2_17_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation + 1.67;
        clip.rotation += (1.67 * Math.PI) / 180;
      },
    };

    // ---- lib_sprite23 — glow ring, 15 frames, loops randomly -----
    // Placed 3 times inside sprite24. Each instance has:
    // AS: DefineSprite_24/frame_1/PlaceObject2_23_*/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(_totalframes + 1));
    // AS: DefineSprite_23/frame_1/DoAction.as
    //   _rotation = -random(180);
    const sprite23Sym: SymbolDefinition = {
      name: "sprite23",
      totalFrames: 15,
      frames: textures.getFrames("sprite_23"),
      anchorX: sprite23Anchor.x,
      anchorY: sprite23Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_24/frame_1/PlaceObject2_23_*/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndPlay(random(_totalframes + 1));
        const startFrame = Math.floor(Math.random() * (15 + 1));
        clip.gotoAndPlay(startFrame);
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_23/frame_1/DoAction.as
            // _rotation = -random(180);
            clip.rotation = (-(Math.floor(Math.random() * 180)) * Math.PI) / 180;
          },
        ],
      ]),
    };

    // ---- lib_sprite24 — composite container with 3 sprite23 instances + sprite18 --
    // directlyDynamic: true, 1 frame.
    // Contains three sprite23 at depths 3, 7, 11 (PlaceObject2_23_3, _23_7, _23_11)
    // and sprite18 at depth 1 with the skewed matrix.
    // The placement matrix for sprite18: scaleX=0.7578, scaleY=0.3869,
    //   rotateSkew0=-0.4079, rotateSkew1=0.7439, translateX=0, translateY=0
    // Rotation extracted: Math.atan2(rotateSkew0, scaleX) = Math.atan2(-0.4079, 0.7578)
    const sprite18PlacementRotation = Math.atan2(-0.4078826904296875, 0.757843017578125);
    const sprite18PlacementScaleX = Math.sqrt(
      0.757843017578125 * 0.757843017578125 +
        (-0.4078826904296875) * (-0.4078826904296875)
    );
    const sprite18PlacementScaleY = Math.sqrt(
      0.7438812255859375 * 0.7438812255859375 +
        0.3869476318359375 * 0.3869476318359375
    );

    const sprite24Sym: SymbolDefinition = {
      name: "sprite24",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite24"),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_24/frame_1 — place sprite18 at depth 1 (skewed matrix)
            // and three sprite23 instances at depths 3, 7, 11.
            // Each sprite23 instance gets an independent onLoad randomisation.

            // Attach sprite18 with placement matrix
            const s18 = clip.attach(sprite18Sym, "sprite18_1", 1, ctx, {
              x: 0,
              y: 0,
              rotation: sprite18PlacementRotation,
            });
            s18.scaleX = sprite18PlacementScaleX;
            s18.scaleY = sprite18PlacementScaleY;

            // Attach sprite23 at depth 3 (PlaceObject2_23_3)
            clip.attach(sprite23Sym, "sprite23_3", 3, ctx);

            // Attach sprite23 at depth 7 (PlaceObject2_23_7)
            clip.attach(sprite23Sym, "sprite23_7", 7, ctx);

            // Attach sprite23 at depth 11 (PlaceObject2_23_11)
            clip.attach(sprite23Sym, "sprite23_11", 11, ctx);
          },
        ],
      ]),
    };

    // ---- sprite_16 — looping sub-element (54 frames) -------------
    // AS: DefineSprite_16/frame_1/DoAction.as
    //   gotoAndPlay(random(30) + 2);
    // AS: DefineSprite_16/frame_52/DoAction.as
    //   gotoAndPlay(2);
    const sprite16Sym: SymbolDefinition = {
      name: "sprite_16",
      totalFrames: 54,
      frames: textures.getFrames("sprite_16"),
      anchorX: sprite16Anchor.x,
      anchorY: sprite16Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_16/frame_1/DoAction.as
            // gotoAndPlay(random(30) + 2);
            const target = Math.floor(Math.random() * 30) + 2;
            clip.gotoAndPlay(target - 1);
          },
        ],
        [
          51,
          (clip) => {
            // AS: DefineSprite_16/frame_52/DoAction.as
            // gotoAndPlay(2);
            clip.gotoAndPlay(1);
          },
        ],
      ]),
    };

    // ---- sprite_26 — main outer container (183 frames) -----------
    // Positioned at cellTo on frame_1.
    // frame_1  (index 0):  SOMA.playSound("grina_709") [handled in onSpellStart]
    //                      _X = _parent.cellTo.x; _Y = _parent.cellTo.y
    //                      [For TargetCell the harness anchors root at cellTo,
    //                       so this clip's container is already at (0,0) relative
    //                       to the target. We still apply the position from vars.]
    // frame_25 (index 24): SOMA.playSound("wab_2006") + attach sprite24
    // frame_34 (index 33): this.end() → signalHit
    // frame_97 (index 96): _parent.removeMovieClip() → complete
    //
    // Alpha fade of sprite24 at depth 4: placements "move" from frame 73 to 93
    //   alphaMult goes 244→232→219→...→0 over 21 frames (73 inclusive to 93 inclusive).
    //   We implement this via individual frameScripts entries for each step.
    //   alphaMult values (0-256 scale): at frame 73=244, 74=232, ..., 93=0
    //   Pattern: alphaMult = 256 - 12*(frame - 72) where frame is 1-based (73..93)
    //   i.e. at 0-based index f: alpha = (256 - 12 * (f - 72)) / 256  for f in [72..92]

    // Build the alpha fade frameScripts map
    const sprite26FrameScripts = new Map<number, (clip: import("@dofus/spell-runtime").SpellClip, ctx: SpellContext) => void>();

    // We need to reference SpellClip type but can't import pixi — use the clip param type implicitly.
    // Store sound callback reference for use in frameScripts
    // (sounds are captured via onSpellStart; we use a closure over the instance)
    // The sound for frame_25 needs to be triggered from a frameScript.
    // We'll store a reference in instance vars.

    // frame_1 (index 0): position at cellTo
    sprite26FrameScripts.set(0, (clip) => {
      // AS: DefineSprite_26/frame_1/DoAction_2.as
      // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
      // The container is already positioned at cellTo by the TargetCell harness
      // (root is anchored at cellTo). sprite_26 is attached as a child of root,
      // so its local (0,0) is the target cell. No adjustment needed.
      // However, for correctness we explicitly set to 0,0 relative to root.
      clip.x = 0;
      clip.y = 0;
    });

    // frame_25 (index 24): play sound + attach sprite24
    sprite26FrameScripts.set(24, (clip, ctx) => {
      // AS: DefineSprite_26/frame_25/DoAction.as
      // SOMA.playSound("wab_2006");
      if (this.soundCallback) {
        this.soundCallback("wab_2006");
      }
      // AS: placement of sprite24 at depth 4, frame 25 (0-indexed 24)
      // matrix: identity, translateX=0, translateY=0
      clip.attach(sprite24Sym, "sprite24_4", 4, ctx, { x: 0, y: 0 });
    });

    // frame_34 (index 33): this.end() → signalHit
    sprite26FrameScripts.set(33, (_clip) => {
      // AS: DefineSprite_26/frame_34/DoAction.as
      // this.end();
      this.runtime.signalHit();
    });

    // Alpha fade of sprite24: frames 73–93 (0-indexed 72–92)
    // alphaMult values from placements[]: 244, 232, 219, 207, 195, 183, 171, 158, 146, 134, 122, 110, 98, 85, 73, 61, 49, 37, 24, 12, 0
    const alphaMults = [244, 232, 219, 207, 195, 183, 171, 158, 146, 134, 122, 110, 98, 85, 73, 61, 49, 37, 24, 12, 0];
    for (let i = 0; i < alphaMults.length; i++) {
      const frameIdx = 72 + i; // 0-indexed frames 72..92
      const alphaValue = alphaMults[i]! / 256;
      sprite26FrameScripts.set(frameIdx, (clip) => {
        // AS: PlaceObject2 "move" colorTransform on sprite24 at depth 4
        // alphaMult / 256 → alpha
        const s24 = clip.children.get("sprite24_4");
        if (s24) {
          s24.alpha = alphaValue;
        }
      });
    }

    // frame_97 (index 96): _parent.removeMovieClip() → complete
    sprite26FrameScripts.set(96, (clip) => {
      // AS: DefineSprite_26/frame_97/DoAction.as
      // _parent.removeMovieClip();
      clip.remove();
      this.runtime.complete();
    });

    this.sprite26Sym = {
      name: "sprite_26",
      totalFrames: 183,
      frames: textures.getFrames("sprite_26"),
      anchorX: sprite26Anchor.x,
      anchorY: sprite26Anchor.y,
      frameScripts: sprite26FrameScripts,
    };

    this.registry.register(sprite18Sym);
    this.registry.register(sprite23Sym);
    this.registry.register(sprite24Sym);
    this.registry.register(sprite16Sym);
    this.registry.register(this.sprite26Sym);
  }

  // Capture playSound callback for use in frameScripts
  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Capture sound callback for use inside frameScripts (frame_25)
    this.soundCallback = callbacks.playSound;

    // AS: DefineSprite_26/frame_1/DoAction.as
    // SOMA.playSound("grina_709");
    callbacks.playSound("grina_709");

    // Main timeline: sprite_26 is placed as the top-level content.
    // Attach it to root at depth 1.
    this.root.attach(this.sprite26Sym, "sprite26", 1, context, { x: 0, y: 0 });

    // AS: frame_2/DoAction.as — stop() on the main timeline.
    // The main SWF stops at frame 2; sprite_26 drives the full animation.
    // root is a single-frame container driven by sprite_26's timeline, so no stop needed here.
  }
}
