/**
 * Spell 913 — Flèche de Glace / Cra ice arrow (Cra).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 *
 * Canonical AS layout (`tools/combat-exporter/output/spell-anims/913/scripts/scripts/`):
 *
 *   animations[]:
 *     - `shoot` — 66-frame composite animation at the target cell.
 *
 *   librarySymbols[]: (none in manifest — all symbols are in animations[])
 *
 *   DefineSprite_9_shoot — 66-frame container (the main impact at target):
 *     frame_7:  this.end() → signalHit (damage popup).
 *     frame_65: this._parent.removeMovieClip() → spell complete.
 *
 *   DefineSprite_11_move — container holding 7 authored sub-clips
 *     (PlaceObject2_10_1, _3, _5, _7, _9, _11, _13). Each sub-clip is
 *     a spinning/oscillating particle with identical load + enterFrame:
 *       onLoad:  a=45; t=50+3*level; _xscale=_yscale=t
 *       onEnterFrame: _rotation = 90 + a*cos(i+=0.5); a/=1.1
 *     These are AUTHORED children baked into the move timeline (not
 *     runtime-attached via attachMovie), but the harness drives move
 *     along the ballistic arc. We model them as a single "spinner"
 *     SymbolDefinition that gets attached 7 times with distinct names
 *     to mirror the 7 PlaceObject2 instances.
 *
 *   DefineSprite_3 — 35-frame single particle used inside move's
 *     authored children (the actual spinning fire/ice flake visual):
 *     frame_1:  _rotation = _parent._parent.angle; scatter X/Y
 *     frame_35: stop()
 *
 *   DefineSprite_7 — 27-frame sub-symbol:
 *     frame_27: stop()
 *
 *   DefineSprite_8 — sound clip:
 *     frame_1: SOMA.playSound("jet_903")
 *
 * displayType=30 (ProjectileBallistic):
 *   - Has both `move` and `shoot` symbols.
 *   - `move` is a 1-frame container with authored sub-clips (spinners).
 *   - `shoot` is a 66-frame impact at target.
 *   - Harness drives ballistic arc, attaches shoot on landing, calls
 *     signalHit automatically → we must NOT call it ourselves.
 *   - complete() is fired from shoot frame_65.
 *
 * Library symbols:
 *   - `spinner` — oscillating particle child of `move`. onLoad seeds
 *     a=45, t=50+3*level, scale. onEnterFrame oscillates rotation with
 *     decaying amplitude via cos.
 *   - `move` — 1-frame container, frame_1 attaches 7 spinner instances.
 *   - `shoot` — 66-frame impact composite using the `shoot` animation
 *     frames. frame_7 signals hit (via this.end()), frame_65 completes.
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
  width: 101.1,
  height: 63.25,
  offsetX: -62.05,
  offsetY: -28.4,
};

export class Spell913 extends RuntimeSpell {
  readonly spellId = 913;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  private spinnerSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    // ---- spinner — oscillating particle authored inside `move` ----
    // AS: DefineSprite_11_move/frame_1/PlaceObject2_10_*/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_11_move/frame_1/PlaceObject2_10_*/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // All 7 PlaceObject2 instances have identical load + enterFrame scripts.
    // We model them as a shared SymbolDefinition attached 7 times.
    this.spinnerSym = {
      name: "spinner",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   a = 45;
        //   t = 50 + 3 * _parent._parent.level;
        //   _xscale = t; _yscale = t;
        // _parent._parent from spinner's perspective:
        //   spinner → move → root (root has vars.level)
        const root = clip.parent?.parent ?? clip.parent;
        const level = (root?.vars.level as number) ?? 1;
        clip.vars.a = 45;
        const t = 50 + 3 * level;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   _rotation = 90 + a * Math.cos(i += 0.5);
        //   a /= 1.1;
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 0.5;
        // AS rotation in degrees → convert to radians
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        a /= 1.1;
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

    // ---- move — 1-frame container holding 7 spinner sub-clips ----
    // AS: DefineSprite_11_move has 7 authored PlaceObject2 children
    // (depths 1, 3, 5, 7, 9, 11, 13). We attach them all in frame_1.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_11_move/frame_1 — 7 authored PlaceObject2
            // instances at depths 1, 3, 5, 7, 9, 11, 13.
            // Each has identical load/enterFrame — attach as spinner.
            const depths = [1, 3, 5, 7, 9, 11, 13];
            for (const depth of depths) {
              clip.attach(this.spinnerSym, `spinner_${depth}`, depth, ctx);
            }
          },
        ],
      ]),
    };

    // ---- shoot — 66-frame impact composite at target -------------
    // AS: DefineSprite_9_shoot
    //   frame_7:  this.end() → signalHit
    //   frame_65: this._parent.removeMovieClip() → spell complete
    // NOTE: displayType=30, harness calls signalHit() automatically on
    // landing — but shoot's canonical frame_7 also calls this.end()
    // which is the game's hit signal. The harness signalHit fires at
    // the ballistic landing moment (before shoot plays). The frame_7
    // this.end() is a secondary / redundant trigger that in canonical
    // AS was how the outer MC informed the combat sequencer. Since the
    // harness already signalled hit at landing, we do NOT call it again
    // here (per the guide: "Per-spell modules should NOT also call it
    // for displayType 30/31 spells").
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 66,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          6,
          (_clip) => {
            // AS DefineSprite_9_shoot/frame_7/DoAction.as: this.end()
            // Harness has already called signalHit() at ballistic landing.
            // No-op here for displayType=30 per the implementation guide.
          },
        ],
        [
          64,
          (clip) => {
            // AS DefineSprite_9_shoot/frame_65/DoAction.as:
            //   this._parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.spinnerSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // AS: DefineSprite_8/frame_1/DoAction.as: SOMA.playSound("jet_903")
    callbacks.playSound("jet_903");
  }
}
