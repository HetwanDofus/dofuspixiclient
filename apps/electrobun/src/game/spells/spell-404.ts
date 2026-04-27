/**
 * Spell 404 — Lakam (Sadida plant spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/404/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single animated sprite
 * (DefineSprite_6) placed at the target cell. No projectile motion, no
 * caster reference — pure impact/effect at target.
 *
 * Structure:
 *   - Main timeline frame_1: SOMA.playSound("lakam_404")
 *   - DefineSprite_6 (the outer container, 367 frames):
 *       frame_1: sets _parent.i = -π, then onEnterFrame spawns up to 11
 *                `tige` particles one per frame, incrementing i by 0.5
 *                each spawn until c reaches 11.
 *       frame_367: _parent.removeMovieClip() → spell complete; stop().
 *   - lib_tige (librarySymbols, 1 frame): positioned by frame_1 script
 *       using _parent._parent.i to compute sinusoidal X/Y offsets and
 *       _xscale; _alpha conditionally set when _Y < 0.
 *
 * The outer DefineSprite_6 is not in librarySymbols — it's the top-level
 * authored sprite attached from onSpellStart. The `tige` symbol IS in
 * librarySymbols and is attached from DefineSprite_6's onEnterFrame.
 *
 * signalHit: fired at the first tige spawn (frame_1 of DefineSprite_6),
 * which is the canonical impact moment.
 *
 * complete: fired at DefineSprite_6 frame_367 (AS: _parent.removeMovieClip()).
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

const TIGE_BOUNDS = {
  width: 152.15,
  height: 141.5,
  offsetX: -72.7,
  offsetY: -119.2,
};

export class Spell404 extends RuntimeSpell {
  readonly spellId = 404;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite6Sym!: SymbolDefinition;
  private tigeSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const tigeAnchor = calculateAnchor(TIGE_BOUNDS);

    // ---- lib_tige — single-frame plant stem particle -------------
    // AS: DefineSprite_5_tige/frame_1/DoAction.as
    // Positioned using _parent._parent.i (the angle accumulator stored
    // on the outer mc root.vars.i). X/Y are sinusoidal offsets;
    // _xscale mirrors the cosine; _alpha is conditionally set when Y < 0.
    this.tigeSym = {
      name: "tige",
      totalFrames: 1,
      frames: textures.getFrames("lib_tige"),
      anchorX: tigeAnchor.x,
      anchorY: tigeAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_5_tige/frame_1/DoAction.as
            // _parent._parent.i: tige's _parent is sprite_6;
            // sprite_6's _parent is root (outer mc).
            const sprite6 = clip.parent;
            const outerMc = sprite6?.parent;
            const i = (outerMc?.vars.i as number) ?? 0;
            const cosI = Math.cos(i);
            const sinI = Math.sin(i);
            clip.x = 15 * sinI;
            clip.y = 10 * cosI;
            // AS: _xscale = 50 * Math.cos(i) → decimal
            clip.scaleX = (50 * cosI) / 100;
            // AS: if (_Y < 0) { _alpha = 100 * cos(i) + 100 }
            // Note: _Y here refers to the already-set clip.y = 10 * cosI.
            // cosI is negative when |i| > π/2, giving negative Y.
            if (clip.y < 0) {
              clip.alpha = (100 * cosI + 100) / 100;
            }
          },
        ],
      ]),
    };

    // ---- sprite_6 — outer container, 367-frame timeline ----------
    // Not in librarySymbols (it's the top-level authored sprite).
    // Treated as a container-only symbol attached from onSpellStart.
    //
    // frame_1 (AS: DefineSprite_6/frame_1/DoAction.as):
    //   Sets _parent.i = -π (stored on root.vars.i).
    //   Installs onEnterFrame that spawns one tige per tick until c=11,
    //   incrementing i by 0.5 each spawn.
    //
    // frame_367 (AS: DefineSprite_6/frame_367/DoAction.as):
    //   _parent.removeMovieClip() → runtime.complete(); stop().
    this.sprite6Sym = {
      name: "sprite_6",
      totalFrames: 367,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: undefined,
      onEnterFrame: undefined,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_6/frame_1/DoAction.as
            // _parent.i = -3.1415; c = 0;
            const root = clip.parent;
            if (root) {
              root.vars.i = -3.1415;
            }
            clip.vars.c = 0;

            // Signal hit on the first frame when plant appears at target.
            // (Not displayType 30/31, so we call it ourselves.)
            this.runtime.signalHit();

            // Install onEnterFrame to spawn tige particles one per tick.
            clip.onEnterFrame = (self, innerCtx) => {
              // AS: if (c < 11) { attachMovie("tige","tige"+c,c); c++; _parent.i += 0.5; }
              const c = self.vars.c as number;
              if (c < 11) {
                // Increment i on root BEFORE attaching so tige frame_1
                // reads the updated i value. AS increments i after
                // attach, but tige's frame_1 fires at attach time —
                // the canonical order is:
                //   1. attachMovie (→ tige frame_1 fires, reads current i)
                //   2. c += 1
                //   3. _parent.i += 0.5
                // We replicate that exactly.
                const outerMc = self.parent;
                self.attach(this.tigeSym, `tige${c}`, c, innerCtx);
                self.vars.c = c + 1;
                if (outerMc) {
                  outerMc.vars.i = ((outerMc.vars.i as number) ?? 0) + 0.5;
                }
              }
            };
          },
        ],
        [
          366,
          (clip) => {
            // AS: DefineSprite_6/frame_367/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.tigeSym);
    this.registry.register(this.sprite6Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: frame_1/DoAction.as — SOMA.playSound("lakam_404");
    callbacks.playSound("lakam_404");

    // Attach the outer DefineSprite_6 container at the root (target cell).
    // The harness has already anchored root at the target cell for
    // displayType=11. sprite_6 sits at (0,0) within that container.
    this.root.attach(this.sprite6Sym, "sprite_6", 1, context);
  }
}
