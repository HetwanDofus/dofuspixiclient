/**
 * Spell 2200 — (Unknown name, likely a Cra/water-style beam spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2200/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The canonical DefineSprite_28/frame_4/DoAction.as
 * positions sprite_28 at `_parent.cellFrom.x / _parent.cellFrom.y - 20` with
 * `_rotation = _parent.angle`, which is the "position self at world coords read from
 * _parent" pattern — definitive WorldAbsolute. The harness stores cellFrom/cellTo/angle
 * on root.vars and leaves container at world (0,0).
 *
 * Manifest animations (NO librarySymbols[] — all symbols are in animations[]):
 *   - sprite_15 — 42-frame caster-side burst effect (no AS scripts → plays to end implicitly).
 *     Not referenced by any AS script in the manifest scripts list; however it is present
 *     as an animation and likely placed on the main timeline alongside the others.
 *     Given the AS only scripts DefineSprite_26 and DefineSprite_28, sprite_15 is a
 *     silent cosmetic placed implicitly at (cellFrom) by the main timeline.
 *   - sprite_26 — 48-frame streaking particle. frame_1 randomises _Y offset and flips
 *     _yscale with 1-in-4 chance. frame_48 stops. Placed inside sprite_28 by the
 *     original SWF (sprite_28 is composite / isComposite=true).
 *   - sprite_28 — 99-frame composite beam/aspiration container.
 *       frame_4:  position self at cellFrom, apply angle rotation.
 *       frame_52: this.end() → signalHit.
 *       frame_97: stop(); _parent.removeMovieClip() → complete().
 *
 * Main timeline (frame_2/DoAction.as): SOMA.playSound("aspiration"); stop();
 * The main timeline implicitly places sprite_28 (and sprite_15) at depth on frame_1.
 * We attach them explicitly in onSpellStart.
 *
 * Since librarySymbols[] is empty, textures are loaded WITHOUT the "lib_" prefix.
 * All three symbols use textures.getFrames("<name>") directly.
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

// Bounds from manifest.json animations[]
const SPRITE_15_BOUNDS = {
  width: 193.15,
  height: 169.75,
  offsetX: -88.4,
  offsetY: -132.3,
};

const SPRITE_26_BOUNDS = {
  width: 220.25,
  height: 34.55,
  offsetX: -140.95,
  offsetY: -20.3,
};

const SPRITE_28_BOUNDS = {
  width: 549.05,
  height: 52.95,
  offsetX: -63.6,
  offsetY: -27.8,
};

export class Spell2200 extends RuntimeSpell {
  readonly spellId = 2200;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite15Sym!: SymbolDefinition;
  private sprite26Sym!: SymbolDefinition;
  private sprite28Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite15Anchor = calculateAnchor(SPRITE_15_BOUNDS);
    const sprite26Anchor = calculateAnchor(SPRITE_26_BOUNDS);
    const sprite28Anchor = calculateAnchor(SPRITE_28_BOUNDS);

    // ---- sprite_15 — 42-frame caster-side burst/impact effect ----
    // No AS scripts reference this symbol's timeline directly; it plays
    // through its 42 frames as a pure visual. Positioned at cellFrom by
    // the main timeline (we attach it in onSpellStart).
    this.sprite15Sym = {
      name: "sprite_15",
      totalFrames: 42,
      frames: textures.getFrames("sprite_15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
    };

    // ---- sprite_26 — 48-frame streaking beam particle ------------
    // AS scripts/scripts/DefineSprite_26/frame_1/DoAction.as:
    //   _Y = 20 * (-0.5 + Math.random());
    //   if (random(4) == 1) { _yscale = -_yscale; }
    //
    // AS scripts/scripts/DefineSprite_26/frame_48/DoAction.as:
    //   stop();
    //
    // This symbol is placed inside sprite_28 (the composite container).
    // The frame_1 script randomises Y position and randomly flips vertical
    // scale. Since there are no onClipEvent handlers (no CLIPACTIONRECORD
    // entries in the manifest scripts list), only frameScripts are needed.
    this.sprite26Sym = {
      name: "sprite_26",
      totalFrames: 48,
      frames: textures.getFrames("sprite_26"),
      anchorX: sprite26Anchor.x,
      anchorY: sprite26Anchor.y,
      frameScripts: new Map([
        [
          // AS DefineSprite_26/frame_1/DoAction.as (0-based index 0)
          0,
          (clip) => {
            // _Y = 20 * (-0.5 + Math.random())
            clip.y = 20 * (-0.5 + Math.random());
            // if (random(4) == 1) { _yscale = -_yscale; }
            if (Math.floor(Math.random() * 4) === 1) {
              clip.scaleY = -clip.scaleY;
            }
          },
        ],
        [
          // AS DefineSprite_26/frame_48/DoAction.as (0-based index 47)
          47,
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_28 — 99-frame composite beam/aspiration container ---
    // isComposite=true: contains sprite_26 as a child placed on its
    // timeline. We attach sprite_26 at frame_1 (index 0) of sprite_28.
    //
    // AS scripts/scripts/DefineSprite_28/frame_4/DoAction.as (index 3):
    //   _X = _parent.cellFrom.x;
    //   _Y = _parent.cellFrom.y - 20;
    //   _rotation = _parent.angle;
    //
    // AS scripts/scripts/DefineSprite_28/frame_52/DoAction.as (index 51):
    //   this.end();  → signalHit
    //
    // AS scripts/scripts/DefineSprite_28/frame_97/DoAction.as (index 96):
    //   stop();
    //   this._parent.removeMovieClip();  → complete()
    this.sprite28Sym = {
      name: "sprite_28",
      totalFrames: 99,
      frames: textures.getFrames("sprite_28"),
      anchorX: sprite28Anchor.x,
      anchorY: sprite28Anchor.y,
      frameScripts: new Map([
        [
          // Attach the composite child sprite_26 at frame_1 (index 0) of
          // sprite_28. The SWF places it implicitly on frame_1 of the
          // composite timeline. It has its own frame_1 script that fires
          // via attach().
          0,
          (clip, ctx) => {
            clip.attach(this.sprite26Sym, "sprite_26", 1, ctx);
          },
        ],
        [
          // AS DefineSprite_28/frame_4/DoAction.as (0-based index 3)
          // Position self at cellFrom with angle rotation.
          3,
          (clip) => {
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 20;
            }
            // AS: _rotation = _parent.angle  (degrees → radians)
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          // AS DefineSprite_28/frame_52/DoAction.as (0-based index 51)
          // this.end() → signal hit (damage popup at target).
          51,
          () => {
            this.runtime.signalHit();
          },
        ],
        [
          // AS DefineSprite_28/frame_97/DoAction.as (0-based index 96)
          // stop(); this._parent.removeMovieClip();
          96,
          (clip) => {
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite15Sym);
    this.registry.register(this.sprite26Sym);
    this.registry.register(this.sprite28Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/scripts/frame_2/DoAction.as:
    //   SOMA.playSound("aspiration"); stop();
    callbacks.playSound("aspiration");

    // Implicit main-timeline frame_1 placement of sprite_28 and sprite_15.
    // sprite_28 is the primary beam composite; sprite_15 is the caster burst.
    // Both are attached here so they start ticking from the next runtime frame.
    //
    // For displayType=50 (WorldAbsolute), the container is at world (0,0).
    // sprite_28 positions itself at cellFrom in its own frame_4 script.
    // sprite_15 is placed at cellFrom directly.
    const cellFrom = context.cellFrom;

    this.root.attach(this.sprite28Sym, "sprite_28", 2, context);

    // sprite_15 — caster burst: position at cellFrom directly since it
    // has no self-positioning frame script.
    const s15 = this.root.attach(this.sprite15Sym, "sprite_15", 1, context);
    s15.x = cellFrom.x;
    s15.y = cellFrom.y;
  }
}
