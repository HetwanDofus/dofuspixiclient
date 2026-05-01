/**
 * Spell 209 — Tremblement de Terre (Sacrieur / Iop earth slam).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/209/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell is a pure impact at the target cell —
 * no projectile, no caster reference, no `move`/`shoot`/`duplicate` symbols.
 * A single authored composite timeline (DefineSprite_11) plays at the target
 * and drives all logic.
 *
 * Library symbols:
 *   - lib_pierres — single-frame stone/pebble particle.
 *       onLoad:  seeds vx, vy, parent scatter (_parent._x/_y), t (scale/life),
 *                alpha, v (vertical velocity), vr (rotation velocity).
 *       onEnterFrame: parent drifts in XY; when t != 1 the inner sprite bounces
 *                     vertically, decaying on landing; when abs(v) < 1 it settles.
 *
 * Main timeline (DefineSprite_11, 174 frames → 0-based index 173):
 *   frame_49  (index 48): SOMA.playSound("grrr1")
 *   frame_55  (index 54): PlaceObject2_8_47 — attach a "pierres group" container at depth 47
 *   frame_64  (index 63): SOMA.playSound("grrr2") + attach 5 more "pierres group" containers
 *                          at depths 7, 15, 23, 31, 39 (each spawns 5 pierres particles on load)
 *   frame_70  (index 69): PlaceObject2_8_55 — attach at depth 55
 *   frame_76  (index 75): PlaceObject2_8_63 — attach at depth 63
 *   frame_124 (index 123): this.end() → signalHit
 *   frame_148 (index 147): install onEnterFrame that fades alpha by 10 per tick
 *   frame_172 (index 171): _parent.removeMovieClip(); stop() → spell complete
 *
 * The "PlaceObject2_8_XX" entries are container clips (character 8 = DefineSprite_8)
 * whose onClipEvent(load) spawns 5 "pierres" particles each. Character 8 has no
 * distinct library entry in librarySymbols[], so we model it as a container-only
 * SymbolDefinition. The canonical AS places multiple instances of DefineSprite_8
 * (character 8) at various depths — each instance independently spawns pierres.
 *
 * The anim1 composite (174 frames) is the rendered backdrop; DefineSprite_11 is the
 * script-driving shell that wraps it and all dynamic children. We model DefineSprite_11
 * as the top-level symbol attached from onSpellStart, carrying all frame scripts.
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

// Bounds from manifest.json librarySymbols[0] (pierres)
const PIERRES_BOUNDS = {
  width: 4.75,
  height: 2.3,
  offsetX: -2.4,
  offsetY: -1.7,
};

// Bounds for anim1 (the composite backdrop, used as the outer DefineSprite_11 shell)
const ANIM1_BOUNDS = {
  width: 84.8,
  height: 82.8,
  offsetX: -44.7,
  offsetY: -39.85,
};

export class Spell209 extends RuntimeSpell {
  readonly spellId = 209;
  readonly displayType = SpellDisplayType.TargetCell;

  // Keep a reference so onSpellStart can attach it
  private sprite11Sym!: SymbolDefinition;

  // Cached sound callback for use inside frame scripts
  private _playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ----------------------------------------------------------------
    // lib_pierres — single-frame stone particle
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // NOTE: In the canonical AS the clipEvent handlers are on the
    // INNER sprite (PlaceObject2_2_1 inside the pierres symbol). The
    // handlers modify both `this` (the inner sprite) AND `_parent`
    // (the pierres container). We model the entire pierres symbol as
    // one SpellClip. The _parent._x/_y scatter from onLoad becomes
    // clip.x/clip.y (the clip IS the pierres instance), and the inner
    // _Y / _rotation / _xscale / _yscale operate on vars we track
    // within the same clip. This faithfully reproduces the net visual
    // result of the canonical two-level AS hierarchy.
    // ----------------------------------------------------------------
    const pierresSym: SymbolDefinition = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,

      onLoad: (clip) => {
        // AS DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        // _parent._x / _parent._y — scatter the pierres container itself
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -10 * Math.random() - 3;
        clip.vars.vr = 40 * (-0.5 + Math.random());
        // Inner sprite Y starts at 0 (tracks vertical bounce)
        clip.vars.innerY = 0;
        clip.vars.innerRot = 0;
      },

      onEnterFrame: (clip) => {
        // AS DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;

        // _parent._x += vx; _parent._y += vy  (drift the container)
        clip.x += vx;
        clip.y += vy;

        const t = clip.vars.t as number;
        if (t !== 1) {
          let innerY = clip.vars.innerY as number;
          let innerRot = clip.vars.innerRot as number;
          let v = clip.vars.v as number;
          let vxLocal = clip.vars.vx as number;
          let vyLocal = clip.vars.vy as number;
          const vr = clip.vars.vr as number;

          // _Y = _Y + v
          innerY += v;
          // _rotation = _rotation + vr  (degrees → radians delta)
          innerRot += (vr * Math.PI) / 180;
          // v += 0.5  (gravity)
          v += 0.5;

          if (innerY > 0) {
            // Landed: bounce & settle
            vxLocal /= 2;
            vyLocal /= 2;
            innerRot = 0;
            innerY = 0;
            v = (-v) / 4;

            if (Math.abs(v) < 1) {
              vxLocal = 0;
              vyLocal = 0;
              clip.vars.t = 1;
            }

            clip.vars.vx = vxLocal;
            clip.vars.vy = vyLocal;
          }

          clip.vars.innerY = innerY;
          clip.vars.innerRot = innerRot;
          clip.vars.v = v;

          // Apply inner rotation to the visible sprite
          clip.rotation = innerRot;
        }
      },
    };

    // ----------------------------------------------------------------
    // "pierresGroup" — container-only symbol (DefineSprite_8 in the SWF).
    // Each placement in the canonical AS places a DefineSprite_8 instance
    // whose onClipEvent(load) loops: while(c < 5) attachMovie("pierres","pierres"+c, c)
    //
    // We model this as a container with a frameScripts[0] that attaches
    // 5 pierres children. Each pierresGroup instance is independent.
    //
    // AS: DefineSprite_11/frame_64/PlaceObject2_8_7/CLIPACTIONRECORD onClipEvent(load).as
    //     (and the 7 other identical PlaceObject2_8_XX load scripts)
    // ----------------------------------------------------------------
    const pierresGroupSym: SymbolDefinition = {
      name: "pierresGroup",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      onLoad: (clip, ctx) => {
        // AS: while(c < 5) { this.attachMovie("pierres","pierres"+c, c); c++; }
        for (let c = 0; c < 5; c++) {
          clip.attach(pierresSym, `pierres${c}`, c, ctx);
        }
      },
    };

    // ----------------------------------------------------------------
    // DefineSprite_11 — the main scripted shell (174 frames).
    // Wraps the anim1 composite backdrop and all dynamic children.
    //
    // frame_49  (index 48): SOMA.playSound("grrr1")
    // frame_55  (index 54): attach pierresGroup at depth 47
    // frame_64  (index 63): SOMA.playSound("grrr2") + attach 5× pierresGroup
    //                        at depths 7, 15, 23, 31, 39
    // frame_70  (index 69): attach pierresGroup at depth 55
    // frame_76  (index 75): attach pierresGroup at depth 63
    // frame_124 (index 123): this.end() → signalHit
    // frame_148 (index 147): install per-frame alpha fade
    // frame_172 (index 171): _parent.removeMovieClip(); stop() → complete
    // ----------------------------------------------------------------
    const sprite11Sym: SymbolDefinition = {
      name: "sprite11",
      totalFrames: 174,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      frameScripts: new Map([
        [
          48,
          (_clip) => {
            // AS: DefineSprite_11/frame_49/DoAction.as — SOMA.playSound("grrr1")
            this._playSound?.("grrr1");
          },
        ],
        [
          54,
          (clip, ctx) => {
            // AS: DefineSprite_11/frame_55/PlaceObject2_8_47/CLIPACTIONRECORD onClipEvent(load).as
            // Place one pierresGroup container at depth 47
            clip.attach(pierresGroupSym, "pierresGroup47", 47, ctx);
          },
        ],
        [
          63,
          (clip, ctx) => {
            // AS: DefineSprite_11/frame_64/DoAction.as — SOMA.playSound("grrr2")
            // AS: PlaceObject2_8_7, _8_15, _8_23, _8_31, _8_39 — each with identical onLoad
            this._playSound?.("grrr2");
            clip.attach(pierresGroupSym, "pierresGroup7", 7, ctx);
            clip.attach(pierresGroupSym, "pierresGroup15", 15, ctx);
            clip.attach(pierresGroupSym, "pierresGroup23", 23, ctx);
            clip.attach(pierresGroupSym, "pierresGroup31", 31, ctx);
            clip.attach(pierresGroupSym, "pierresGroup39", 39, ctx);
          },
        ],
        [
          69,
          (clip, ctx) => {
            // AS: DefineSprite_11/frame_70/PlaceObject2_8_55/CLIPACTIONRECORD onClipEvent(load).as
            clip.attach(pierresGroupSym, "pierresGroup55", 55, ctx);
          },
        ],
        [
          75,
          (clip, ctx) => {
            // AS: DefineSprite_11/frame_76/PlaceObject2_8_63/CLIPACTIONRECORD onClipEvent(load).as
            clip.attach(pierresGroupSym, "pierresGroup63", 63, ctx);
          },
        ],
        [
          123,
          (_clip) => {
            // AS: DefineSprite_11/frame_124/DoAction.as — this.end() → damage popup
            this.runtime.signalHit();
          },
        ],
        [
          147,
          (clip) => {
            // AS: DefineSprite_11/frame_148/DoAction.as
            // this.onEnterFrame = function() { _alpha = _alpha - 10; };
            // Install a per-tick alpha fade on the sprite11 clip itself.
            clip.onEnterFrame = (self) => {
              self.alpha = Math.max(0, self.alpha - 10 / 100);
            };
          },
        ],
        [
          171,
          (clip) => {
            // AS: DefineSprite_11/frame_172/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.sprite11Sym = sprite11Sym;

    this.registry.register(pierresSym);
    this.registry.register(pierresGroupSym);
    this.registry.register(sprite11Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Cache the sound callback so frame scripts can use it
    this._playSound = callbacks.playSound;

    // Attach the main scripted shell at root depth 1.
    // The harness has already positioned root at target cell (displayType=11).
    this.root.attach(this.sprite11Sym, "sprite11", 1, context);
  }
}
