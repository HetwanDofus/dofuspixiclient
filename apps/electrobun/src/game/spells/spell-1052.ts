/**
 * Spell 1052 — Aspiration (Xelor / linear beam).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1052/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The manifest has no librarySymbols
 * and no `move`/`shoot` harness-driven containers in the classic ballistic
 * sense. Instead there are two authored timeline sprites:
 *
 *   - sprite_18 — 48-frame "aspiration ring" particle. Placed inside sprite_20.
 *       frame_1: randomise _Y ±10; randomly flip _yscale.
 *       frame_48: stop().
 *
 *   - sprite_20 — 149-frame composite "beam + ring" timeline (the shoot).
 *       frame_6 (index 5):  position self at cellFrom, rotate to angle.
 *       frame_78 (index 77): this.end() → signalHit.
 *       frame_145 (index 144): stop(); _parent.removeMovieClip() → complete.
 *
 * The main timeline (frame_2) plays the "aspiration" sound and stops.
 *
 * sprite_20's canonical AS positions itself at `_parent.cellFrom`, which
 * is the defining trait of a WorldAbsolute spell. sprite_20 IS the "shoot"
 * symbol conceptually, but the harness for ProjectileLinear would attach
 * it at a different place. Looking at the AS more carefully:
 *   - sprite_20 frame_6: `_X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 20;
 *     _rotation = _parent.angle;`
 * This means sprite_20 positions itself at the CASTER with the caster→target
 * rotation — exactly what ProjectileLinear / ProjectileLinearAlt do with
 * "shoot". No `move` symbol is needed.
 *
 * However, the harness for displayType 20 automatically attaches "shoot" at
 * the target-local offset and rotates the root. To faithfully reproduce the
 * canonical AS (where sprite_20 positions ITSELF at cellFrom + rotates to
 * angle inside its own frame_6 script), the cleanest approach is
 * WorldAbsolute (displayType=50). This way the root is at world (0,0),
 * sprite_20 gets attached from onSpellStart, and its frame_6 script sets the
 * correct absolute world position.
 *
 * Library symbols (none in librarySymbols[] — both are in animations[]):
 *   - sprite_18 — ring particle. frame_1 randomises Y + yscale flip;
 *                 frame_48 stops.
 *   - sprite_20 — main beam composite. frame_6 sets world position + rotation;
 *                 frame_78 fires signalHit; frame_145 calls complete.
 *
 * Main timeline: frame_2 → SOMA.playSound("aspiration"); stop();
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

const SPRITE_18_BOUNDS = {
  width: 220.25,
  height: 34.55,
  offsetX: -140.95,
  offsetY: -20.3,
};

const SPRITE_20_BOUNDS = {
  width: 489.85,
  height: 32.75,
  offsetX: -4.4,
  offsetY: -15.5,
};

export class Spell1052 extends RuntimeSpell {
  readonly spellId = 1052;
  // sprite_20 positions itself at _parent.cellFrom + rotates to _parent.angle
  // from its own frame_6 script — classic WorldAbsolute pattern.
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite18Sym!: SymbolDefinition;
  private sprite20Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite18Anchor = calculateAnchor(SPRITE_18_BOUNDS);
    const sprite20Anchor = calculateAnchor(SPRITE_20_BOUNDS);

    // ---- sprite_18 — aspiration ring particle --------------------
    // Placed inside sprite_20's timeline. Has authored frame textures.
    // AS DefineSprite_18/frame_1/DoAction.as:
    //   _Y = 20 * (-0.5 + Math.random());
    //   if (random(2) == 1) { _yscale = -_yscale; }
    // AS DefineSprite_18/frame_48/DoAction.as:
    //   stop();
    this.sprite18Sym = {
      name: "sprite_18",
      totalFrames: 48,
      frames: textures.getFrames("sprite_18"),
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_18/frame_1/DoAction.as
            clip.y = 20 * (-0.5 + Math.random());
            if (Math.floor(Math.random() * 2) === 1) {
              clip.scaleY = -clip.scaleY;
            }
          },
        ],
        [
          47,
          (clip) => {
            // AS DefineSprite_18/frame_48/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_20 — main beam + ring composite ------------------
    // Top-level child attached from onSpellStart.
    // AS DefineSprite_20/frame_6/DoAction.as  (frame index 5):
    //   _X = _parent.cellFrom.x;
    //   _Y = _parent.cellFrom.y - 20;
    //   _rotation = _parent.angle;
    // AS DefineSprite_20/frame_78/DoAction.as  (frame index 77):
    //   this.end();   → signalHit
    // AS DefineSprite_20/frame_145/DoAction.as (frame index 144):
    //   stop();
    //   this._parent.removeMovieClip();   → complete
    this.sprite20Sym = {
      name: "sprite_20",
      totalFrames: 149,
      frames: textures.getFrames("sprite_20"),
      anchorX: sprite20Anchor.x,
      anchorY: sprite20Anchor.y,
      frameScripts: new Map([
        [
          5,
          (clip) => {
            // AS DefineSprite_20/frame_6/DoAction.as
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 20;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          77,
          () => {
            // AS DefineSprite_20/frame_78/DoAction.as — this.end()
            this.runtime.signalHit();
          },
        ],
        [
          144,
          (clip) => {
            // AS DefineSprite_20/frame_145/DoAction.as
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite18Sym);
    this.registry.register(this.sprite20Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_2/DoAction.as:
    //   SOMA.playSound("aspiration"); stop();
    callbacks.playSound("aspiration");

    // Attach the main composite sprite. It will position itself at
    // cellFrom in its own frame_6 script (frame index 5).
    this.root.attach(this.sprite20Sym, "sprite20", 1, context);
  }
}
