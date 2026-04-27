/**
 * Spell 1052 — Aspiration (Xelor or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1052/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The spell has two parallel authored timelines:
 *   - sprite_18 (48 frames): a small particle placed at the caster/target area,
 *     randomly flipped on Y, stops at frame 48.
 *   - sprite_20 (149 frames): the main beam/effect. frame_6 positions itself at
 *     cellFrom with angle rotation; frame_78 calls this.end() (signalHit);
 *     frame_145 stops + calls _parent.removeMovieClip() (spell complete).
 *
 * The two sprites read _parent.cellFrom / _parent.cellTo / _parent.angle — the
 * canonical pattern for WorldAbsolute (displayType 50/51). The harness exposes
 * these on root.vars. The main timeline frame_2 plays the "aspiration" sound and
 * stops.
 *
 * No librarySymbols[] entries in manifest — both animations are top-level
 * animations[] entries. No lib_ prefix is used.
 *
 * Library symbols:
 *   - sprite_18 — 48-frame particle. frame_1 randomises Y offset and optionally
 *     flips yscale; frame_48 stops.
 *   - sprite_20 — 149-frame main effect. frame_6 positions at cellFrom + angle;
 *     frame_78 signals hit; frame_145 stops + completes spell.
 *
 * Main timeline: SOMA.playSound("aspiration"); stop(); — ported in onSpellStart.
 * Both sprites are attached from onSpellStart (implicit main-timeline placement).
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
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite18Sym!: SymbolDefinition;
  private sprite20Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite18Anchor = calculateAnchor(SPRITE_18_BOUNDS);
    const sprite20Anchor = calculateAnchor(SPRITE_20_BOUNDS);

    // ---- sprite_18 — small particle (48 frames) ------------------
    // AS DefineSprite_18/frame_1/DoAction.as:
    //   _Y = 20 * (-0.5 + Math.random());
    //   if(random(2) == 1) { _yscale = -_yscale; }
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
            // AS: DefineSprite_18/frame_1/DoAction.as
            clip.y = 20 * (-0.5 + Math.random());
            if (Math.floor(Math.random() * 2) === 1) {
              clip.scaleY = -clip.scaleY;
            }
          },
        ],
        [
          47,
          (clip) => {
            // AS: DefineSprite_18/frame_48/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_20 — main beam/effect (149 frames) ---------------
    // AS DefineSprite_20/frame_6/DoAction.as:
    //   _X = _parent.cellFrom.x;
    //   _Y = _parent.cellFrom.y - 20;
    //   _rotation = _parent.angle;
    // AS DefineSprite_20/frame_78/DoAction.as:
    //   this.end(); → signalHit
    // AS DefineSprite_20/frame_145/DoAction.as:
    //   stop();
    //   this._parent.removeMovieClip(); → spell complete
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
            // AS: DefineSprite_20/frame_6/DoAction.as
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
            // AS: DefineSprite_20/frame_78/DoAction.as
            // this.end() → damage popup at target
            this.runtime.signalHit();
          },
        ],
        [
          144,
          (clip) => {
            // AS: DefineSprite_20/frame_145/DoAction.as
            // stop(); this._parent.removeMovieClip();
            clip.stop();
            clip.parent?.remove();
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
    context: SpellContext
  ): void {
    // AS: frame_2/DoAction.as — SOMA.playSound("aspiration"); stop();
    callbacks.playSound("aspiration");

    // Implicit main-timeline placement of sprite_18 and sprite_20.
    // Both are placed on frame_1 of the main timeline (WorldAbsolute —
    // they position themselves via _parent.cellFrom / _parent.angle in
    // their own frame scripts).
    this.root.attach(this.sprite18Sym, "sprite18", 1, context);
    this.root.attach(this.sprite20Sym, "sprite20", 2, context);
  }
}
