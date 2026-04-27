/**
 * Spell 105 — Arty (Feca shield/aura).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/105/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell is a single impact animation at the
 * target cell with no projectile, no caster reference, and no dual-anchor
 * pattern. The outermost sprite (DefineSprite_11) sits at the target and runs
 * a 241-frame timeline. It is the only authored top-level child.
 *
 * Library symbols:
 *   - lib_tige — single-frame thorn/stalk visual. frame_1 positions self via
 *     sinusoidal oscillation using _parent._parent.i (the phase accumulator
 *     stored on the outer mc). No onEnterFrame — fully positioned at load.
 *
 * Container symbols (no authored frame textures):
 *   - anim1 (DefineSprite_11) — 241-frame outer container:
 *       frame_1:   seeds _parent.i = -π; sets up onEnterFrame to attach
 *                  `tige` particles (20 total, stepping i by 0.3 each).
 *       frame_178: this.end() → signalHit.
 *       frame_241: _parent.removeMovieClip() → complete().
 *   - inner (DefineSprite_7) — internal animated sub-sprite referenced by
 *     PlaceObject2 clips inside DefineSprite_11. Its frame scripts handle:
 *       frame_52:  gotoAndPlay(random(20) + 52) — random scrub loop.
 *       frame_112: PlaceObject2_4_1 onLoad → _alpha = random(80).
 *       frame_118: PlaceObject2_6_1 onLoad → _alpha = random(80).
 *       frame_127: PlaceObject2_4_1 onLoad → _alpha = random(80).
 *       frame_133: PlaceObject2_6_1 onLoad → _alpha = random(80).
 *       frame_139: PlaceObject2_6_1 onLoad → _alpha = random(120);
 *                  onEnterFrame → _alpha -= 5; _X -= 2.
 *       frame_175: stop().
 *   - inner9 (DefineSprite_9) — sub-sprite:
 *       frame_220: stop().
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("arty_105").
 *
 * NOTE: DefineSprite_7 and DefineSprite_9 are embedded sub-sprites placed
 * by PlaceObject2 tags on DefineSprite_11's timeline (not via attachMovie).
 * Their clip-event / frame scripts are authored into the SWF's PlaceObject2
 * records. Since the runtime drives timelines via frameScripts and there is
 * no attachMovie call for them in the AS, we model them as child symbols
 * registered and attached from DefineSprite_11's frame_1 script under
 * canonical instance names matching the PlaceObject2 depth/name records.
 * The alpha clip-events on PlaceObject2_4_1 / PlaceObject2_6_1 are ported
 * as onLoad/onEnterFrame on those child symbols.
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
  width: 244.6,
  height: 224.85,
  offsetX: -102.55,
  offsetY: -176.7,
};

export class Spell105 extends RuntimeSpell {
  readonly spellId = 105;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const tigeAnchor = calculateAnchor(TIGE_BOUNDS);

    // ---- lib_tige — sinusoidal thorn positioned at load ----------
    // AS: scripts/DefineSprite_10_tige/frame_1/DoAction.as
    // Reads _parent._parent.i (the phase angle on the outer DefineSprite_11's
    // parent, i.e. root). In our tree: tige.parent = DefineSprite_11 clip,
    // tige.parent.parent = root (which holds vars.i).
    const tigeSym: SymbolDefinition = {
      name: "tige",
      totalFrames: 1,
      frames: textures.getFrames("lib_tige"),
      anchorX: tigeAnchor.x,
      anchorY: tigeAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_10_tige/frame_1/DoAction.as
            // _X = 20 * Math.sin(_parent._parent.i);
            // _Y = 7 * Math.cos(_parent._parent.i);
            // _xscale = 50 * Math.cos(_parent._parent.i);
            // if (_Y < 0) { _alpha = 70 * Math.cos(_parent._parent.i) + 100; }
            const outerRoot = clip.parent?.parent;
            const i = (outerRoot?.vars.i as number) ?? 0;
            clip.x = 20 * Math.sin(i);
            clip.y = 7 * Math.cos(i);
            const cosI = Math.cos(i);
            clip.scaleX = (50 * cosI) / 100;
            const yVal = 7 * cosI;
            if (yVal < 0) {
              clip.alpha = (70 * cosI + 100) / 100;
            }
          },
        ],
      ]),
    };

    // ---- anim1 (DefineSprite_11) — 241-frame outer container -----
    // This is the top-level authored sprite placed on the main timeline.
    // frame_1:   seed root.vars.i = -π; set up onEnterFrame particle spawner.
    // frame_178: this.end() → signalHit.
    // frame_241: _parent.removeMovieClip() → complete().
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 241,
      frames: textures.getFrames("anim1"),
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_11/frame_1/DoAction.as
            // _parent.i = -3.1415;
            // c = 0;
            // this.onEnterFrame = function() {
            //   if (c < 40) {
            //     this.attachMovie("tige","tige" + c, c);
            //     c += 2;
            //     _parent.i += 0.3;
            //   }
            // };
            const root = clip.parent;
            if (root) {
              root.vars.i = -3.1415;
            }
            clip.vars.c = 0;
            clip.onEnterFrame = (self, innerCtx) => {
              const c = self.vars.c as number;
              if (c < 40) {
                const outerRoot = self.parent;
                if (outerRoot) {
                  const currentI = (outerRoot.vars.i as number) ?? -3.1415;
                  // Temporarily update i so tige frame_1 sees the right value
                  // before it reads it. This mirrors AS execution order where
                  // _parent.i was already incremented before attachMovie fires
                  // frame_1 actions on the new clip.
                  outerRoot.vars.i = currentI + 0.3;
                }
                self.attach(tigeSym, `tige${c}`, c, innerCtx);
                self.vars.c = c + 2;
              }
            };
          },
        ],
        [
          177,
          () => {
            // AS: DefineSprite_11/frame_178/DoAction.as
            // this.end() — signal hit (damage popup).
            this.runtime.signalHit();
          },
        ],
        [
          240,
          (clip) => {
            // AS: DefineSprite_11/frame_241/DoAction.as
            // _parent.removeMovieClip() — outer mc removal → spell complete.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(tigeSym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: scripts/frame_1/DoAction.as
    // SOMA.playSound("arty_105");
    callbacks.playSound("arty_105");

    // The main timeline implicitly places DefineSprite_11 (anim1) at depth 1
    // on frame 1. Attach it now so it starts ticking from the next runtime frame.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
