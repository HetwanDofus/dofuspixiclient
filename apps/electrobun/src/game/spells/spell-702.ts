/**
 * Spell 702 — Grinande (Ecaflip grinding aura).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/702/scripts/scripts/
 *
 * displayType=11 (TargetCell). No move/shoot/duplicate symbols, no
 * caster-relative projectile logic. All content plays at the target cell.
 *
 * Authored timeline layout (all placed on main timeline frame_1):
 *
 *   sprite_5  (6-frame) — static splash decoration.
 *             frame_1: gotoAndStop(random(8)+1) → random hold frame.
 *
 *   sprite_6  (57-frame composite) — impact burst / ring, plays through.
 *
 *   sprite_8  (123-frame composite) — looping spin.
 *             frame_1:   gotoAndPlay(random(100)+2) — random staggered start.
 *             frame_121: gotoAndPlay(2) — loops back past frame_1.
 *
 *   sprite_9  (120-frame composite, stopFrame=117) — charge-up / aftermath.
 *             frame_118: stop().
 *             frame_1 is the canonical impact moment → signalHit fired here.
 *
 *   sprite_11 (186-frame composite) — long aftermath overlay.
 *             frame_157: attaches lib_sprite11 (depth 69, scale=0.7) which
 *                        carries the onClipEvent(enterFrame) alpha-decay handler.
 *             frame_184: _parent._parent.removeMovieClip() → spell complete.
 *
 * Library symbols (manifest.librarySymbols):
 *   - sprite11 (characterId 11, directlyDynamic: true, 186 frames)
 *     Textures: lib_sprite11.
 *     onEnterFrame: `_parent._alpha -= 3.33` — fades the sprite_11 host clip.
 *     Attached from sprite_11's frameScripts at frame 156 (AS frame_157),
 *     depth 69, with placement matrix (scaleX=0.7, scaleY=0.7, y=-0.05).
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("grina_702").
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

const SPRITE5_BOUNDS = {
  width: 159.45,
  height: 44.95,
  offsetX: -104.3,
  offsetY: 0.55,
};

const SPRITE6_BOUNDS = {
  width: 140.8,
  height: 188.7,
  offsetX: -55.5,
  offsetY: -65.2,
};

const SPRITE8_BOUNDS = {
  width: 122.95,
  height: 68.75,
  offsetX: -53.75,
  offsetY: -36.6,
};

const SPRITE9_BOUNDS = {
  width: 290.5,
  height: 162.4,
  offsetX: -129.85,
  offsetY: 19.6,
};

const SPRITE11_BOUNDS = {
  width: 195.75,
  height: 109.4,
  offsetX: -88.1,
  offsetY: -59.7,
};

const LIB_SPRITE11_BOUNDS = {
  width: 195.75,
  height: 109.4,
  offsetX: -88.1,
  offsetY: -59.7,
};

export class Spell702 extends RuntimeSpell {
  readonly spellId = 702;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite5Sym!: SymbolDefinition;
  private sprite6Sym!: SymbolDefinition;
  private sprite8Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite5Anchor = calculateAnchor(SPRITE5_BOUNDS);
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);
    const sprite8Anchor = calculateAnchor(SPRITE8_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const sprite11Anchor = calculateAnchor(SPRITE11_BOUNDS);
    const libSprite11Anchor = calculateAnchor(LIB_SPRITE11_BOUNDS);

    // ---- lib_sprite11 — alpha-decay particle (directlyDynamic: true) ----
    // Placed inside sprite_11 at frame 157 (depth 69) with scale 0.7.
    // AS: DefineSprite_11/frame_157/PlaceObject2_10_69/
    //       CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _parent._alpha -= 3.33;
    const libSprite11Sym: SymbolDefinition = {
      name: "sprite11",
      totalFrames: 186,
      frames: textures.getFrames("lib_sprite11"),
      anchorX: libSprite11Anchor.x,
      anchorY: libSprite11Anchor.y,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_11/frame_157/PlaceObject2_10_69/
        //       CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _parent._alpha -= 3.33  (AS 0-100 scale → subtract 3.33/100 in TS)
        const parent = clip.parent;
        if (parent) {
          parent.alpha = Math.max(0, parent.alpha - 3.33 / 100);
        }
      },
    };

    // ---- sprite_5 — 6-frame static splash decoration ----------------
    // AS: DefineSprite_5/frame_1/DoAction.as
    //   gotoAndStop(random(8) + 1);
    this.sprite5Sym = {
      name: "sprite_5",
      totalFrames: 6,
      frames: textures.getFrames("sprite_5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_5/frame_1/DoAction.as — gotoAndStop(random(8)+1)
            const target = Math.floor(Math.random() * 8) + 1;
            clip.gotoAndStop(target - 1);
          },
        ],
      ]),
    };

    // ---- sprite_6 — 57-frame impact burst, plays through once -------
    // No frame scripts in canonical AS for this sprite. Plays through.
    this.sprite6Sym = {
      name: "sprite_6",
      totalFrames: 57,
      frames: textures.getFrames("sprite_6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
    };

    // ---- sprite_8 — 123-frame looping spin --------------------------
    // AS: DefineSprite_8/frame_1/DoAction.as  — gotoAndPlay(random(100)+2)
    // AS: DefineSprite_8/frame_121/DoAction.as — gotoAndPlay(2)
    this.sprite8Sym = {
      name: "sprite_8",
      totalFrames: 123,
      frames: textures.getFrames("sprite_8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_8/frame_1/DoAction.as — gotoAndPlay(random(100)+2)
            const target = Math.floor(Math.random() * 100) + 2;
            clip.gotoAndPlay(target - 1);
          },
        ],
        [
          120,
          (clip) => {
            // AS: DefineSprite_8/frame_121/DoAction.as — gotoAndPlay(2)
            clip.gotoAndPlay(1);
          },
        ],
      ]),
    };

    // ---- sprite_9 — 120-frame charge-up / aftermath -----------------
    // AS: DefineSprite_9/frame_118/DoAction.as — stop();
    // Frame 0 fires signalHit — sprite_9 is the canonical impact visual.
    this.sprite9Sym = {
      name: "sprite_9",
      totalFrames: 120,
      frames: textures.getFrames("sprite_9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // sprite_9 frame_1 is the canonical impact moment for this spell.
            this.runtime.signalHit();
          },
        ],
        [
          117,
          (clip) => {
            // AS: DefineSprite_9/frame_118/DoAction.as — stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_11 — 186-frame aftermath overlay --------------------
    // AS: DefineSprite_11/frame_157 — PlaceObject2 attaches lib_sprite11
    //     (characterId 11) at depth 69 with scale 0.7, y=-0.05.
    // AS: DefineSprite_11/frame_184/DoAction.as
    //     _parent._parent.removeMovieClip() → spell complete.
    this.sprite11Sym = {
      name: "sprite_11",
      totalFrames: 186,
      frames: textures.getFrames("sprite_11"),
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,
      frameScripts: new Map([
        [
          156,
          (clip, ctx) => {
            // AS: DefineSprite_11/frame_157 — PlaceObject2_10_69 places
            // sprite11 (characterId 11) at depth 69.
            // Placement matrix from manifest: scaleX=0.6999969482421875,
            // scaleY=0.6999969482421875, translateX=0, translateY=-0.05.
            const child = clip.attach(libSprite11Sym, "sprite11_69", 69, ctx);
            child.scaleX = 0.6999969482421875;
            child.scaleY = 0.6999969482421875;
            child.x = 0;
            child.y = -0.05;
          },
        ],
        [
          183,
          (clip) => {
            // AS: DefineSprite_11/frame_184/DoAction.as
            // _parent._parent.removeMovieClip()
            // clip is sprite_11; clip.parent is root (the outer mc).
            // We remove sprite_11 and signal completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(libSprite11Sym);
    this.registry.register(this.sprite5Sym);
    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite8Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite11Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as — SOMA.playSound("grina_702");
    callbacks.playSound("grina_702");

    // Attach all main-timeline sprites. These are implicit PlaceObject2
    // placements on the main SWF timeline at frame_1; we attach them
    // here in onSpellStart so they start ticking from the first runtime frame.
    this.root.attach(this.sprite5Sym, "sprite_5", 1, context);
    this.root.attach(this.sprite6Sym, "sprite_6", 2, context);
    this.root.attach(this.sprite8Sym, "sprite_8", 3, context);
    this.root.attach(this.sprite9Sym, "sprite_9", 4, context);
    this.root.attach(this.sprite11Sym, "sprite_11", 5, context);
  }
}
