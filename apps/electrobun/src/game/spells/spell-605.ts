/**
 * Spell 605 — Esquive (Dodge step).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/605/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell is a single authored timeline
 * (DefineSprite_29, 135 frames) placed at the target cell. It contains
 * no projectile, no caster reference, and no move/shoot symbols — it is
 * a pure impact animation. The main-timeline `anim1` drives the bulk of
 * the visual (the pre-rendered dodge step frames) while two live
 * `sprite21` clips are attached at runtime to provide the alpha-flickering
 * particle overlay.
 *
 * Canonical layout:
 *
 *   - `anim1` (DefineSprite_29, 135 frames) — the main animated timeline.
 *       frame_28 (index 27): SOMA.playSound("dodge_605") + SOMA.playSound("pas_homme_normal")
 *       frame_37 (index 36): PlaceObject2 at depth 17 → sprite21 instance with
 *                            onClipEvent(enterFrame) alpha flicker.
 *       frame_40 (index 39): SOMA.playSound("pas_homme_normal")
 *       frame_133 (index 132): _parent.removeMovieClip() → spell complete.
 *
 *   - `sprite21` (DefineSprite_21, 9 frames, characterId 21) — alpha-flickering
 *     particle overlay. directlyDynamic=true. Two instances are placed inside
 *     `anim1` at different depths and frames:
 *       - depth 8, first placed at anim1 frame 27 (AS frame_28)
 *       - depth 17 (PlaceObject2_17_1), placed at anim1 frame 36 (AS frame_37)
 *         with onClipEvent(enterFrame): _alpha = 20 + random(70)
 *     Both instances share the same AS handler in DefineSprite_21/frame_1/
 *     PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
 *       _alpha = 20 + random(70)
 *
 * The `anim1` symbol is the outer container (parentSpriteId=29). It is
 * attached at root by `onSpellStart`. The `sprite21` clips are attached
 * from within `anim1`'s frameScripts at the canonical placement frames.
 *
 * signalHit: fired at frame_28 (index 27) of anim1 when the dodge sound
 * plays (canonical hit timing for a dodge spell).
 * complete: fired at frame_133 (index 132) of anim1 (_parent.removeMovieClip).
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

const SPRITE21_BOUNDS = {
  width: 16.15,
  height: 12.55,
  offsetX: -7.95,
  offsetY: -6.4,
};

const ANIM1_BOUNDS = {
  width: 59.5,
  height: 60.85,
  offsetX: -31.25,
  offsetY: -108.2,
};

export class Spell605 extends RuntimeSpell {
  readonly spellId = 605;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite21Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite21Anchor = calculateAnchor(SPRITE21_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite21 — alpha-flickering particle overlay ------------
    // AS: DefineSprite_21/frame_1/PlaceObject2_19_1/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _alpha = 20 + random(70)
    this.sprite21Sym = {
      name: "sprite21",
      totalFrames: 9,
      frames: textures.getFrames("lib_sprite21"),
      anchorX: sprite21Anchor.x,
      anchorY: sprite21Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_21/frame_1/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _alpha = 20 + random(70)
        clip.alpha = (20 + Math.floor(Math.random() * 70)) / 100;
      },
    };

    // ---- anim1 — main 135-frame dodge timeline -------------------
    // AS: DefineSprite_29
    //   frame_28 (index 27): sounds + signalHit
    //   frame_37 (index 36): PlaceObject2 → sprite21 at depth 17 (alpha flicker)
    //   frame_40 (index 39): sound
    //   frame_133 (index 132): _parent.removeMovieClip()
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 135,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          27,
          (clip, ctx) => {
            // AS DefineSprite_29/frame_28/DoAction.as
            // SOMA.playSound("dodge_605"); SOMA.playSound("pas_homme_normal");
            // Sounds are played via the stored callback reference below.
            // signalHit fired here — canonical impact timing for dodge.
            this.runtime.signalHit();
            if (this.soundCallback) {
              this.soundCallback("dodge_605");
              this.soundCallback("pas_homme_normal");
            }
            // Also attach the depth-8 sprite21 instance that was placed
            // at AS frame_28 (PlaceObject2 at depth 8, frame 27 in manifest).
            // The placement matrix from manifest:
            //   translateX: -1.4, translateY: -84.4, scaleX/Y: 0 (size info only)
            clip.attach(this.sprite21Sym, "sprite21_d8", 8, ctx, {
              x: -1.4,
              y: -84.4,
            });
          },
        ],
        [
          36,
          (clip, ctx) => {
            // AS DefineSprite_29/frame_37/PlaceObject2_17_1/
            //   CLIPACTIONRECORD onClipEvent(enterFrame).as
            // Place sprite21 at depth 17 (the second flickering instance).
            // Placement matrix: translateX: -1.2, translateY: -77.7
            clip.attach(this.sprite21Sym, "sprite21_d17", 17, ctx, {
              x: -1.2,
              y: -77.7,
            });
          },
        ],
        [
          39,
          (_clip) => {
            // AS DefineSprite_29/frame_40/DoAction.as
            // SOMA.playSound("pas_homme_normal");
            if (this.soundCallback) {
              this.soundCallback("pas_homme_normal");
            }
          },
        ],
        [
          132,
          (clip) => {
            // AS DefineSprite_29/frame_133/DoAction.as
            // _parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite21Sym);
    this.registry.register(this.anim1Sym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use in frameScripts.
    this.soundCallback = callbacks.playSound;

    // Attach the main anim1 timeline at depth 1 on root.
    // The canonical SWF main timeline implicitly places DefineSprite_29
    // (anim1) at the start.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
