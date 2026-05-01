/**
 * Spell 404 — Lakam (Sadida vine/tige spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/404/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell places a single composite sprite
 * (DefineSprite_6, the outer container) at the target cell. That sprite's
 * frame_1 DoAction starts an onEnterFrame loop that attaches up to 11 `tige`
 * library symbols one per tick, incrementing a shared `_parent.i` phase angle
 * that each tige reads in its own frame_1 to position and scale itself.
 * Frame 367 of DefineSprite_6 calls `_parent.removeMovieClip()` + stop(),
 * which signals spell completion.
 *
 * There are no `move`, `shoot`, or `duplicate` symbols — no projectile.
 * The single animation is driven by a container clip with a long timeline
 * and runtime-spawned `tige` children.
 *
 * Library symbols:
 *   - `tige` (DefineSprite_5_tige, 1 frame) — a vine segment. frame_1
 *     positions/scales itself using `_parent._parent.i` (the shared phase
 *     angle stored on the outer sprite's parent, i.e. the root). Alpha is
 *     conditionally set when `_Y < 0`.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("lakam_404").
 *
 * The outer sprite (DefineSprite_6) is not in librarySymbols[] but is the
 * sole authored timeline content. We model it as a container symbol attached
 * from onSpellStart with a frameScripts-driven attach loop and a completion
 * trigger at frame 366 (AS frame_367, 0-based 366).
 *
 * signalHit: fired from the outer sprite's frame_1 script immediately when
 * the first tige appears (frame 0 of the outer container = first visible
 * impact frame). This is a TargetCell spell with no projectile, so the hit
 * is signalled at first render.
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

  private tigeSym!: SymbolDefinition;
  private outerSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const tigeAnchor = calculateAnchor(TIGE_BOUNDS);

    // ---- lib_tige — vine segment, positioned by shared phase angle ----
    // AS: DefineSprite_5_tige/frame_1/DoAction.as
    //   _X = 15 * Math.sin(_parent._parent.i);
    //   _Y = 10 * Math.cos(_parent._parent.i);
    //   _xscale = 50 * Math.cos(_parent._parent.i);
    //   if (_Y < 0) { _alpha = 100 * Math.cos(_parent._parent.i) + 100; }
    //
    // Note: the tige's frame_1 script runs once on attach (via frameScripts[0]).
    // It reads `_parent._parent.i` which is the outer container's parent (root).
    // In our tree: tige.parent = outerClip, outerClip.parent = root.
    // root.vars.i holds the shared phase angle.
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
            // _parent._parent is outerClip.parent = root
            const outerClip = clip.parent;
            const root = outerClip?.parent;
            const i = (root?.vars.i as number) ?? 0;

            clip.x = 15 * Math.sin(i);
            const y = 10 * Math.cos(i);
            clip.y = y;
            // AS: _xscale = 50 * Math.cos(i) → decimal
            clip.scaleX = (50 * Math.cos(i)) / 100;
            // AS: if (_Y < 0) { _alpha = 100 * Math.cos(i) + 100; }
            if (y < 0) {
              clip.alpha = (100 * Math.cos(i) + 100) / 100;
            }
          },
        ],
      ]),
    };

    // ---- outer container (DefineSprite_6) — 372-frame container ----
    // AS: DefineSprite_6/frame_1/DoAction.as
    //   _parent.i = -3.1415;
    //   c = 0;
    //   this.onEnterFrame = function() {
    //     if (c < 11) {
    //       this.attachMovie("tige","tige" + c, c);
    //       c += 1;
    //       _parent.i += 0.5;
    //     }
    //   };
    //
    // AS: DefineSprite_6/frame_367/DoAction.as
    //   _parent.removeMovieClip();
    //   stop();
    //
    // `_parent.i` is set on the outer clip's parent (= root).
    // `c` is a local to the onEnterFrame closure — we store it in clip.vars.
    this.outerSym = {
      name: "outer",
      totalFrames: 372,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, _ctx) => {
            // AS: DefineSprite_6/frame_1/DoAction.as — initialization
            // _parent.i = -3.1415  →  root.vars.i = -Math.PI
            const root = clip.parent;
            if (root) {
              root.vars.i = -3.1415;
            }
            clip.vars.c = 0;
            // Signal hit immediately — this is a TargetCell impact spell,
            // no projectile. The first visible frame is the hit frame.
            this.runtime.signalHit();
          },
        ],
        [
          366,
          (clip) => {
            // AS: DefineSprite_6/frame_367/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
      onEnterFrame: (clip, ctx) => {
        // AS: DefineSprite_6/frame_1/DoAction.as — onEnterFrame closure
        // if (c < 11) {
        //   this.attachMovie("tige","tige" + c, c);
        //   c += 1;
        //   _parent.i += 0.5;
        // }
        const c = clip.vars.c as number;
        if (c < 11) {
          clip.attach(this.tigeSym, `tige${c}`, c, ctx);
          clip.vars.c = c + 1;
          const root = clip.parent;
          if (root) {
            const i = (root.vars.i as number) ?? -3.1415;
            root.vars.i = i + 0.5;
          }
        }
      },
    };

    this.registry.register(this.tigeSym);
    this.registry.register(this.outerSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: frame_1/DoAction.as — SOMA.playSound("lakam_404");
    callbacks.playSound("lakam_404");
    // Attach the outer container clip to root; it starts ticking immediately.
    this.root.attach(this.outerSym, "outer", 1, context);
  }
}
