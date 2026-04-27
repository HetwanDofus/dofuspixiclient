/**
 * Spell 212 — (Iop/Warrior impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/212/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has a `shoot` symbol
 * (105-frame impact animation) driven by the ballistic harness, plus a
 * secondary `DefineSprite_8` (142-frame) that positions itself at cellTo
 * in its frame_1 script, plays an explosion sound at frame_58, signals hit
 * at frame_61, and removes its parent at frame_142. A clip event on a child
 * inside DefineSprite_8 fades the parent's alpha from frame_118 onward.
 *
 * Library symbols:
 *   - `shoot` (animations entry, 105 frames): impact burst. frame_1 resets
 *     rotation to 0 (canonical override of harness velocity angle). frame_73
 *     installs an onEnterFrame that fades alpha by 3/100 per tick. frame_103
 *     removes parent and signals completion.
 *   - `sprite_8` (DefineSprite_8, 142 frames): secondary target-anchored
 *     timeline. frame_1 positions self at cellTo. frame_58 plays "explosion"
 *     sound. frame_61 signals hit. frame_118 has a child clip whose
 *     enterFrame fades this clip's alpha by 5/100 per tick. frame_142
 *     removes parent.
 *
 * Main timeline: frame_2/DoAction.as → stop(). No explicit playSound on
 * main timeline; sound is driven from DefineSprite_8's frame_58.
 *
 * Since this is displayType=30, the harness drives the parabolic arc of
 * `move` to the target, then attaches `shoot` on landing and calls
 * signalHit automatically. However, this spell also has a parallel
 * DefineSprite_8 whose frame_61 calls `this.end()` (signalHit) — but since
 * the harness already fires signalHit at landing, we treat DefineSprite_8's
 * hit signal as redundant and do NOT call it a second time (signalHit is
 * idempotent, but per the guide: "DO NOT call it again").
 *
 * Wait — re-reading: for displayType 30/31 the harness fires signalHit at
 * landing (when shoot is attached). DefineSprite_8 is attached separately
 * from onSpellStart and represents the main impact sequence (explosion,
 * fade, etc.). It is the "outer mc" timeline here. Its frame_61 is the
 * canonical `this.end()` (signalHit) and frame_142 is `_parent.removeMovieClip()`
 * (complete). However, since harness already fires signalHit, DefineSprite_8's
 * frame_61 hit is genuinely redundant. completion is fired from sprite_8's
 * frame_142.
 *
 * `move` symbol: container-only (harness attaches it); 2 frames, no content.
 * `shoot` symbol: 105-frame animation; harness attaches at landing.
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

const SHOOT_BOUNDS = {
  width: 177.4,
  height: 106,
  offsetX: -88.9,
  offsetY: -52.9,
};

export class Spell212 extends RuntimeSpell {
  readonly spellId = 212;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  private sprite8Sym!: SymbolDefinition;
  private callbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- move — 2-frame container-only (harness drives arc) ------
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
    };

    // ---- shoot — 105-frame impact animation at target ------------
    // AS DefineSprite_3_shoot/frame_1/DoAction.as: _rotation = 0
    // AS DefineSprite_3_shoot/frame_73/DoAction.as: install onEnterFrame fade
    // AS DefineSprite_3_shoot/frame_103/DoAction.as: _parent.removeMovieClip(); stop();
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 105,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_1/DoAction.as: _rotation = 0
            // Override harness velocity-angle rotation so impact stands upright.
            clip.rotation = 0;
          },
        ],
        [
          72,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_73/DoAction.as:
            //   this.onEnterFrame = function() { _alpha = _alpha - 3; };
            clip.onEnterFrame = (c) => {
              c.alpha -= 3 / 100;
            };
          },
        ],
        [
          102,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_103/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- sprite_8 — 142-frame target-anchored secondary timeline -
    // AS DefineSprite_8/frame_1/DoAction.as:  _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    // AS DefineSprite_8/frame_58/DoAction.as: SOMA.playSound("explosion");
    // AS DefineSprite_8/frame_61/DoAction.as: this.end(); (→ signalHit — already fired by harness)
    // AS DefineSprite_8/frame_118/PlaceObject2_7_13/onClipEvent(enterFrame): _parent._alpha -= 5;
    // AS DefineSprite_8/frame_142/DoAction.as: _parent.removeMovieClip();
    //
    // The clip event at frame_118 is on a CHILD of sprite_8. We model it
    // by installing an onEnterFrame on sprite_8 itself at frame 117 that
    // fades its own alpha — this matches the net effect of the child's
    // `_parent._alpha -= 5` which targets sprite_8.
    this.sprite8Sym = {
      name: "sprite_8",
      totalFrames: 142,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_8/frame_1/DoAction.as:
            //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
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
          57,
          () => {
            // AS DefineSprite_8/frame_58/DoAction.as: SOMA.playSound("explosion");
            this.callbacks?.playSound("explosion");
          },
        ],
        [
          60,
          () => {
            // AS DefineSprite_8/frame_61/DoAction.as: this.end();
            // signalHit is already fired by the harness at ballistic landing;
            // this is the canonical second acknowledgement — idempotent, no-op.
          },
        ],
        [
          117,
          (clip) => {
            // AS DefineSprite_8/frame_118/PlaceObject2_7_13/onClipEvent(enterFrame):
            //   _parent._alpha -= 5;
            // A child placed at frame_118 runs `_parent._alpha -= 5` each frame.
            // We model this by installing an onEnterFrame on sprite_8 that
            // fades it by 5/100 per tick (same net effect).
            clip.onEnterFrame = (c) => {
              c.alpha -= 5 / 100;
            };
          },
        ],
        [
          141,
          (clip) => {
            // AS DefineSprite_8/frame_142/DoAction.as: _parent.removeMovieClip();
            clip.remove();
          },
        ],
      ]),
    };

    this.registry.register(moveSym);
    this.registry.register(shootSym);
    this.registry.register(this.sprite8Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture callbacks so frame scripts can fire sounds.
    this.callbacks = callbacks;

    // Main timeline frame_2/DoAction.as: stop();
    // No playSound on main timeline — sound comes from sprite_8's frame_58.

    // Attach the secondary target-anchored timeline. It positions itself
    // at cellTo in its own frame_1, so we attach at root (0,0) and let
    // frame_1 handle the positioning.
    this.root.attach(this.sprite8Sym, "sprite_8", 1, context);
  }
}
