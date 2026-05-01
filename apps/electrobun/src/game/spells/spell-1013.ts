/**
 * Spell 1013 — Licorne (Ecaflip, "licrounch" sound).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1013/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The outermost sprite (DefineSprite_25) positions
 * itself at _parent.cellTo via frame_1/DoAction.as: `_X = _parent.cellTo.x; _Y = _parent.cellTo.y;`
 * This is the WorldAbsolute self-positioning pattern — the container sits at (0,0)
 * and sprite_25 reads world coords from root.vars.cellTo to place itself.
 *
 * Library symbols:
 *   - sprite14 (characterId=14, directlyDynamic=true) — rotating sparkle.
 *       onEnterFrame: _rotation -= 11.67 deg/tick.
 *       Placed inside sprite_25 at depths 36 and 39 on frame 0, with
 *       initial matrix transforms from placements[].
 *   - sprite_6 (2 frames) — simple sub-sprite. frame_1: stop().
 *   - sprite_16 (24 frames) — 24-frame animation, stops at frame 22.
 *   - sprite_24 (24 frames) — scatter sub-animation. frame_1: random X/Y.
 *       frame_22: random rotation. Five instances placed in sprite_25 frame_1
 *       at depths 119/121/123/125/127, each with a different random(N)+1
 *       start frame from onClipEvent(load).
 *   - sprite_25 (123 frames, composite) — main outer timeline.
 *       frame_1: position at cellTo; attach sprite14×2 + sprite_24×5.
 *       frame_4: SOMA.playSound("licrounch_1013").
 *       frame_82: this.end() → signalHit.
 *       frame_121: _parent.removeMovieClip() → complete().
 *
 * Main timeline: frame_2/DoAction.as → stop(). sprite_25 attached in onSpellStart.
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

// ---- Manifest bounds ----

const SPRITE14_BOUNDS = {
  width: 16.5,
  height: 16.5,
  offsetX: -8.25,
  offsetY: -8.25,
};

const SPRITE6_BOUNDS = {
  width: 46.05,
  height: 45.9,
  offsetX: -25.35,
  offsetY: -7.4,
};

const SPRITE16_BOUNDS = {
  width: 19.9,
  height: 34.55,
  offsetX: -9.6,
  offsetY: -25.05,
};

const SPRITE24_BOUNDS = {
  width: 52.9,
  height: 51.75,
  offsetX: -30.55,
  offsetY: -23.4,
};

const SPRITE25_BOUNDS = {
  width: 139.8,
  height: 124.65,
  offsetX: -66.1,
  offsetY: -212.75,
};

export class Spell1013 extends RuntimeSpell {
  readonly spellId = 1013;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  // Symbols held as fields so frameScripts closures can reference them
  // directly without going through the registry (avoids the "registered
  // but never attached" false-negative: the validator sees the variable
  // reference in attach() at definition time).
  private sprite14Sym!: SymbolDefinition;
  private sprite24v14Sym!: SymbolDefinition;
  private sprite24v7aSym!: SymbolDefinition;
  private sprite24v7bSym!: SymbolDefinition;
  private sprite24v7cSym!: SymbolDefinition;
  private sprite24v21Sym!: SymbolDefinition;
  private sprite25Sym!: SymbolDefinition;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite14Anchor = calculateAnchor(SPRITE14_BOUNDS);
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);
    const sprite16Anchor = calculateAnchor(SPRITE16_BOUNDS);
    const sprite24Anchor = calculateAnchor(SPRITE24_BOUNDS);
    const sprite25Anchor = calculateAnchor(SPRITE25_BOUNDS);

    // ---- sprite14 — rotating sparkle (directlyDynamic=true) ----
    // Placed inside DefineSprite_25 at depths 36 and 39 on frame 0.
    // AS: DefineSprite_14/frame_1/PlaceObject2_13_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation - 11.67;
    this.sprite14Sym = {
      name: "sprite14",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_14/frame_1/PlaceObject2_13_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation - 11.67;
        clip.rotation -= (11.67 * Math.PI) / 180;
      },
    };

    // ---- sprite_6 — 2-frame sub-sprite ----
    // AS: DefineSprite_6/frame_1/DoAction.as → stop();
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
            // AS: DefineSprite_6/frame_1/DoAction.as → stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_16 — 24-frame animation, stops at frame 22 ----
    // AS: DefineSprite_16/frame_22/DoAction.as → stop();
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
            // AS: DefineSprite_16/frame_22/DoAction.as → stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_24 variants — scatter sub-animation with per-instance random start ----
    // Base frame scripts shared by all variants:
    //   frame_1: AS DefineSprite_24/frame_1/DoAction.as
    //     _X = 100 * (Math.random() - 0.5);
    //     _Y = -100 + 100 * (Math.random() - 0.5);
    //   frame_22: AS DefineSprite_24/frame_22/DoAction.as
    //     _rotation = random(360);
    //
    // Five instances placed in DefineSprite_25/frame_1 at depths 119/121/123/125/127,
    // each with a different onClipEvent(load) random start range.

    // depth 119 — AS: PlaceObject2_24_119/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(14) + 1);
    this.sprite24v14Sym = {
      name: "sprite_24_v14",
      totalFrames: 24,
      frames: textures.getFrames("sprite_24"),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_25/frame_1/PlaceObject2_24_119/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndPlay(random(14) + 1);
        clip.gotoAndPlay(Math.floor(Math.random() * 14));
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_24/frame_1/DoAction.as
            // _X = 100 * (Math.random() - 0.5);
            // _Y = -100 + 100 * (Math.random() - 0.5);
            clip.x = 100 * (Math.random() - 0.5);
            clip.y = -100 + 100 * (Math.random() - 0.5);
          },
        ],
        [
          21,
          (clip) => {
            // AS: DefineSprite_24/frame_22/DoAction.as
            // _rotation = random(360);
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
      ]),
    };

    // depth 121 — AS: PlaceObject2_24_121/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(7) + 1);
    this.sprite24v7aSym = {
      name: "sprite_24_v7a",
      totalFrames: 24,
      frames: textures.getFrames("sprite_24"),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_25/frame_1/PlaceObject2_24_121/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndPlay(random(7) + 1);
        clip.gotoAndPlay(Math.floor(Math.random() * 7));
      },
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
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
      ]),
    };

    // depth 123 — AS: PlaceObject2_24_123/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(7) + 1);
    this.sprite24v7bSym = {
      name: "sprite_24_v7b",
      totalFrames: 24,
      frames: textures.getFrames("sprite_24"),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_25/frame_1/PlaceObject2_24_123/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndPlay(random(7) + 1);
        clip.gotoAndPlay(Math.floor(Math.random() * 7));
      },
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
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
      ]),
    };

    // depth 125 — AS: PlaceObject2_24_125/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(7) + 1);
    this.sprite24v7cSym = {
      name: "sprite_24_v7c",
      totalFrames: 24,
      frames: textures.getFrames("sprite_24"),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_25/frame_1/PlaceObject2_24_125/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndPlay(random(7) + 1);
        clip.gotoAndPlay(Math.floor(Math.random() * 7));
      },
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
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
      ]),
    };

    // depth 127 — AS: PlaceObject2_24_127/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(21) + 1);
    this.sprite24v21Sym = {
      name: "sprite_24_v21",
      totalFrames: 24,
      frames: textures.getFrames("sprite_24"),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_25/frame_1/PlaceObject2_24_127/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndPlay(random(21) + 1);
        clip.gotoAndPlay(Math.floor(Math.random() * 21));
      },
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
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
      ]),
    };

    // ---- sprite_25 — main 123-frame composite outer timeline ----
    // AS: DefineSprite_25/frame_1/DoAction.as:
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    // AS: DefineSprite_25/frame_4/DoAction.as:
    //   SOMA.playSound("licrounch_1013");
    // AS: DefineSprite_25/frame_82/DoAction.as:
    //   this.end(); → signalHit
    // AS: DefineSprite_25/frame_121/DoAction.as:
    //   _parent.removeMovieClip(); → complete
    this.sprite25Sym = {
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
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
            // displayType=50: container is at world (0,0), so we read cellTo from root.vars.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }

            // Attach sprite14 at depth 36 — placements[0]: translateX=11.4, translateY=-155.4
            // scaleX=0.8282928466796875, scaleY=0.841033935546875
            // rotateSkew0/1 are near-zero (~-0.008/0.008) — negligible rotation, skip.
            // AS: DefineSprite_25/frame_1 PlaceObject2 at depth 36 (characterId=14)
            const c36 = clip.attach(this.sprite14Sym, "sprite14_36", 36, ctx, {
              x: 11.4,
              y: -155.4,
            });
            c36.scaleX = 0.8282928466796875;
            c36.scaleY = 0.841033935546875;

            // Attach sprite14 at depth 39 — placements[1]: translateX=-5.2, translateY=-156.05
            // scaleX=-0.667938232421875, scaleY=-0.6783447265625 (negative = flipped)
            // AS: DefineSprite_25/frame_1 PlaceObject2 at depth 39 (characterId=14)
            const c39 = clip.attach(this.sprite14Sym, "sprite14_39", 39, ctx, {
              x: -5.2,
              y: -156.05,
            });
            c39.scaleX = -0.667938232421875;
            c39.scaleY = -0.6783447265625;

            // Attach sprite_24 instances at depths 119/121/123/125/127.
            // Each instance fires its onLoad to gotoAndPlay a random start frame,
            // then frame_1 sets a random X/Y scatter position.
            //
            // AS: DefineSprite_25/frame_1/PlaceObject2_24_119 → depth 119
            clip.attach(this.sprite24v14Sym, "sprite_24_119", 119, ctx);

            // AS: DefineSprite_25/frame_1/PlaceObject2_24_121 → depth 121
            clip.attach(this.sprite24v7aSym, "sprite_24_121", 121, ctx);

            // AS: DefineSprite_25/frame_1/PlaceObject2_24_123 → depth 123
            clip.attach(this.sprite24v7bSym, "sprite_24_123", 123, ctx);

            // AS: DefineSprite_25/frame_1/PlaceObject2_24_125 → depth 125
            clip.attach(this.sprite24v7cSym, "sprite_24_125", 125, ctx);

            // AS: DefineSprite_25/frame_1/PlaceObject2_24_127 → depth 127
            clip.attach(this.sprite24v21Sym, "sprite_24_127", 127, ctx);
          },
        ],
        [
          3,
          () => {
            // AS: DefineSprite_25/frame_4/DoAction.as → SOMA.playSound("licrounch_1013");
            this.soundCallback?.("licrounch_1013");
          },
        ],
        [
          81,
          () => {
            // AS: DefineSprite_25/frame_82/DoAction.as → this.end(); (signalHit)
            this.runtime.signalHit();
          },
        ],
        [
          120,
          (clip) => {
            // AS: DefineSprite_25/frame_121/DoAction.as → _parent.removeMovieClip();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // Register all symbols
    this.registry.register(this.sprite14Sym);
    this.registry.register(sprite6Sym);
    this.registry.register(sprite16Sym);
    this.registry.register(this.sprite24v14Sym);
    this.registry.register(this.sprite24v7aSym);
    this.registry.register(this.sprite24v7bSym);
    this.registry.register(this.sprite24v7cSym);
    this.registry.register(this.sprite24v21Sym);
    this.registry.register(this.sprite25Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Capture the sound callback so frame scripts inside sprite_25 can play sounds.
    this.soundCallback = callbacks.playSound;

    // Top-level main timeline: frame_2/DoAction.as → stop();
    // Attach sprite_25 to root — it will self-position at cellTo on its frame_1 script.
    this.root.attach(this.sprite25Sym, "sprite_25", 1, context);
  }
}
