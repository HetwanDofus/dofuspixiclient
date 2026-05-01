/**
 * Spell 1201 — (Unknown name, likely an explosion/impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1201/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single authored sprite_39
 * timeline (117 frames) that plays at the target cell. There are no
 * `move`, `shoot`, `duplicate`, or `_parent.cellFrom`/`cellTo` references,
 * no projectile arc, and no caster-anchored content. This is a pure
 * impact animation at the target cell.
 *
 * The manifest has NO `librarySymbols[]` entries — all symbols appear only
 * in `animations[]`. Therefore NO `lib_` prefix is used anywhere.
 *
 * Symbol layout:
 *   - sprite_39 — 117-frame impact composite (main animation). Registered
 *     as a container-like symbol but with actual frame textures from
 *     `animations["sprite_39"]`. frame_1 sets rotation to `_parent.angle + 90`.
 *     frame_4 plays the "explosion" sound. frame_115 calls
 *     `_parent.removeMovieClip()` → complete(). The manifest also lists
 *     DefineSprite_21 and DefineSprite_20 scripts, but since there are no
 *     `librarySymbols[]` entries and no `attachMovie` calls referencing them
 *     in the available AS, and they are not present as separate animation
 *     assets, they appear to be sub-sprites baked into sprite_39's composite
 *     frames. The runtime drives sprite_39 as one symbol.
 *
 * Main timeline: frame_2/DoAction.as → stop(). The sprite_39 symbol is
 * placed on the main timeline by the SWF authoring (not via attachMovie),
 * so we attach it explicitly in onSpellStart.
 *
 * Signals:
 *   - signalHit: fired at frame_4 (explosion sound / impact frame).
 *   - complete: fired at frame_115 (canonical _parent.removeMovieClip()).
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

const SPRITE_39_BOUNDS = {
  width: 202,
  height: 233.3,
  offsetX: -98.75,
  offsetY: -157.75,
};

export class Spell1201 extends RuntimeSpell {
  readonly spellId = 1201;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite39Sym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite39Anchor = calculateAnchor(SPRITE_39_BOUNDS);

    // ---- sprite_39 — 117-frame impact composite ------------------
    // AS DefineSprite_39/frame_1/DoAction.as:
    //   _rotation = _parent.angle + 90;
    // AS DefineSprite_39/frame_4/DoAction.as:
    //   SOMA.playSound("explosion");
    // AS DefineSprite_39/frame_115/DoAction.as:
    //   _parent.removeMovieClip();
    //
    // NOTE: DefineSprite_21 (alpha-pulsing rising smoke particle) and
    // DefineSprite_20 (oscillating bob particle) are sub-sprites whose
    // canonical AS frame_1 scripts run as onEnterFrame handlers. Since
    // these sprites appear inside sprite_39 as composite SVG content and
    // no separate attachMovie call is visible in the available scripts,
    // their visual output is represented in the composite sprite_39 frames.
    // Their dynamic handlers (onEnterFrame alpha pulse, Y oscillation) are
    // baked into the sprite_39 per-frame SVG artwork as the export tool
    // rasterised each frame. The TS runtime drives the sprite_39 timeline
    // which includes those visual outputs frame-by-frame.
    this.sprite39Sym = {
      name: "sprite_39",
      totalFrames: 117,
      frames: textures.getFrames("sprite_39"),
      anchorX: sprite39Anchor.x,
      anchorY: sprite39Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_39/frame_1/DoAction.as:
            //   _rotation = _parent.angle + 90;
            // _parent here is the root (displayType=11, root at target).
            const angleDeg = (ctx.angle as number) ?? 0;
            clip.rotation = ((angleDeg + 90) * Math.PI) / 180;
          },
        ],
        [
          3,
          (_clip) => {
            // AS DefineSprite_39/frame_4/DoAction.as:
            //   SOMA.playSound("explosion");
            // Signal hit at the impact/explosion frame.
            this.soundCallback?.("explosion");
            this.runtime.signalHit();
          },
        ],
        [
          114,
          (clip) => {
            // AS DefineSprite_39/frame_115/DoAction.as:
            //   _parent.removeMovieClip();
            // Removes the outer mc — triggers spell completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite39Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback so frameScripts can play the explosion sound.
    this.soundCallback = callbacks.playSound;

    // Main timeline: sprite_39 is placed on frame_1 of the main timeline
    // (SWF authored placement). We attach it here so it starts ticking
    // from the first runtime frame. frame_2/DoAction.as → stop() on the
    // MAIN timeline (not sprite_39 itself), which in Flash terms stops the
    // outer 2-frame main clip from looping. The root in our runtime
    // doesn't loop, so no explicit stop() is needed on root.
    this.root.attach(this.sprite39Sym, "sprite_39", 1, context);
  }
}
