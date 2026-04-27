/**
 * Spell 613 — Dodge/Esquive (Ecaflip or similar, single-target impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/613/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move`, `shoot`, `duplicate`,
 * or `librarySymbols[]` — just a single `anim1` animation in the manifest
 * with 126 frames, driven by an outer DefineSprite_8 timeline. The outer
 * sprite (DefineSprite_8) carries:
 *   - frame_4:  SOMA.playSound("dodge_613a")
 *   - frame_67: SOMA.playSound("dodge_613b")
 *   - frame_79: _parent.removeMovieClip() → spell complete
 *
 * DefineSprite_6 is an inner symbol placed on the anim1 timeline; its
 * instance (PlaceObject2_2_1) has an onClipEvent(enterFrame) that each
 * frame picks a random sub-frame (1-6) and random alpha — a shimmer/flicker
 * effect. Its frame_40 loops back to frame_4.
 *
 * Since librarySymbols[] is empty in the manifest, ALL texture lookups
 * use bare names (no "lib_" prefix). The two authored symbols map to:
 *   - anim1  → textures.getFrames("anim1")   [the outer DefineSprite_8]
 *   - sprite_6 (DefineSprite_6) → container-only shimmer child embedded
 *     in the anim1 composite; its flicker is authored as clip events on
 *     a placed instance. We model it as a separate registered symbol.
 *
 * Timing signals:
 *   - signalHit at frame_4 (first sound, canonical impact frame).
 *   - complete at frame_79 (_parent.removeMovieClip()).
 *
 * Note: The two SOMA.playSound calls in DefineSprite_8 are modelled as
 * frameScripts on the anim1 symbol. The inner DefineSprite_6 shimmer is
 * registered as "sprite_6" and attached by anim1's frame_1 script
 * (implicit PlaceObject2 placement on the authored timeline). Because the
 * manifest marks anim1 as `isComposite: true` with 126 frames we use the
 * full frame list; the inner shimmer is a sub-child of that composite.
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
  width: 246.35,
  height: 617.55,
  offsetX: -124.85,
  offsetY: -534.4,
};

export class Spell613 extends RuntimeSpell {
  readonly spellId = 613;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite_6 — inner shimmer/flicker child ------------------
    // AS DefineSprite_6/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame):
    //   gotoAndStop(random(6) + 1);
    //   _alpha = random(100);
    // AS DefineSprite_6/frame_40/DoAction.as:
    //   gotoAndPlay(4);
    // This symbol has no authored textures (it's a container with its
    // own clip-event-driven sub-frames); model it as container-only.
    const sprite6Sym: SymbolDefinition = {
      name: "sprite_6",
      totalFrames: 40,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS DefineSprite_6/frame_1/PlaceObject2_2_1/onClipEvent(enterFrame)
        clip.gotoAndStop(Math.floor(Math.random() * 6));
        clip.alpha = Math.floor(Math.random() * 100) / 100;
      },
      frameScripts: new Map([
        [
          39,
          (clip) => {
            // AS DefineSprite_6/frame_40/DoAction.as: gotoAndPlay(4)
            clip.gotoAndPlay(3);
          },
        ],
      ]),
    };

    // ---- anim1 — outer 126-frame composite (DefineSprite_8) ------
    // AS DefineSprite_8/frame_4/DoAction.as:   SOMA.playSound("dodge_613a")
    // AS DefineSprite_8/frame_67/DoAction.as:  SOMA.playSound("dodge_613b")
    // AS DefineSprite_8/frame_79/DoAction.as:  _parent.removeMovieClip()
    //
    // The manifest lists sounds at frames 3 (0-based) and 66 (0-based)
    // which match frame_4 and frame_67 (1-based) exactly.
    // signalHit fires at the first impact sound (frame 3 / frame_4).
    const anim1Frames = textures.getFrames("anim1");
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 126,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      onLoad: (clip, ctx) => {
        // Implicit PlaceObject2 of DefineSprite_6 instance on the
        // main timeline of DefineSprite_8. Attach the shimmer child
        // so it ticks alongside the outer animation.
        clip.attach(sprite6Sym, "shimmer", 1, ctx);
      },
      frameScripts: new Map([
        [
          3,
          (_clip) => {
            // AS DefineSprite_8/frame_4/DoAction.as: SOMA.playSound("dodge_613a")
            // Sound is played via onSpellStart for frame_4; here we
            // signal the hit (canonical impact frame).
            this.runtime.signalHit();
            this.soundCallback?.("dodge_613a");
          },
        ],
        [
          66,
          (_clip) => {
            // AS DefineSprite_8/frame_67/DoAction.as: SOMA.playSound("dodge_613b")
            this.soundCallback?.("dodge_613b");
          },
        ],
        [
          78,
          (clip) => {
            // AS DefineSprite_8/frame_79/DoAction.as: _parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite6Sym);
    this.registry.register(this.anim1Sym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture the sound callback so frameScripts can fire sounds.
    this.soundCallback = callbacks.playSound;

    // Attach anim1 at the root so the spell starts ticking.
    // The main timeline implicitly places DefineSprite_8 (anim1) at depth 1.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
