/**
 * Spell 908 — Flèche de Recul (Cra retreat arrow).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/908/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). Detection rationale:
 *   - Has both `move` and `shoot` symbols.
 *   - `move` carries a 2-frame authored content with a PlaceObject child that
 *     has onClipEvent(load) + onClipEvent(enterFrame) — the canonical "spinner
 *     during flight" particle attached inside the moving projectile.
 *   - `shoot` is an 84-frame impact timeline with `_rotation = 0` in frame_1
 *     (the canonical override of harness-applied velocity angle), and
 *     `_parent.removeMovieClip()` at frame_70 — identical pattern to spell 103.
 *   - The harness drives the parabolic arc, attaches `shoot` on landing, and
 *     calls `runtime.signalHit()` automatically — we must NOT call it again.
 *
 * Library symbols:
 *   - `move`  — 2-frame projectile container. The authored child (PlaceObject2_12_1)
 *               is a spinner: onLoad seeds `a=45` and scale from level; onEnterFrame
 *               oscillates rotation as `90 + a*cos(i+=0.5)` with `a /= 1.1` decay.
 *               Because this child is placed by the SWF's authored timeline (not by
 *               attachMovie in a DoAction script), we register a dedicated symbol for
 *               it ("moveChild") and attach it from move's frame_0 script.
 *   - `shoot` — 84-frame impact animation with authored SVG frames. frame_1 resets
 *               `_rotation = 0`; frame_4 plays the "wab_2005b" sound; frame_70
 *               calls `_parent.removeMovieClip()` → spell complete.
 *
 * Main timeline: no explicit DoAction scripts found — harness attaches `move`
 * automatically for displayType 30. `onSpellStart` is a no-op (sound is played
 * from within shoot's frame_4 script).
 *
 * Note on sound: `SOMA.playSound("wab_2005b")` fires from
 * DefineSprite_6_shoot/frame_4/DoAction.as, which runs inside the shoot symbol
 * after landing. We capture `callbacks.playSound` in a private field during
 * `onSpellStart` and invoke it from the frame_4 script.
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
  width: 177.7,
  height: 141.7,
  offsetX: -89.05,
  offsetY: -88.5,
};

export class Spell908 extends RuntimeSpell {
  readonly spellId = 908;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  private playSoundFn?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- moveChild — the spinning particle placed inside `move` ----
    // This corresponds to PlaceObject2_12_1 inside DefineSprite_13_move/frame_1.
    // It has no authored frame textures of its own (it's the SWF's internally
    // placed object); we render it as a container-only clip whose physics are
    // driven entirely by onLoad + onEnterFrame.
    //
    // AS DefineSprite_13_move/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
    //   a = 45;
    //   t = 10 + 3 * _parent._parent.level;
    //   _xscale = t;
    //   _yscale = t;
    //
    // AS DefineSprite_13_move/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = 90 + a * Math.cos(i += 0.5);
    //   a /= 1.1;
    const moveChildSym: SymbolDefinition = {
      name: "moveChild",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: a = 45; t = 10 + 3 * _parent._parent.level;
        // _parent._parent for this clip: moveChild → move → root
        const root = clip.parent?.parent ?? clip.parent;
        const level = (root?.vars.level as number) ?? 1;
        clip.vars.a = 45;
        const t = 10 + 3 * level;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS: _rotation = 90 + a * Math.cos(i += 0.5); a /= 1.1;
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 0.5;
        const rotDeg = 90 + a * Math.cos(i);
        clip.rotation = (rotDeg * Math.PI) / 180;
        a /= 1.1;
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

    // ---- move — 2-frame projectile container ---------------------
    // The harness attaches this at root(0,0) and drives the parabolic arc.
    // frame_1 (index 0): attach the spinning child placed by the authored SWF timeline.
    // The `move` symbol itself has no authored visual frames; the spinner is
    // its only content. We use frames:[] (container-only).
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_13_move/frame_1: PlaceObject2_12_1 placed with
            // its clip events. We replicate this as an explicit attach of the
            // moveChild symbol.
            clip.attach(moveChildSym, "moveChild", 1, ctx);
          },
        ],
      ]),
    };

    // ---- shoot — 84-frame impact animation -----------------------
    // Has authored SVG frame textures (from animations[] "shoot" entry).
    // No lib_ prefix: the manifest has no librarySymbols[] entry for it —
    // "shoot" appears only in animations[], so we use textures.getFrames("shoot").
    //
    // AS DefineSprite_6_shoot/frame_1/DoAction.as:   _rotation = 0;
    // AS DefineSprite_6_shoot/frame_4/DoAction.as:   SOMA.playSound("wab_2005b");
    // AS DefineSprite_6_shoot/frame_70/DoAction.as:  _parent.removeMovieClip(); stop();
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 84,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6_shoot/frame_1/DoAction.as
            // Override the harness-applied velocity-angle rotation so the
            // impact animation plays upright regardless of arc steepness.
            clip.rotation = 0;
          },
        ],
        [
          3,
          () => {
            // AS DefineSprite_6_shoot/frame_4/DoAction.as
            // SOMA.playSound("wab_2005b") — fired at impact frame 4.
            this.playSoundFn?.("wab_2005b");
          },
        ],
        [
          69,
          (clip) => {
            // AS DefineSprite_6_shoot/frame_70/DoAction.as
            // _parent.removeMovieClip(); stop();
            // _parent here is the outer mc (root), so this ends the spell.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(moveChildSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // Capture playSound so frame scripts inside shoot can call it.
    this.playSoundFn = callbacks.playSound;
    // No main-timeline sound or child attaches for this spell —
    // the harness handles attaching `move` for displayType 30,
    // and the impact sound fires from shoot's frame_4 script.
  }
}
