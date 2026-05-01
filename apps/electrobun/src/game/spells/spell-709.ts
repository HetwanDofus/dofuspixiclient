/**
 * Spell 709 — Grina (Sram trap / poison needle, WorldAbsolute).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 *
 * Canonical AS layout (`tools/combat-exporter/output/spell-anims/709/scripts/scripts/`):
 *
 *   Main timeline:
 *     frame_2/DoAction.as    — SOMA.playSound("grina_709b"); stop();
 *     frame_2/DoAction_2.as  — stop();
 *
 *   Two authored parallel timelines placed on the main timeline:
 *     sprite_17 (183 frames) — caster-side; frame_1 positions self at
 *                              cellFrom. frame_181 calls
 *                              _parent.removeMovieClip() → complete.
 *     sprite_24 (174 frames) — target-side; frame_1 positions self at
 *                              cellTo. frame_73 plays "vlad_804".
 *                              frame_79 calls this.end() → signalHit.
 *                              frame_172 calls _parent.removeMovieClip()
 *                              (sprite_24 removes itself; the outer mc
 *                              lifecycle is owned by sprite_17).
 *
 *   library symbol sprite16 (characterId=16, directlyDynamic=true, 117 frames):
 *     Three instances placed inside sprite_17 (DefineSprite_17) at frame 0,
 *     depths 5, 9, 13. Each carries an onClipEvent(load) that does:
 *       gotoAndPlay(random(_totalframes + 1));
 *     Textures under lib_sprite16_*.svg.
 *     The three PlaceObject2 entries are at depths 5, 9, 13 (directory names
 *     PlaceObject2_6_5, PlaceObject2_6_9, PlaceObject2_6_13 — the second
 *     number is the depth). All three carry identical onLoad: randomise
 *     starting frame.
 *
 *   Additionally, the placements[] array on sprite16 records a "place" at
 *   parent sprite_17 frame 0 (one entry), then series of alphaMult tween
 *   "move" entries from frame 112 onward (fade-out). We handle the initial
 *   alpha (1.0) from placement and the fade-out by reading the tween in a
 *   per-tick frameScripts entry on sprite_17.
 *
 * displayType=50 (WorldAbsolute): the container is at world (0,0); both
 * sprite_17 and sprite_24 read _parent.cellFrom / _parent.cellTo and
 * position themselves in world coords. Neither is a projectile and neither
 * requires a caster-rotated container — WorldAbsolute is the correct choice.
 * The harness only seeds root.vars with cellFrom/cellTo/angle; per-spell
 * frame_1 scripts do the actual positioning.
 *
 * Sounds:
 *   main timeline frame_2: "grina_709b"
 *   DefineSprite_16/frame_49: "grina_709"  — fired from lib_sprite16 frameScripts
 *   DefineSprite_24/frame_73: "vlad_804"   — fired from sprite_24 frameScripts
 *
 * signalHit: sprite_24 frame_79 (this.end()).
 * complete:  sprite_17 frame_181 (_parent.removeMovieClip()).
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

// ---- Manifest bounds ---------------------------------------------------------

const SPRITE16_BOUNDS = {
  width: 249.35,
  height: 295.35,
  offsetX: -124.7,
  offsetY: -229.35,
};

const SPRITE17_BOUNDS = {
  width: 249.35,
  height: 295.35,
  offsetX: -124.7,
  offsetY: -229.35,
};

const SPRITE24_BOUNDS = {
  width: 96.45,
  height: 254.3,
  offsetX: -47.35,
  offsetY: -229.35,
};

export class Spell709 extends RuntimeSpell {
  readonly spellId = 709;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  // Hold refs so onSpellStart can attach them after registerSymbols
  private sprite17Sym!: SymbolDefinition;
  private sprite24Sym!: SymbolDefinition;

  // Sound callback captured in onSpellStart for use inside frameScripts
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite16Anchor = calculateAnchor(SPRITE16_BOUNDS);
    const sprite17Anchor = calculateAnchor(SPRITE17_BOUNDS);
    const sprite24Anchor = calculateAnchor(SPRITE24_BOUNDS);

    // ---- lib_sprite16 — 117-frame spark/needle particle --------------
    //
    // directlyDynamic: true.  Three instances are placed inside sprite_17
    // at frame 0 (depths 5, 9, 13).  Each carries:
    //
    //   onClipEvent(load):
    //     gotoAndPlay(random(_totalframes + 1));
    //
    // AS: scripts/DefineSprite_16/frame_1/PlaceObject2_6_5,9,13/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //
    // frame_49 of this sprite plays "grina_709" via SOMA.playSound.
    // The sprite loops its 117-frame timeline continuously.
    //
    // The placements[] array also records alphaMult tween moves starting
    // at parent sprite_17 frame 112 (frames 112-123: 235→213→192→…→0).
    // We implement this fade-out inside sprite_17's frameScripts by
    // checking the current frame and setting alpha on the three children.
    const sprite16Sym: SymbolDefinition = {
      name: "sprite16",
      totalFrames: 117,
      frames: textures.getFrames("lib_sprite16"),
      anchorX: sprite16Anchor.x,
      anchorY: sprite16Anchor.y,

      // AS: DefineSprite_16/frame_1/PlaceObject2_6_*/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        // gotoAndPlay(random(_totalframes + 1))
        // _totalframes = 117 in canonical AS (1-based total).
        // random(118) gives [0,117]; gotoAndPlay(0) is frame 1 → 0-based: 0.
        // random(118) upper exclusive → gotoAndPlay(0..117) → 0-based (0..116).
        const rnd = Math.floor(Math.random() * (117 + 1));
        const frame0 = Math.min(rnd, 116); // clamp to valid 0-based range
        clip.gotoAndPlay(frame0);
      },

      frameScripts: new Map([
        [
          // AS: DefineSprite_16/frame_49/DoAction.as — SOMA.playSound("grina_709")
          48,
          (_clip) => {
            if (this.soundCallback) {
              this.soundCallback("grina_709");
            }
          },
        ],
      ]),
    };

    // ---- sprite_17 — caster-side 183-frame timeline ------------------
    //
    // Placed on the main timeline at depth 1 (inferred from AS structure).
    // frame_1:   _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y;
    // frame_1 also places three sprite16 children (depths 5, 9, 13).
    // frame_112-123: alpha fade on the sprite16 children (from placements[]).
    // frame_181:  _parent.removeMovieClip() → runtime.complete()
    //
    // Alpha tween schedule from placements[] (alphaMult / 256):
    //   frame 112 → 235/256 ≈ 0.918
    //   frame 113 → 213/256 ≈ 0.832
    //   frame 114 → 192/256 = 0.750
    //   frame 115 → 171/256 ≈ 0.668
    //   frame 116 → 149/256 ≈ 0.582
    //   frame 117 → 128/256 = 0.500
    //   frame 118 → 107/256 ≈ 0.418
    //   frame 119 →  85/256 ≈ 0.332
    //   frame 120 →  64/256 = 0.250
    //   frame 121 →  43/256 ≈ 0.168
    //   frame 122 →  21/256 ≈ 0.082
    //   frame 123 →   0/256 = 0.000
    //
    // We implement the tween as individual frameScripts entries at each
    // keyframe, setting alpha on all three sprite16 children.
    const alphaKeyframes: [number, number][] = [
      [111, 235 / 256],
      [112, 213 / 256],
      [113, 192 / 256],
      [114, 171 / 256],
      [115, 149 / 256],
      [116, 128 / 256],
      [117, 107 / 256],
      [118, 85 / 256],
      [119, 64 / 256],
      [120, 43 / 256],
      [121, 21 / 256],
      [122, 0 / 256],
    ];

    const sprite17FrameScripts = new Map<
      number,
      (clip: import("@dofus/spell-runtime").SpellClip, ctx: SpellContext) => void
    >();

    // frame_1 (0-based: 0): position at cellFrom + attach three sprite16 children
    // AS: DefineSprite_17/frame_1/DoAction.as
    sprite17FrameScripts.set(0, (clip, ctx) => {
      // _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y;
      const root = clip.parent;
      const cellFrom = root?.vars.cellFrom as
        | { x: number; y: number }
        | undefined;
      if (cellFrom) {
        clip.x = cellFrom.x;
        clip.y = cellFrom.y;
      }

      // Three sprite16 instances placed at frame 0 of DefineSprite_17
      // (PlaceObject2_6_5, PlaceObject2_6_9, PlaceObject2_6_13)
      // depths 5, 9, 13 — identity matrix (translateX/Y = 0).
      // AS: DefineSprite_16/frame_1/PlaceObject2_6_5/onClipEvent(load).as
      clip.attach(sprite16Sym, "sprite16_d5", 5, ctx);
      clip.attach(sprite16Sym, "sprite16_d9", 9, ctx);
      clip.attach(sprite16Sym, "sprite16_d13", 13, ctx);
    });

    // Alpha tween keyframes for the three sprite16 children
    for (const [frame0, alphaVal] of alphaKeyframes) {
      sprite17FrameScripts.set(frame0, (clip) => {
        const d5 = clip.children.get("sprite16_d5");
        const d9 = clip.children.get("sprite16_d9");
        const d13 = clip.children.get("sprite16_d13");
        if (d5) {
          d5.alpha = alphaVal;
        }
        if (d9) {
          d9.alpha = alphaVal;
        }
        if (d13) {
          d13.alpha = alphaVal;
        }
      });
    }

    // frame_181 (0-based: 180): _parent.removeMovieClip() → complete
    // AS: DefineSprite_17/frame_181/DoAction.as
    sprite17FrameScripts.set(180, (clip) => {
      clip.remove();
      this.runtime.complete();
    });

    this.sprite17Sym = {
      name: "sprite_17",
      totalFrames: 183,
      frames: textures.getFrames("sprite_17"),
      anchorX: sprite17Anchor.x,
      anchorY: sprite17Anchor.y,
      frameScripts: sprite17FrameScripts,
    };

    // ---- sprite_24 — target-side 174-frame timeline ------------------
    //
    // Placed on the main timeline at depth 2.
    // frame_1:   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    // frame_73:  SOMA.playSound("vlad_804")
    // frame_79:  this.end() → signalHit
    // frame_172: _parent.removeMovieClip() → sprite_24 removes itself
    //            (outer mc lifetime is owned by sprite_17/frame_181)
    //
    // AS: DefineSprite_24/frame_*/DoAction.as
    this.sprite24Sym = {
      name: "sprite_24",
      totalFrames: 174,
      frames: textures.getFrames("sprite_24"),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
      frameScripts: new Map([
        [
          // AS: DefineSprite_24/frame_1/DoAction.as
          0,
          (clip) => {
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
          },
        ],
        [
          // AS: DefineSprite_24/frame_73/DoAction.as — SOMA.playSound("vlad_804")
          72,
          (_clip) => {
            if (this.soundCallback) {
              this.soundCallback("vlad_804");
            }
          },
        ],
        [
          // AS: DefineSprite_24/frame_79/DoAction.as — this.end() → signalHit
          78,
          (_clip) => {
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_24/frame_172/DoAction.as — _parent.removeMovieClip()
          // sprite_24 removes itself; the outer mc stays alive until sprite_17/frame_181.
          171,
          (clip) => {
            clip.remove();
          },
        ],
      ]),
    };

    this.registry.register(sprite16Sym);
    this.registry.register(this.sprite17Sym);
    this.registry.register(this.sprite24Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use inside frameScripts handlers
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_2/DoAction.as: SOMA.playSound("grina_709b"); stop();
    callbacks.playSound("grina_709b");

    // Attach both parallel authored timelines onto the root.
    // displayType=50 → root is at world (0,0); each sprite positions
    // itself at cellFrom / cellTo in its frame_1 frameScript.
    this.root.attach(this.sprite17Sym, "sprite17", 1, context);
    this.root.attach(this.sprite24Sym, "sprite24", 2, context);
  }
}
