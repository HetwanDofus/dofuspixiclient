/**
 * Spell 101 — Attaque Naturelle (Iop / generic melee, "arty_101").
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/101/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile motion symbols
 * (`move`/`shoot`/`duplicate`), no `librarySymbols[]` in the manifest, and
 * no references to `_parent.cellFrom`/`cellTo` in the authored scripts.
 * All content is a single `anim1` animation anchored at the target cell.
 * The `anim1` symbol itself is a 189-frame composite that is the sole
 * visual; it plays through and the outer clip removes itself on frame 187.
 *
 * There are several inline child clip-event scripts embedded inside
 * DefineSprite_14 (the anim1 container — 189 authored frames):
 *
 *   DefineSprite_9   — static scale particle. onLoad seeds random scale.
 *   DefineSprite_10  — pulsing particle. onLoad seeds rotation/alpha/phase i.
 *                      onEnterFrame pulses _xscale via sin(i += 0.1).
 *   DefineSprite_3   — gravity bounce particle. onLoad seeds v=0. onEnterFrame
 *                      integrates gravity (v += 0.6), bounces at _Y > 0.
 *   DefineSprite_13  — rising spiral ring. onLoad seeds spiral params + sets
 *                      _parent._alpha = 10. onEnterFrame drives spiral motion
 *                      and fades parent in/out, removing when alpha drops < 0.
 *   DefineSprite_12  — flicker particle. onEnterFrame randomises alpha every
 *                      frame.
 *
 * frame_85  of DefineSprite_14: `this.end()` → signalHit.
 * frame_187 of DefineSprite_14: `_parent.removeMovieClip()` → complete.
 *
 * All of these are authored INTO the anim1 SWF timeline (the child sprites
 * are placed by the SWF's PlaceObject2 tags, not by runtime attachMovie
 * calls from AS). The manifest has no `librarySymbols[]` and no
 * `attachMovie` calls in the scripts — the composition tree is baked.
 *
 * We therefore model `anim1` as a single SymbolDefinition whose frame
 * textures drive the visual and whose frameScripts fire the two game
 * signals at the canonical frames. The child clip-event behaviours (scale
 * pulse, gravity bounce, spiral ring, etc.) are fully baked into the
 * pre-rendered SVG frames by the exporter; we do not need to re-implement
 * them at runtime — they are visual-only and have no game-logic side effects.
 *
 * Library symbols: none (manifest `librarySymbols` is absent/empty).
 * Main timeline: SOMA.playSound("arty_101").
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
  width: 46.35,
  height: 30.45,
  offsetX: -22.6,
  offsetY: -15.1,
};

export class Spell101 extends RuntimeSpell {
  readonly spellId = 101;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 — 189-frame impact composite anchored at target cell.
    // Canonical source: DefineSprite_14 (the outer anim1 container).
    //   frame_85/DoAction.as  : this.end()              → signalHit
    //   frame_187/DoAction.as : _parent.removeMovieClip() → complete
    //
    // Child clip-event behaviours (DefineSprite_9, _10, _3, _13, _12)
    // are baked into the exported SVG frames; no runtime re-implementation
    // is needed for them.
    // anim1 has 189 logical frames in the SWF, but frames 160-188 all
    // dedupe to anim1_159 in the atlas (svg-spritesheet content-hash
    // dedup). vello's strip layout doesn't expose a logical→cell
    // mapping, so logical frames past the last unique cell sample the
    // wrong strip cell and the runtime appears to "restart" at frame 0
    // / frame 1.
    //
    // Terminate at the last frame with a unique atlas cell (159) so the
    // spell ends before the dedup'd tail. The visual is identical to the
    // canonical AS frame_187 endpoint because frames 160-188 are
    // visually identical to 159 anyway (that's why they got deduped).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 160,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          84,
          (_clip) => {
            // AS: DefineSprite_14/frame_85/DoAction.as — this.end()
            // Signals the hit (damage popup) at the canonical impact frame.
            this.runtime.signalHit();
          },
        ],
        [
          159,
          (clip) => {
            // Last unique atlas cell — terminate before the dedup'd tail
            // (logical frames 160-188 in canonical AS). Same visual as
            // the canonical _parent.removeMovieClip() at AS frame_187.
            clip.remove();
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
    // AS: scripts/frame_1/DoAction.as — SOMA.playSound("arty_101");
    callbacks.playSound("arty_101");

    // The main timeline implicitly places the anim1 composite on frame 1.
    // Attach it so it starts ticking from the next runtime frame.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
