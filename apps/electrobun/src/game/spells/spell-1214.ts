/**
 * Spell 1214 — Pandawa attack/static spell.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1214/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no `move`/`shoot`/`duplicate`
 * symbols and no caster-reference logic. It places a `staticR` animation
 * at or near the target cell (via onClipEvent(load) positioning in the
 * main timeline). The main timeline has a frame_13 that calls `this.end()`
 * (signalHit), and a frame_172 that calls `stop(); this.removeMovieClip()`
 * (complete). The `staticR` symbol (DefineSprite_192_staticR) is the primary
 * visual: a 201-frame composite with randomised scale/flip on frame_1,
 * a sound on frame_4, a looping/stop decision on frame_58 with a child that
 * fades after 44 frames.
 *
 * The main timeline places `staticR` instances at different offsets on
 * frames 4, 10, and 19 with varying `d` offsets and depth swaps based on
 * `_parent.angle`. We model each as an attach in `onSpellStart` (frame 1)
 * with onLoad positioning, since the main timeline fires them as clip events
 * on placed instances.
 *
 * Library symbols:
 *   - staticR (DefineSprite_192_staticR, 201 frames) — the main composite
 *     lightning/static visual. frame_1 randomises scale (80-100%) and
 *     optionally flips X. frame_4 plays "impact_lourd". frame_58 has a
 *     random stop and a fading child whose alpha decrements after 44 frames.
 *
 * Animations in manifest (no librarySymbols[] entries — all symbols appear
 * only in animations[]):
 *   - "staticR"  — the main static animation (201 frames)
 *   - "16_67"    — 15-frame sub-animation
 *   - "16_45"    — 15-frame sub-animation
 *
 * Main timeline:
 *   - frame_4:   place staticR instance at cellTo (depth 10)
 *   - frame_10:  place staticR instance at cellTo + offset d=27
 *   - frame_13:  this.end() → signalHit
 *   - frame_19:  place staticR instance at cellTo + offset d=53
 *   - frame_172: stop(); this.removeMovieClip() → complete
 *
 * Sounds: "pandit_spell", "death_fall", "pandit_death", "hit_defaut",
 *         "impact_lourd", "pandit_attak", "ouginac_epee", "pandit_fire"
 *
 * GAC.applyAnim / GAC.applyEnd calls inside the DefineSprite_* scripts are
 * character-animation controller calls that operate on the fighter sprite
 * (not on spell visuals). They are no-ops in the spell runtime context and
 * are omitted. Similarly, swapDepths() on the placed instances is handled
 * by the depth parameter we pass to attach().
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

// Bounds from manifest animations[] — "staticR" entry (no lib_ prefix, not in librarySymbols)
const STATIC_R_BOUNDS = {
  width: 56.3,
  height: 138,
  offsetX: -28.2,
  offsetY: -123.8,
};

export class Spell1214 extends RuntimeSpell {
  readonly spellId = 1214;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold a reference to the symbol so onSpellStart can attach it
  private staticRSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const staticRAnchor = calculateAnchor(STATIC_R_BOUNDS);

    // ---- staticR — main 201-frame lightning/static composite ----
    // No librarySymbols[] entry in manifest — texture key is "staticR" (bare name).
    //
    // AS DefineSprite_192_staticR/frame_1/DoAction.as:
    //   ta = 80 + random(20);
    //   _xscale = ta; _yscale = ta;
    //   if (random(2) == 1) { _xscale = -_xscale; }
    //
    // AS DefineSprite_192_staticR/frame_4/DoAction.as:
    //   SOMA.playSound("impact_lourd");
    //
    // AS DefineSprite_192_staticR/frame_58/DoAction.as:
    //   if (random(50) != 1) { stop(); }
    //
    // AS DefineSprite_192_staticR/frame_58/PlaceObject2_184_137/onClipEvent(load):
    //   c = 0;
    // AS DefineSprite_192_staticR/frame_58/PlaceObject2_184_137/onClipEvent(enterFrame):
    //   if (c++ > 44) { _parent._alpha -= 3.34; }
    //
    // The child clip placed at frame_58 (PlaceObject2_184_137) is an internal
    // authored child of the staticR sprite. Since the runtime treats staticR
    // as a single animated sprite (frames[] drives its texture), we model the
    // fade-out behaviour by attaching a virtual "fade" child at frame 58 that
    // decrements alpha on the parent staticR clip.

    // Define a lightweight "fade" symbol for the internal fade-out child
    const fadeSym: SymbolDefinition = {
      name: "_internal_fade",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      // AS frame_58/PlaceObject2_184_137/onClipEvent(load): c = 0
      onLoad: (clip) => {
        clip.vars.c = 0;
      },
      // AS frame_58/PlaceObject2_184_137/onClipEvent(enterFrame):
      //   if (c++ > 44) { _parent._alpha -= 3.34; }
      onEnterFrame: (clip) => {
        const c = clip.vars.c as number;
        clip.vars.c = c + 1;
        if (c > 44) {
          const parent = clip.parent;
          if (parent) {
            parent.alpha = Math.max(0, parent.alpha - 3.34 / 100);
          }
        }
      },
    };

    // Capture playSound for use inside frameScripts
    let playSoundFn: ((id: string) => void) | undefined;

    this.staticRSym = {
      name: "staticR",
      totalFrames: 201,
      frames: textures.getFrames("staticR"),
      anchorX: staticRAnchor.x,
      anchorY: staticRAnchor.y,

      // AS DefineSprite_192_staticR/frame_1/DoAction.as
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // ta = 80 + random(20); _xscale = ta; _yscale = ta;
            // if (random(2) == 1) { _xscale = -_xscale; }
            const ta = 80 + Math.floor(Math.random() * 20);
            clip.scaleX = ta / 100;
            clip.scaleY = ta / 100;
            if (Math.floor(Math.random() * 2) === 1) {
              clip.scaleX = -clip.scaleX;
            }
          },
        ],
        [
          3,
          // AS DefineSprite_192_staticR/frame_4/DoAction.as
          (_clip) => {
            playSoundFn?.("impact_lourd");
          },
        ],
        [
          57,
          // AS DefineSprite_192_staticR/frame_58/DoAction.as
          // if (random(50) != 1) { stop(); }
          // Also attach the internal fade child (PlaceObject2_184_137)
          (clip, ctx) => {
            if (Math.floor(Math.random() * 50) !== 1) {
              clip.stop();
            }
            // Attach the fade child (models the PlaceObject2_184_137 clip event)
            if (!clip.children.has("_fade")) {
              clip.attach(fadeSym, "_fade", 184, ctx);
            }
          },
        ],
      ]),
    };

    // Expose playSoundFn setter so onSpellStart can wire it in
    this._playSoundSetter = (fn: (id: string) => void) => {
      playSoundFn = fn;
    };

    // Register symbols (fade is internal, no need to register separately
    // since it is only ever attached by staticR's frame_58 script)
    this.registry.register(this.staticRSym);
  }

  // Internal setter used to wire playSound into frameScripts closure
  private _playSoundSetter?: (fn: (id: string) => void) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Wire the sound callback into the staticR frameScripts closure
    this._playSoundSetter?.(callbacks.playSound);

    // Main timeline sounds (frame 1 implied by playSound calls across
    // multiple child sprites — the top-level sounds at frame 0 in manifest
    // are "pandit_spell", "death_fall", "pandit_death")
    callbacks.playSound("pandit_spell");
    callbacks.playSound("death_fall");
    callbacks.playSound("pandit_death");

    // ---- frame_4: place first staticR at cellTo (depth 10) ------
    // AS frame_4/PlaceObject2_192_staticR_1/onClipEvent(load):
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    //   this.swapDepths(10);
    // For displayType=11 (TargetCell), root is already anchored at cellTo,
    // so the local offset is (0, 0).
    this.root.attach(this.staticRSym, "staticR1", 10, context, {
      x: 0,
      y: 0,
    });

    // ---- frame_10: place second staticR at cellTo + offset d=27 -
    // AS frame_10/PlaceObject2_192_staticR_139/onClipEvent(load):
    //   d = 27;
    //   if (_parent.angle < 0) { swapDepths(5); dy = -d/2; }
    //   else { swapDepths(15); dy = d/2; }
    //   if (Math.abs(_parent.angle) > 90) { dx = -d; } else { dx = d; }
    //   _X = _parent.cellTo.x + dx; _Y = _parent.cellTo.y + dy;
    // Since root is at cellTo (TargetCell), local position = (dx, dy).
    {
      const d = 27;
      const angleDeg = context.angle; // degrees, stored on context
      const dy = angleDeg < 0 ? -d / 2 : d / 2;
      const dx = Math.abs(angleDeg) > 90 ? -d : d;
      const depth2 = angleDeg < 0 ? 5 : 15;
      this.root.attach(this.staticRSym, "staticR2", depth2, context, {
        x: dx,
        y: dy,
      });
    }

    // ---- frame_19: place third staticR at cellTo + offset d=53 --
    // AS frame_19/PlaceObject2_192_staticR_277/onClipEvent(load):
    //   d = 53;
    //   if (_parent.angle < 0) { swapDepths(5); dy = -d/2; }
    //   else { swapDepths(15); dy = d/2; }
    //   if (Math.abs(_parent.angle) > 90) { dx = -d; } else { dx = d; }
    //   _X = _parent.cellTo.x + dx; _Y = _parent.cellTo.y + dy;
    {
      const d = 53;
      const angleDeg = context.angle;
      const dy = angleDeg < 0 ? -d / 2 : d / 2;
      const dx = Math.abs(angleDeg) > 90 ? -d : d;
      const depth3 = angleDeg < 0 ? 5 : 15;
      this.root.attach(this.staticRSym, "staticR3", depth3, context, {
        x: dx,
        y: dy,
      });
    }

    // ---- frame_13: this.end() → signalHit -----------------------
    // We model the main-timeline frame_13 script as a frame script on
    // the root. Since the root SpellClip starts ticking after onSpellStart,
    // we set its onEnterFrame to a one-shot counter that fires at frame 13.
    // However, the cleanest approach is to register a root-level frameScript
    // via a dedicated wrapper symbol on the root. Instead, we use the root's
    // vars to track the main timeline frame, driven by onEnterFrame.
    //
    // AS frame_13/DoAction.as: this.end();
    // AS frame_172/DoAction.as: stop(); this.removeMovieClip();
    this.root.vars._mainFrame = 0;
    this.root.onEnterFrame = (_clip) => {
      const mf = (this.root.vars._mainFrame as number) + 1;
      this.root.vars._mainFrame = mf;

      if (mf === 13) {
        // AS frame_13/DoAction.as: this.end() → signalHit
        this.runtime.signalHit();
      }

      if (mf === 172) {
        // AS frame_172/DoAction.as: stop(); this.removeMovieClip();
        this.root.onEnterFrame = null;
        this.runtime.complete();
      }
    };
  }
}
