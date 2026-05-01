/**
 * Spell 613 — Dodge (Ecaflip / dodge animation).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/613/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile, no caster reference,
 * no dual-anchor — it is a single impact animation at the target cell. The main
 * timeline is a 126-frame composite (anim1). Two library symbols are defined:
 *
 *   - sprite6 (characterId=6, directlyDynamic=true, 42 frames):
 *       Placed inside sprite7 at depth 1, frame 0, with scale ~0.671.
 *       Owns a CLIPACTIONRECORD onClipEvent(enterFrame) that randomises
 *       gotoAndStop(random(6)+1) and _alpha every tick — making it flicker
 *       between frames 1-6 with random opacity.
 *       frame_40/DoAction.as: gotoAndPlay(4) — loops from frame 4 after
 *       reaching frame 40 (0-based: frame 39 → gotoAndPlay(3)).
 *
 *   - sprite7 (characterId=7, directlyDynamic=false, 1 frame):
 *       Wrapper sprite. Has no clip events of its own.
 *       Placed (kind:"place") inside sprite8 at depth 1 and depth 3, frame 0.
 *       Also "moved" (tweened) across many subsequent frames as sprite8 plays.
 *       Since sprite7 is a static 1-frame container that internally holds
 *       sprite6 (placed via PlaceObject2 in the SWF), we model it as a
 *       wrapper that attaches a live sprite6 child.
 *
 * The outer sprite8 (the main-timeline animated container) drives:
 *   frame_4  (0-based: 3): SOMA.playSound("dodge_613a")
 *   frame_67 (0-based: 66): SOMA.playSound("dodge_613b")  — signalHit here
 *   frame_79 (0-based: 78): _parent.removeMovieClip() → complete()
 *
 * Sounds noted in manifest at frames 3 and 66 (0-based) match the above.
 *
 * The anim1 animation in animations[] is the pre-rendered composite of the
 * whole outer timeline (126 frames). We use it as the root clip's visual.
 * The sprite7/sprite6 library symbols must ALSO be instantiated at runtime
 * so that sprite6's onEnterFrame flickering runs live — the pre-rendered
 * SVGs only capture static PlaceObject2 state.
 *
 * Library symbols:
 *   - sprite6 — flickering glow overlay (42 frames). onEnterFrame randomly
 *     jumps to a frame in [1,6] and sets alpha to a random [0,100] value.
 *     frame_40 loops back to frame 4.
 *   - sprite7 — static wrapper (1 frame). Attaches sprite6 at depth 1 with
 *     the canonical scale/translate from placements[].
 *
 * Main timeline (DefineSprite_8 equivalent):
 *   Modelled as the anim1 root clip with frameScripts for sounds and completion.
 *   sprite7 is attached from onSpellStart (placed at depth 1 of root, frame 0
 *   of the outer sprite8 timeline).
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

const SPRITE6_BOUNDS = {
  width: 366.9,
  height: 164.1,
  offsetX: -186.25,
  offsetY: -49.2,
};

const SPRITE7_BOUNDS = {
  width: 246.3,
  height: 110.2,
  offsetX: -125.25,
  offsetY: -32.95,
};

const ANIM1_BOUNDS = {
  width: 246.35,
  height: 617.55,
  offsetX: -124.85,
  offsetY: -534.4,
};

export class Spell613 extends RuntimeSpell {
  readonly spellId = 613;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite6Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite6 — flickering glow overlay (directlyDynamic=true) ----
    // Canonical:
    //   scripts/DefineSprite_6/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //     gotoAndStop(random(6) + 1);
    //     _alpha = random(100);
    //   scripts/DefineSprite_6/frame_40/DoAction.as
    //     gotoAndPlay(4);
    this.sprite6Sym = {
      name: "sprite6",
      totalFrames: 42,
      frames: textures.getFrames("lib_sprite6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,

      // AS: onClipEvent(enterFrame) — randomly pick a frame in [1,6] and
      // set alpha to a random value in [0,100].
      onEnterFrame: (clip) => {
        // AS: gotoAndStop(random(6) + 1)  → 0-based: random(6) + 0
        clip.gotoAndStop(Math.floor(Math.random() * 6));
        // AS: _alpha = random(100)  → 0-based TS alpha = value / 100
        clip.alpha = Math.floor(Math.random() * 100) / 100;
      },

      frameScripts: new Map([
        [
          // AS: DefineSprite_6/frame_40/DoAction.as → gotoAndPlay(4)
          // 0-based: frame 39, gotoAndPlay(4) → gotoAndPlay(3)
          39,
          (clip) => {
            clip.gotoAndPlay(3);
          },
        ],
      ]),
    };

    // ---- sprite7 — static wrapper (directlyDynamic=false, 1 frame) ----
    // Canonical: no clip events of its own. Its job is to hold sprite6.
    // From manifest librarySymbols[sprite6].placements[0]:
    //   parentSpriteId=7, frame=0, depth=1
    //   matrix: scaleX=0.6713, scaleY=0.6713, translateX=-0.2, translateY=0.1
    //   colorTransform: null
    // sprite7 attaches sprite6 on its frame_1 (0-based frame 0).
    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: PlaceObject2 places sprite6 inside sprite7 at depth 1, frame 0
            // matrix: scaleX=0.6713104248046875, scaleY=0.6713104248046875,
            //         translateX=-0.2, translateY=0.1
            const child = clip.attach(this.sprite6Sym, "sprite6_inner", 1, ctx, {
              x: -0.2,
              y: 0.1,
            });
            child.scaleX = 0.6713104248046875;
            child.scaleY = 0.6713104248046875;
          },
        ],
      ]),
    };

    // ---- anim1 — 126-frame composite main-timeline visual ----
    // The outer DefineSprite_8 timeline. We model it as the root clip's
    // visual carrier. frameScripts drive the sounds and completion signal.
    //
    // From manifest librarySymbols[sprite7].placements:
    //   parentSpriteId=8, frame=0, depth=1 (kind:"place")  → attach sprite7
    //   parentSpriteId=8, frame=0, depth=3 (kind:"place")  → attach sprite7 again (second instance)
    //   parentSpriteId=8, frames 1-75, depth=1 (kind:"move") → tween updates
    //     (these are baked into the anim1 SVG frames for the composite visual,
    //      but the live sprite6 flicker needs the runtime clip to exist)
    //
    // We attach sprite7 at depths 1 and 3 in frame_1 (0-based: frame 0) of anim1.
    // The tween matrices from the placements are baked into anim1's SVG frames;
    // for the live sprite6 child we keep the initial placement and let it flicker.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 126,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_8: at frame 1 (0-based 0), PlaceObject2 places
            // sprite7 at depth 1 (translateX=0.4, translateY=-63.2, alphaMult=128)
            // and depth 3 (translateX=0.4, translateY=-115.2, alphaMult=128).
            const s7a = clip.attach(this.sprite7Sym, "sprite7_d1", 1, ctx, {
              x: 0.4,
              y: -63.2,
            });
            s7a.scaleX = 0.3768157958984375;
            s7a.scaleY = 1.89471435546875;
            s7a.alpha = 128 / 256;

            const s7b = clip.attach(this.sprite7Sym, "sprite7_d3", 3, ctx, {
              x: 0.4,
              y: -115.2,
            });
            s7b.scaleX = 0.3768157958984375;
            s7b.scaleY = 1.89471435546875;
            s7b.alpha = 128 / 256;
          },
        ],
        [
          // AS DefineSprite_8/frame_4/DoAction.as → SOMA.playSound("dodge_613a")
          // 0-based: frame 3
          3,
          () => {
            this.soundCallback?.("dodge_613a");
          },
        ],
        [
          // AS DefineSprite_8/frame_67/DoAction.as → SOMA.playSound("dodge_613b")
          // 0-based: frame 66 — also the canonical hit frame
          66,
          () => {
            this.soundCallback?.("dodge_613b");
            this.runtime.signalHit();
          },
        ],
        [
          // AS DefineSprite_8/frame_79/DoAction.as → _parent.removeMovieClip()
          // 0-based: frame 78
          78,
          (clip) => {
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use in frameScripts
    this.soundCallback = callbacks.playSound;

    // Attach anim1 as the root-level visual, depth 1.
    // This is the main-timeline composite that carries the full 126-frame animation
    // and hosts the live sprite7/sprite6 flicker children.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
