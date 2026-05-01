/**
 * Spell 2057 — (Unknown spell name).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2057/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single composite animation
 * (sprite_9) with no projectile motion, no library symbols to attachMovie,
 * and no caster-side parallel timeline. sprite_9 runs entirely at the target
 * cell. This is a pure impact-at-target pattern.
 *
 * Canonical AS layout:
 *   - sprite_9 (66 frames, animations entry "sprite_9"):
 *       frame_16: reposition self at _parent.cellTo (x/y correction mid-animation)
 *       frame_31: this.end() → signalHit (damage popup)
 *       frame_52: _parent.removeMovieClip() → spell complete
 *   - main timeline frame_2: stop()
 *
 * No librarySymbols[] entries — no attachMovie calls anywhere. sprite_9 is the
 * sole animation, placed directly from onSpellStart.
 *
 * Library symbols: none.
 * Main timeline: stop() on frame_2 (no sound referenced).
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

const SPRITE_9_BOUNDS = {
  width: 205.2,
  height: 349.8,
  offsetX: -101.5,
  offsetY: -295.5,
};

export class Spell2057 extends RuntimeSpell {
  readonly spellId = 2057;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite9Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite9Anchor = calculateAnchor(SPRITE_9_BOUNDS);

    // sprite_9 — main impact animation, 66 frames, placed at target cell.
    // Canonical AS:
    //   frame_16: _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    //   frame_31: this.end();  (signalHit)
    //   frame_52: _parent.removeMovieClip();  (spell complete)
    this.sprite9Sym = {
      name: "sprite_9",
      totalFrames: 66,
      frames: textures.getFrames("sprite_9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      frameScripts: new Map([
        [
          15,
          (clip) => {
            // AS DefineSprite_9/frame_16/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
            // For displayType=11 (TargetCell) the container origin IS cellTo,
            // so the clip's local (0,0) maps to cellTo. We apply the world
            // coords here exactly as canonical AS does — reading cellTo from
            // root.vars and converting to local space.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            const anchor = (root?.vars as Record<string, unknown>)?.cellTo as
              | { x: number; y: number }
              | undefined;
            // The container (root) is positioned at cellTo by the harness.
            // _X/_Y in AS are in the outer mc's local space, which equals
            // world space minus the anchor offset. Since anchor == cellTo,
            // the effective local position is (0,0). We mirror that exactly.
            if (cellTo) {
              clip.x = 0;
              clip.y = 0;
            }
            void anchor;
          },
        ],
        [
          30,
          () => {
            // AS DefineSprite_9/frame_31/DoAction.as
            // this.end() → signalHit (damage popup at target)
            this.runtime.signalHit();
          },
        ],
        [
          51,
          (clip) => {
            // AS DefineSprite_9/frame_52/DoAction.as
            // _parent.removeMovieClip() → spell complete
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite9Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline frame_2: stop() — no sound referenced.
    // Attach sprite_9 at the root so it starts ticking from the next frame.
    // displayType=11 places the container at cellTo, so sprite_9 at local
    // (0,0) renders correctly at the target cell.
    this.root.attach(this.sprite9Sym, "sprite_9", 1, context);
  }
}
