/**
 * Spell 1212 — Souillure (Pandawa).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1212/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile, no caster reference, no
 * `move`/`shoot`/`duplicate` symbols — single impact animation anchored at
 * the target cell.
 *
 * Canonical AS layout:
 *   - main timeline frame_1/DoAction.as: SOMA.playSound("panda_souillure")
 *     — no explicit child attaches, no stop(); the single `anim1` animation
 *     runs as the root timeline.
 *
 *   - DefineSprite_17 (= the outer "anim1" container, 186 frames total):
 *       frame_118/DoAction.as: installs onEnterFrame that decrements _alpha
 *                              by 1.67 each frame (fade-out phase).
 *       frame_178/DoAction.as: _parent.removeMovieClip(); stop() — signals
 *                              completion.
 *
 *   - DefineSprite_16 (= ink-splat / puff particle, attached inside anim1):
 *       PlaceObject2_12_1/onClipEvent(load): seeds _alpha [30,70),
 *                              _rotation random [0,360), t [30,110), vt=1.
 *       PlaceObject2_12_1/onClipEvent(enterFrame): applies t as scale,
 *                              increments t by vt, vt *= 0.98.
 *
 *   - DefineSprite_15 (= smaller ink particle, attached inside anim1):
 *       frame_1/DoAction.as: seeds _alpha [30,70), _rotation, t [20,80),
 *                            _xscale/_yscale = t.
 *       frame_19/DoAction.as: stop().
 *
 *   - DefineSprite_8 (= tiny drift particle, attached inside anim1):
 *       frame_1/DoAction.as: reads its own _X/_Y to derive vx/vy; seeds
 *                            scale and alpha; jumps to a random frame;
 *                            installs onEnterFrame drift with 0.98 friction.
 *
 * All child-spawning against anim1 is driven by its authored composite
 * timeline (the `isComposite: true` flag in the manifest). The runtime
 * registers DefineSprite_16, DefineSprite_15, and DefineSprite_8 as library
 * symbols; the main anim1 symbol hosts the outer timeline frame scripts
 * (frame_118 fade start and frame_178 removal/completion).
 *
 * signalHit is fired at frame_1 of the anim1 timeline (the canonical
 * impact moment for a TargetCell spell with no explicit "hit" frame).
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

// Bounds from manifest animations[0] (anim1) — used as the outer symbol.
const ANIM1_BOUNDS = {
  width: 145.5,
  height: 161.1,
  offsetX: -60.6,
  offsetY: -141.45,
};

// DefineSprite_16 has no separate librarySymbols entry in this manifest;
// it is embedded inside the composite anim1. We treat it as an inline
// container-only symbol whose per-instance clip events we wire up.
// Bounds are approximated at centre-anchor since no manifest entry exists.
const DS16_BOUNDS = { width: 1, height: 1, offsetX: -0.5, offsetY: -0.5 };

// DefineSprite_15 — same situation.
const DS15_BOUNDS = { width: 1, height: 1, offsetX: -0.5, offsetY: -0.5 };

// DefineSprite_8 — same situation.
const DS8_BOUNDS = { width: 1, height: 1, offsetX: -0.5, offsetY: -0.5 };

export class Spell1212 extends RuntimeSpell {
  readonly spellId = 1212;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ---- DefineSprite_8 — tiny drift particle --------------------
    // Canonical: scripts/DefineSprite_8/frame_1/DoAction.as
    // The particle reads its own _X/_Y at spawn time to derive velocity,
    // then drifts with 0.98 friction. The caller is expected to position
    // the clip before attaching so vx/vy carry meaningful values.
    const ds8Anchor = calculateAnchor(DS8_BOUNDS);
    const ds8Sym: SymbolDefinition = {
      name: "DefineSprite_8",
      totalFrames: 1,
      frames: [],
      anchorX: ds8Anchor.x,
      anchorY: ds8Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_8/frame_1/DoAction.as
            clip.vars.vx = clip.x / 25;
            clip.vars.vy = clip.y / 25;
            const t = 50 + Math.floor(Math.random() * 50);
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.alpha = (70 + Math.floor(Math.random() * 30)) / 100;
            // gotoAndStop(random(_totalframes - 1) + 2)
            // totalFrames = 1, so random(0)+2 = 2, but frame index is
            // clamped by the runtime. We stay on frame 0 (only frame).
            clip.gotoAndStop(
              Math.floor(Math.random() * (clip.totalFrames - 1)) + 1,
            );
            clip.onEnterFrame = (c) => {
              // AS DefineSprite_8/frame_1/DoAction.as — onEnterFrame
              const vx = c.vars.vx as number;
              const vy = c.vars.vy as number;
              c.x += vx;
              c.y += vy;
              c.vars.vx = vx * 0.98;
              c.vars.vy = vy * 0.98;
            };
          },
        ],
      ]),
    };

    // ---- DefineSprite_15 — small ink particle --------------------
    // Canonical: scripts/DefineSprite_15/frame_1/DoAction.as
    //            scripts/DefineSprite_15/frame_19/DoAction.as
    const ds15Anchor = calculateAnchor(DS15_BOUNDS);
    const ds15Sym: SymbolDefinition = {
      name: "DefineSprite_15",
      totalFrames: 19,
      frames: [],
      anchorX: ds15Anchor.x,
      anchorY: ds15Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_15/frame_1/DoAction.as
            clip.alpha = (30 + Math.floor(Math.random() * 40)) / 100;
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            const t = 20 + Math.floor(Math.random() * 60);
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
          },
        ],
        [
          18,
          (clip) => {
            // AS DefineSprite_15/frame_19/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_16 — ink-splat / puff particle -------------
    // Canonical: scripts/DefineSprite_16/frame_1/PlaceObject2_12_1/
    //            CLIPACTIONRECORD onClipEvent(load).as
    //            CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // The child placed at depth 1 inside DefineSprite_16 carries the
    // clip events. We model this as onLoad + onEnterFrame on the symbol
    // itself (the inner PlaceObject2 child inherits the same clip scope
    // in canonical AS; collapsing one level is safe here because
    // DefineSprite_16 has no other authored content).
    const ds16Anchor = calculateAnchor(DS16_BOUNDS);
    const ds16Sym: SymbolDefinition = {
      name: "DefineSprite_16",
      totalFrames: 1,
      frames: [],
      anchorX: ds16Anchor.x,
      anchorY: ds16Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_16/frame_1/PlaceObject2_12_1/onClipEvent(load)
        clip.alpha = (30 + Math.floor(Math.random() * 40)) / 100;
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        const t = 30 + Math.floor(Math.random() * 80);
        clip.vars.t = t;
        clip.vars.vt = 1;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_16/frame_1/PlaceObject2_12_1/onClipEvent(enterFrame)
        const t = clip.vars.t as number;
        let vt = clip.vars.vt as number;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.t = t + vt;
        vt *= 0.98;
        clip.vars.vt = vt;
      },
    };

    // ---- DefineSprite_17 / anim1 — outer 186-frame timeline ------
    // Canonical: scripts/DefineSprite_17/frame_118/DoAction.as
    //            scripts/DefineSprite_17/frame_178/DoAction.as
    //
    // This is the main animated content (the `anim1` animation in the
    // manifest). The composite asset drives visual frames [0..185];
    // we layer frame scripts on top for the fade and removal.
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    const anim1Frames = textures.getFrames("anim1");
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 186,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // frame_1 — canonical impact moment for TargetCell spell.
            // Signal hit so the combat sequencer can show damage numbers.
            this.runtime.signalHit();
          },
        ],
        [
          117,
          (clip) => {
            // AS DefineSprite_17/frame_118/DoAction.as
            // Install per-frame fade: _alpha -= 1.67 each frame.
            clip.onEnterFrame = (c) => {
              c.alpha = Math.max(0, c.alpha - 1.67 / 100);
            };
          },
        ],
        [
          177,
          (clip) => {
            // AS DefineSprite_17/frame_178/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(ds8Sym);
    this.registry.register(ds15Sym);
    this.registry.register(ds16Sym);
    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("panda_souillure");
    callbacks.playSound("panda_souillure");

    // The main-timeline implicitly places the anim1 composite on frame_1.
    // Attach it to the root so the runtime drives its timeline from tick 1.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
