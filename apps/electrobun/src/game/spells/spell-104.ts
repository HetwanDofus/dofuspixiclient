/**
 * Spell 104 — Attaque Naturelle (Feca, level 2 variant / "Arty" impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/104/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no `move`/`shoot`/`duplicate`
 * symbols, no caster-reference logic, and no projectile motion. The
 * single authored animation plays out entirely at the target cell.
 * The manifest has one `animations[]` entry ("anim1", 132 frames) and
 * zero `librarySymbols[]` entries — all content is baked into the
 * anim1 composite timeline.
 *
 * AS layout:
 *   - DefineSprite_8 ("anim1" outer container, 132 frames):
 *       PlaceObject2_7_1 onClipEvent(enterFrame): rotates child sprite
 *         by +1 degree per frame (spinning wheel effect).
 *       frame_130/DoAction.as: `this.end()` (signalHit) +
 *         `_parent.removeMovieClip()` (spell complete).
 *
 *   - DefineSprite_7 (inner spinning child, placed inside DefineSprite_8):
 *       frame_61/DoAction.as: `_rotation = -20` — resets the
 *         accumulated rotation at frame 61 to a specific value.
 *
 *   - DefineSprite_5 (flash/flicker child, placed inside DefineSprite_8):
 *       PlaceObject2_4_1 onClipEvent(load): seeds xs = _parent._xscale*3, i.
 *       PlaceObject2_4_1 onClipEvent(enterFrame): sets alpha to
 *         30+random(120), resets scale to 100% each frame (flicker).
 *       frame_28/DoAction.as: stop().
 *
 *   Main timeline frame_1: SOMA.playSound("arty_104").
 *
 * Because librarySymbols[] is empty, NO `lib_` prefix is used anywhere.
 * All textures come from the bare "anim1" animations[] key.
 *
 * Symbol registration strategy:
 *   "anim1" is the top-level animated symbol (132 frames, composite).
 *   DefineSprite_7 and DefineSprite_5 are sub-children placed inside
 *   DefineSprite_8 by the authored timeline. Because the manifest
 *   exports a single flattened composite ("anim1"), the sub-sprite
 *   behaviours (rotation increment, flicker) are already baked into the
 *   rendered frames. We therefore model "anim1" as a single symbol with
 *   its frame scripts (hit signal at frame 130, complete at frame 130)
 *   and let the composite textures carry the visual content.
 *
 *   The onEnterFrame rotation (+1 deg/frame on DefineSprite_7) and the
 *   DefineSprite_5 flicker are purely visual and are baked into the
 *   exported SVG frames, so we do not need to re-implement them at
 *   runtime — doing so would double the effect.
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

const ANIM1_BOUNDS = {
  width: 188.95,
  height: 190.8,
  offsetX: -91.3,
  offsetY: -127.65,
};

export class Spell104 extends RuntimeSpell {
  readonly spellId = 104;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 132-frame composite impact animation at target --
    // Sourced from animations[0] ("anim1"). No librarySymbols[], so
    // no "lib_" prefix. The composite frames already bake in the
    // sub-sprite visuals (spinning inner wheel, alpha flicker).
    //
    // Frame scripts mirror:
    //   DefineSprite_8/frame_130/DoAction.as:
    //     this.end();              → this.runtime.signalHit()
    //     _parent.removeMovieClip(); → this.runtime.complete()
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 132,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          129,
          (_clip) => {
            // AS: DefineSprite_8/frame_130/DoAction.as
            //   this.end();
            //   _parent.removeMovieClip();
            this.runtime.signalHit();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as
    //   SOMA.playSound("arty_104");
    callbacks.playSound("arty_104");

    // Attach anim1 at the root so it starts playing immediately.
    // For displayType=11 the root container is already positioned at
    // the target cell by the harness/spell-view.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
