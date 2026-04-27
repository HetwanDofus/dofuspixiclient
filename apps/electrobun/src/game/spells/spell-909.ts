/**
 * Spell 909 — Flèche Enflammée (Cra fire arrow).
 *
 * Hand-ported against the SpellClip / SpellRuntime runtime as the
 * second M4 validation slice. This is the most complex pattern in the
 * 1.29 spell set: displayType=51 (WorldAbsolute), TWO parallel
 * authored timelines (one anchored at caster, one anchored at target),
 * AND a runtime-spawned `cercle` particle with full ballistic physics
 * driven by per-particle clip events.
 *
 * Canonical AS layout (`tools/combat-exporter/output/spell-anims/909/
 * scripts/scripts/`):
 *
 *   - top-level main timeline: 2 frames. frame_2 plays the "jet_903"
 *     sound + stops. frame_1 implicitly places sprite_22 + sprite_41
 *     on the timeline — we attach them explicitly in onSpellStart.
 *
 *   - sprite_22 — caster-side timeline (45 frames):
 *       frame_1:  position self at _parent.cellFrom; rotate to face
 *                 target via _parent.angle.
 *       frame_7:  spawn 10 + level*3 `cercle` particles inside self.
 *       frame_43: stop().
 *
 *   - sprite_41 — target-side timeline (84 frames):
 *       frame_1:  position self at _parent.cellTo; rotate to angle.
 *       frame_13: this.end() → signalHit (damage popup at target).
 *       frame_67: _parent.removeMovieClip → spell complete.
 *
 *   - lib_cercle — single-frame particle. clipEvents:
 *       onLoad: seed d, accx, x, sr, vx, vy, vt, va, vr, t.
 *       onEnterFrame: rotate (vr decays); X drift accelerates; t/scale
 *                     ramp up via vt; remove when t < 0.
 *
 * displayType=51 means the harness only stores cellFrom/cellTo/angle
 * on root.vars; per-spell scripts position children at WORLD coords.
 * Both sprite_22 and sprite_41 do exactly that on their frame_1.
 *
 * NOTE: sprite_22 (45 frames) and sprite_41 (84 frames) have authored
 * hand-drawn frame textures in their dofasset (the orange flame
 * outlines). M4 here treats them as container-only timelines so we
 * validate the orchestration; M5 will wire frame textures through
 * once the AS compiler can split per-frame texture extraction from
 * timeline scripts.
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

const CERCLE_BOUNDS = {
  width: 34.75,
  height: 34.4,
  offsetX: -17.2,
  offsetY: -17.3,
};

export class Spell909 extends RuntimeSpell {
  readonly spellId = 909;
  readonly displayType = SpellDisplayType.WorldAbsoluteAlt;

  private cercleSym!: SymbolDefinition;
  private sprite22Sym!: SymbolDefinition;
  private sprite41Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);

    // ---- lib_cercle — orange particle with full physics ----------
    // AS DefineSprite_3_cercle/frame_1/PlaceObject2_2_1/onClipEvent(load):
    //   d = 120 + (_parent._parent._parent.level - 1) * 32
    //   accx = 0.8 + 0.12 * Math.random()
    //   x = d * Math.random()
    //   if (random(2) == 1) { _Y = 5; sr = -1 } else { sr = 1; _Y = -5 }
    //   _xscale = _yscale = 0
    //   t = 5;  _X = x
    //   va = 5 + 10 * Math.random()
    //   vr = (20 + 40 * Math.random()) * sr
    //   vt = (1 + random(1)) * ((d - x) / d)
    //   vx = 5 + 10 * Math.random()
    //
    // onClipEvent(enterFrame):
    //   _rotation = _rotation - (vr *= 0.97)
    //   _X = _X + (vx *= accx)
    //   t += vt -= 0.1
    //   _xscale = _yscale = t
    //   if (t < 0) _parent.removeMovieClip()
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      onLoad: (clip) => {
        // _parent._parent._parent.level — cercle's _parent is sprite_22
        // (after attachMovie inside sprite_22's frame_7). The next
        // hop is the outer mc (= our root). We collapse the AS
        // 3-level traversal to (clip → sprite_22 → root) here.
        const root = clip.parent?.parent ?? clip.parent;
        const level = (root?.vars.level as number) ?? 1;
        const d = 120 + (level - 1) * 32;
        clip.vars.d = d;
        clip.vars.accx = 0.8 + 0.12 * Math.random();
        const xStart = d * Math.random();
        let yStart: number;
        let sr: number;
        if (Math.floor(Math.random() * 2) === 1) {
          yStart = 5;
          sr = -1;
        } else {
          sr = 1;
          yStart = -5;
        }
        clip.scaleX = 0;
        clip.scaleY = 0;
        clip.vars.t = 5;
        clip.x = xStart;
        clip.y = yStart;
        clip.vars.va = 5 + 10 * Math.random();
        clip.vars.vr = (20 + 40 * Math.random()) * sr;
        clip.vars.vt = (1 + Math.floor(Math.random() * 2)) * ((d - xStart) / d);
        clip.vars.vx = 5 + 10 * Math.random();
      },
      onEnterFrame: (clip) => {
        let vr = clip.vars.vr as number;
        let vx = clip.vars.vx as number;
        let vt = clip.vars.vt as number;
        let t = clip.vars.t as number;
        const accx = clip.vars.accx as number;

        vr *= 0.97;
        // AS rotation in degrees → convert delta to radians.
        clip.rotation -= (vr * Math.PI) / 180;
        vx *= accx;
        clip.x += vx;
        vt -= 0.1;
        t += vt;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;

        clip.vars.vr = vr;
        clip.vars.vx = vx;
        clip.vars.vt = vt;
        clip.vars.t = t;

        if (t < 0) {
          clip.remove();
        }
      },
    };

    // ---- sprite_22 — caster-side authored timeline ---------------
    this.sprite22Sym = {
      name: "sprite_22",
      totalFrames: 45,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // frame_1: position at cellFrom, rotate to angle.
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 50;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          6,
          (clip, ctx) => {
            // frame_7: spawn 10 + level*3 cercle particles
            const root = clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            const nb = 10 + level * 3;
            for (let c = 1; c < nb; c++) {
              clip.attach(this.cercleSym, `cercle${c}`, c, ctx);
            }
          },
        ],
        [
          42,
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_41 — target-side authored timeline ---------------
    this.sprite41Sym = {
      name: "sprite_41",
      totalFrames: 84,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y - 50;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          12,
          () => {
            // frame_13: this.end() → damage popup at target.
            this.runtime.signalHit();
          },
        ],
        [
          66,
          (clip) => {
            // frame_67: _parent.removeMovieClip → spell complete.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.cercleSym);
    this.registry.register(this.sprite22Sym);
    this.registry.register(this.sprite41Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Top-level main timeline frame_2: SOMA.playSound("jet_903"); stop();
    callbacks.playSound("jet_903");
    // Implicit frame_1 placement of sprite_22 + sprite_41 on the main
    // timeline. Attach them so they start ticking from the next runtime
    // frame.
    this.root.attach(this.sprite22Sym, "sprite22", 1, context);
    this.root.attach(this.sprite41Sym, "sprite41", 2, context);
  }
}
