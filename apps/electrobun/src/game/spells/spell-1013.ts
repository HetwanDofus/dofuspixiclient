/**
 * Spell 1013 — Lichide (Eniripsa poison/water spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1013/scripts/scripts/
 *
 * displayType=11 (TargetCell). The outer sprite_25 positions itself at
 * _parent.cellTo.x / _parent.cellTo.y on frame_1 — this is a standard
 * target-anchored impact pattern with no caster reference, no projectile,
 * no beam. The harness places the container at the target cell.
 *
 * Manifest has NO librarySymbols[] entries — all symbols appear only in
 * animations[]. Textures are accessed WITHOUT the `lib_` prefix.
 *
 * Animation layout:
 *   - sprite_6  (2 frames)  — small loop element, stops at frame 1.
 *                             DefineSprite_6/frame_1: stop().
 *   - sprite_16 (24 frames) — animated element, stops at frame 22.
 *                             DefineSprite_16/frame_22: stop().
 *   - sprite_24 (24 frames) — secondary animated element.
 *                             frame_1: random scatter position.
 *                             frame_22: random rotation.
 *   - sprite_25 (123 frames)— outer composite timeline, positions itself
 *                             at cellTo on frame_1. Holds 5 sub-instances
 *                             of sprite_24 (depths 119,121,123,125,127)
 *                             placed on the PlaceObject2 tags — each
 *                             gotoAndPlay a random start frame on load.
 *                             Also holds a sprite_6 child (DefineSprite_6,
 *                             referred to as DefineSprite_14 in clip events)
 *                             that rotates -11.67 deg/frame.
 *                             frame_4:  SOMA.playSound("licrounch_1013").
 *                             frame_82: this.end() → signalHit.
 *                             frame_121: _parent.removeMovieClip() → complete.
 *
 * The five PlaceObject2_24_N entries at depths 119,121,123,125,127 are all
 * instances of DefineSprite_24 (sprite_24) with different random-seed ranges:
 *   depth 119: gotoAndPlay(random(14) + 1)
 *   depth 121: gotoAndPlay(random(7) + 1)
 *   depth 123: gotoAndPlay(random(7) + 1)
 *   depth 125: gotoAndPlay(random(7) + 1)
 *   depth 127: gotoAndPlay(random(21) + 1)
 *
 * The rotating child at DefineSprite_14/frame_1 is an instance of
 * DefineSprite_6 (the 2-frame looping sprite) with an enterFrame that
 * continuously subtracts 11.67 degrees per frame.
 *
 * Main timeline (frame_2/DoAction.as): stop().
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

const SPRITE_6_BOUNDS = {
  width: 46.05,
  height: 45.9,
  offsetX: -25.35,
  offsetY: -7.4,
};

const SPRITE_16_BOUNDS = {
  width: 19.9,
  height: 34.55,
  offsetX: -9.6,
  offsetY: -25.05,
};

const SPRITE_24_BOUNDS = {
  width: 52.9,
  height: 51.75,
  offsetX: -30.55,
  offsetY: -23.4,
};

const SPRITE_25_BOUNDS = {
  width: 139.8,
  height: 124.65,
  offsetX: -66.1,
  offsetY: -212.75,
};

export class Spell1013 extends RuntimeSpell {
  readonly spellId = 1013;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite24Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite6Anchor = calculateAnchor(SPRITE_6_BOUNDS);
    const sprite16Anchor = calculateAnchor(SPRITE_16_BOUNDS);
    const sprite24Anchor = calculateAnchor(SPRITE_24_BOUNDS);
    const sprite25Anchor = calculateAnchor(SPRITE_25_BOUNDS);

    // ---- sprite_6 — small rotating loop element ------------------
    // DefineSprite_6/frame_1/DoAction.as: stop()
    // DefineSprite_14/frame_1/PlaceObject2_13_2/CLIPACTIONRECORD onClipEvent(enterFrame):
    //   _rotation = _rotation - 11.67
    // sprite_6 is used as an instance inside sprite_25 with the
    // continuous rotation enterFrame handler (DefineSprite_14 wraps it).
    const sprite6Sym: SymbolDefinition = {
      name: "sprite_6",
      totalFrames: 2,
      frames: textures.getFrames("sprite_6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_6/frame_1/DoAction.as — stop()
            clip.stop();
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS: DefineSprite_14/frame_1/PlaceObject2_13_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation - 11.67  (degrees → radians delta)
        clip.rotation -= (11.67 * Math.PI) / 180;
      },
    };

    // ---- sprite_16 — animated element, stops at frame 22 ---------
    // DefineSprite_16/frame_22/DoAction.as: stop()
    const sprite16Sym: SymbolDefinition = {
      name: "sprite_16",
      totalFrames: 24,
      frames: textures.getFrames("sprite_16"),
      anchorX: sprite16Anchor.x,
      anchorY: sprite16Anchor.y,
      frameScripts: new Map([
        [
          21,
          (clip) => {
            // AS: DefineSprite_16/frame_22/DoAction.as — stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_24 — secondary animated element ------------------
    // DefineSprite_24/frame_1/DoAction.as:
    //   _X = 100 * (Math.random() - 0.5)
    //   _Y = -100 + 100 * (Math.random() - 0.5)
    // DefineSprite_24/frame_22/DoAction.as:
    //   _rotation = random(360)
    this.sprite24Sym = {
      name: "sprite_24",
      totalFrames: 24,
      frames: textures.getFrames("sprite_24"),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_24/frame_1/DoAction.as
            clip.x = 100 * (Math.random() - 0.5);
            clip.y = -100 + 100 * (Math.random() - 0.5);
          },
        ],
        [
          21,
          (clip) => {
            // AS: DefineSprite_24/frame_22/DoAction.as
            // _rotation = random(360)  (degrees → radians)
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
      ]),
    };

    // ---- sprite_25 — outer 123-frame composite timeline ----------
    // DefineSprite_25/frame_1/DoAction.as:
    //   _X = _parent.cellTo.x
    //   _Y = _parent.cellTo.y
    //
    // PlaceObject2 children in frame_1 (depths 119,121,123,125,127) are
    // all instances of sprite_24. Each has an onClipEvent(load) that
    // calls gotoAndPlay with a random offset:
    //   depth 119: gotoAndPlay(random(14) + 1)
    //   depth 121: gotoAndPlay(random(7) + 1)
    //   depth 123: gotoAndPlay(random(7) + 1)
    //   depth 125: gotoAndPlay(random(7) + 1)
    //   depth 127: gotoAndPlay(random(21) + 1)
    //
    // There is also a sprite_6 instance with the rotating enterFrame
    // (DefineSprite_14). It is placed in the timeline but has no explicit
    // attachMovie script — we attach it in frame_1 at depth 1.
    //
    // DefineSprite_25/frame_4/DoAction.as: SOMA.playSound("licrounch_1013")
    // DefineSprite_25/frame_82/DoAction.as: this.end() → signalHit
    // DefineSprite_25/frame_121/DoAction.as: _parent.removeMovieClip()
    const sprite6SymRef = sprite6Sym;
    const sprite16SymRef = sprite16Sym;
    const sprite24SymRef = this.sprite24Sym;

    const sprite25Sym: SymbolDefinition = {
      name: "sprite_25",
      totalFrames: 123,
      frames: textures.getFrames("sprite_25"),
      anchorX: sprite25Anchor.x,
      anchorY: sprite25Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_25/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y
            // For displayType=11 (TargetCell) the container is already
            // anchored at cellTo, so this positions the clip at the
            // target in world coords. Since the harness places the
            // container at cellTo, and this sprite IS the root content,
            // we position relative to the container local origin = 0,0
            // which corresponds to the target cell. Keep the world-coord
            // assignment faithful to AS.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }

            // Attach sprite_6 instance (the rotating one, DefineSprite_14)
            // at depth 1. It has its own onEnterFrame for rotation.
            clip.attach(sprite6SymRef, "sprite6_rot", 1, ctx);

            // Attach sprite_16 at depth 2.
            clip.attach(sprite16SymRef, "sprite16", 2, ctx);

            // Attach 5 instances of sprite_24 at depths 119,121,123,125,127.
            // Each has an onClipEvent(load) that gotoAndPlay's a random frame.
            //
            // AS: DefineSprite_25/frame_1/PlaceObject2_24_119/CLIPACTIONRECORD onClipEvent(load).as
            //   gotoAndPlay(random(14) + 1)
            const child119 = clip.attach(sprite24SymRef, "sprite24_119", 119, ctx);
            child119.gotoAndPlay(Math.floor(Math.random() * 14));

            // AS: DefineSprite_25/frame_1/PlaceObject2_24_121/CLIPACTIONRECORD onClipEvent(load).as
            //   gotoAndPlay(random(7) + 1)
            const child121 = clip.attach(sprite24SymRef, "sprite24_121", 121, ctx);
            child121.gotoAndPlay(Math.floor(Math.random() * 7));

            // AS: DefineSprite_25/frame_1/PlaceObject2_24_123/CLIPACTIONRECORD onClipEvent(load).as
            //   gotoAndPlay(random(7) + 1)
            const child123 = clip.attach(sprite24SymRef, "sprite24_123", 123, ctx);
            child123.gotoAndPlay(Math.floor(Math.random() * 7));

            // AS: DefineSprite_25/frame_1/PlaceObject2_24_125/CLIPACTIONRECORD onClipEvent(load).as
            //   gotoAndPlay(random(7) + 1)
            const child125 = clip.attach(sprite24SymRef, "sprite24_125", 125, ctx);
            child125.gotoAndPlay(Math.floor(Math.random() * 7));

            // AS: DefineSprite_25/frame_1/PlaceObject2_24_127/CLIPACTIONRECORD onClipEvent(load).as
            //   gotoAndPlay(random(21) + 1)
            const child127 = clip.attach(sprite24SymRef, "sprite24_127", 127, ctx);
            child127.gotoAndPlay(Math.floor(Math.random() * 21));
          },
        ],
        [
          3,
          (_clip) => {
            // AS: DefineSprite_25/frame_4/DoAction.as — SOMA.playSound("licrounch_1013")
            // Sound is played via the callback captured in onSpellStart.
            // The sound frame fires on frame_4 (index 3) of sprite_25.
            // We use the stored callback reference.
            this.playSoundCallback?.("licrounch_1013");
          },
        ],
        [
          81,
          (_clip) => {
            // AS: DefineSprite_25/frame_82/DoAction.as — this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          120,
          (clip) => {
            // AS: DefineSprite_25/frame_121/DoAction.as — _parent.removeMovieClip()
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite6Sym);
    this.registry.register(sprite16Sym);
    this.registry.register(this.sprite24Sym);
    this.registry.register(sprite25Sym);
  }

  private playSoundCallback?: (id: string) => void;
  private sprite25Sym?: SymbolDefinition;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Store the sound callback so frame_4 of sprite_25 can call it.
    this.playSoundCallback = callbacks.playSound;

    // Main timeline: frame_2/DoAction.as — stop()
    // The main timeline stops at frame 2 — it just places sprite_25
    // as its authored child. We attach sprite_25 to the root here.
    const sprite25Sym = this.registry.resolve("sprite_25");
    if (sprite25Sym) {
      this.root.attach(sprite25Sym, "sprite25", 1, context);
    }
  }
}
