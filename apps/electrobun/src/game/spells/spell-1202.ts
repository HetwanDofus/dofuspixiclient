/**
 * Spell 1202 — Molotov (Pandawa).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1202/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has:
 *   - A `flam` animation (22 frames) used as the rendered content of `move`
 *   - A `shoot` symbol (72-frame composite) that lands at the target,
 *     plays the fire burst, and removes the outer mc at frame 70 → complete().
 *   - Two library symbols driven by clip events:
 *     * `sprite47` (directlyDynamic: true) — a single-frame spinning particle.
 *       onClipEvent(load): seeds `vr = 15 + random(70)`.
 *       onClipEvent(enterFrame): `_rotation += vr; vr *= 0.98`.
 *     * `sprite46` (directlyDynamic: false) — wrapper that hosts sprite47.
 *       Its own onClipEvent(enterFrame) just calls `play()` on itself, ensuring
 *       the child particle keeps advancing. We model this as a frameScripts.set(0)
 *       attach of sprite47, and an onEnterFrame that calls clip.play().
 *
 * Harness (displayType 30): automatically attaches `move` at root (0,0), drives
 * ballistic arc to target, then attaches `shoot` at target on landing and signals
 * signalHit(). We must NOT call signalHit() again ourselves.
 *
 * Library symbols:
 *   - `sprite47` — spinning fire-bottle particle. onLoad seeds vr. onEnterFrame
 *     applies rotation decay.
 *   - `sprite46` — wrapper for sprite47. frame_1 attaches sprite47 at depth 1
 *     with PlaceObject2 matrix offset (2, -0.55). onEnterFrame calls clip.play().
 *   - `move`  — 22-frame container (flam textures). frame_1: play; frame_21: stop.
 *   - `shoot` — 72-frame composite (shoot textures). frame_1: DoAction plays sound
 *     + resets _rotation=0. frame_70: _parent.removeMovieClip → complete().
 *
 * Main timeline: frame_1/DoAction.as is empty — no explicit sound or child attaches
 * at top level. Sound is played inside DefineSprite_39_shoot/frame_1/DoAction.as.
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

// Bounds from manifest.json librarySymbols[]
const SPRITE46_BOUNDS = {
  width: 79.1,
  height: 115.65,
  offsetX: -69.2,
  offsetY: -76.1,
};

const SPRITE47_BOUNDS = {
  width: 79.1,
  height: 115.65,
  offsetX: -67.2,
  offsetY: -76.65,
};

// Bounds from manifest.json animations[]
const FLAM_BOUNDS = {
  width: 146.35,
  height: 210.85,
  offsetX: -13.85,
  offsetY: -178.05,
};

const SHOOT_BOUNDS = {
  width: 174.15,
  height: 162.65,
  offsetX: -85.1,
  offsetY: -119.9,
};

export class Spell1202 extends RuntimeSpell {
  readonly spellId = 1202;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite46Anchor = calculateAnchor(SPRITE46_BOUNDS);
    const sprite47Anchor = calculateAnchor(SPRITE47_BOUNDS);
    const flamAnchor = calculateAnchor(FLAM_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- sprite47 — spinning fire particle (directlyDynamic: true) ----
    // AS scripts/DefineSprite_47/frame_1/PlaceObject2_46_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   vr = 15 + random(70);
    // AS scripts/DefineSprite_47/frame_1/PlaceObject2_46_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _rotation = _rotation + vr;
    //   vr *= 0.98;
    const sprite47Sym: SymbolDefinition = {
      name: "sprite47",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite47"),
      anchorX: sprite47Anchor.x,
      anchorY: sprite47Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_47/frame_1/PlaceObject2_46_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.vr = 15 + Math.floor(Math.random() * 70);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_47/frame_1/PlaceObject2_46_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const vr = clip.vars.vr as number;
        // AS _rotation += vr (degrees) → radians
        clip.rotation += (vr * Math.PI) / 180;
        clip.vars.vr = vr * 0.98;
      },
    };

    // ---- sprite46 — wrapper that hosts sprite47 (directlyDynamic: false) ----
    // AS scripts/DefineSprite_46/frame_1/PlaceObject2_45_2/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   play();
    // The PlaceObject2 placement puts sprite47 at depth 1 inside sprite46, at
    // matrix translate (2, -0.55) per manifest librarySymbols[sprite47].placements[0].
    const sprite46Sym: SymbolDefinition = {
      name: "sprite46",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite46"),
      anchorX: sprite46Anchor.x,
      anchorY: sprite46Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_46/frame_1 — PlaceObject2 places sprite47 at depth 1
            // with matrix { translateX: 2, translateY: -0.55 }
            clip.attach(sprite47Sym, "sprite47_child", 1, ctx, {
              x: 2,
              y: -0.55,
            });
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS DefineSprite_46/frame_1/PlaceObject2_45_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // play() — ensure the clip keeps playing (in case something stopped it)
        clip.play();
      },
    };

    // ---- move — 22-frame container (flam textures) ----------------
    // Harness attaches "move" at root (0,0) and drives it along the arc.
    // AS DefineSprite_10_flam/frame_21/DoAction.as: stop();
    // frame_1 implicitly plays — the flam animation plays through to frame 21
    // then stops (AS frame_21 = 0-based index 20).
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 22,
      frames: textures.getFrames("flam"),
      anchorX: flamAnchor.x,
      anchorY: flamAnchor.y,
      frameScripts: new Map([
        [
          20,
          (clip) => {
            // AS DefineSprite_10_flam/frame_21/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- shoot — 72-frame composite at landing target -------------
    // Harness attaches "shoot" at impact point when move lands.
    // AS DefineSprite_39_shoot/frame_1/DoAction.as: SOMA.playSound("panda_molotov");
    // AS DefineSprite_39_shoot/frame_1/DoAction_2.as: _rotation = 0;
    // AS DefineSprite_39_shoot/frame_70/DoAction.as: _parent.removeMovieClip();
    //
    // Note: frame_1 has two DoAction blocks — both fire at frame index 0.
    // The sound is played here; _rotation = 0 overrides any harness rotation.
    // The shoot animation itself uses pre-rendered composite frames.
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 72,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_39_shoot/frame_1/DoAction.as
            // SOMA.playSound("panda_molotov") — sound is played here inside shoot's
            // frame_1. We capture via the stored callback.
            this.soundCallback?.("panda_molotov");
            // AS DefineSprite_39_shoot/frame_1/DoAction_2.as
            // _rotation = 0 — override any velocity-angle rotation from harness
            clip.rotation = 0;
          },
        ],
        [
          69,
          (clip) => {
            // AS DefineSprite_39_shoot/frame_70/DoAction.as
            // _parent.removeMovieClip() — remove outer mc → spell complete
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite47Sym);
    this.registry.register(sprite46Sym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  // Store sound callback so it can be called from inside shoot's frame_1 script.
  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // Capture callbacks.playSound for use inside shoot's frame_1 frameScript.
    this.soundCallback = callbacks.playSound;
    // frame_1/DoAction.as is empty — no top-level sound or child attach.
    // Sound is played from inside shoot's frame_1 (see shootSym frameScripts[0]).
  }
}
