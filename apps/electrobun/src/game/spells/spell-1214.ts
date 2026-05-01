/**
 * Spell 1214 — Pandawa Attack (Pandawa class spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 *
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1214/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main timeline places the
 * `staticR` composite animation (DefineSprite_192_staticR) three times
 * at different frames, each time positioning the instance at
 * `_parent.cellTo` with an angle-based offset. This world-coord
 * anchoring pattern maps to WorldAbsolute (container at 0,0; children
 * position themselves using root.vars.cellTo + root.vars.angle).
 *
 * Three main-timeline staticR placements, each with onClipEvent(load):
 *   frame_4  (index 3):  staticR_1   at cellTo, depth 10 (no angle offset)
 *   frame_10 (index 9):  staticR_139 at cellTo + dx/dy with d=27
 *   frame_19 (index 18): staticR_277 at cellTo + dx/dy with d=53
 *
 * The main timeline ends at frame_172 which calls stop() + removeMovieClip().
 * Main timeline frame_13: this.end() → signalHit.
 *
 * DefineSprite_192_staticR (201 frames):
 *   frame_1:  randomize scale [80,100]%, possibly flip X
 *   frame_4:  play sound "impact_lourd"
 *   frame_58: 49/50 chance to stop; child clip (PlaceObject2_184_137)
 *             counts 44 frames then fades alpha by 3.34/frame
 *
 * The PlaceObject2_184_137 child at frame_58 is modeled as a sub-symbol
 * "staticR_fadeChild" with onLoad (seeds c=0) and onEnterFrame (fades
 * parent alpha after 44 frames).
 *
 * Library symbols:
 *   - staticR          — 201-frame composite. frame_1 scale/flip; frame_4 sound;
 *                        frame_58 stops and attaches fadeChild.
 *   - staticR_fadeChild — behavioral child placed at frame_58. onLoad seeds c=0.
 *                         onEnterFrame: if(c++ > 44) _parent._alpha -= 3.34.
 *   - staticR_at_1     — wrapper for placement at frame_4: onLoad positions at cellTo.
 *   - staticR_at_139   — wrapper for placement at frame_10: onLoad positions with d=27.
 *   - staticR_at_277   — wrapper for placement at frame_19: onLoad positions with d=53.
 *
 * (The various DefineSprite_160/158/166/168/150/152/etc. symbols are internal
 * character animation sprites with GAC.applyAnim/GAC.applyEnd calls —
 * fighter-state management baked into the composite staticR frames, not
 * library symbols the spell attaches via attachMovie.)
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

// Bounds from manifest animations[] entry for "staticR"
const STATIC_R_BOUNDS = {
  width: 56.3,
  height: 138,
  offsetX: -28.2,
  offsetY: -123.8,
};

export class Spell1214 extends RuntimeSpell {
  readonly spellId = 1214;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  // Hold references so onSpellStart can attach them
  private staticRSym!: SymbolDefinition;
  private staticRAt1Sym!: SymbolDefinition;
  private staticRAt139Sym!: SymbolDefinition;
  private staticRAt277Sym!: SymbolDefinition;

  // Hold sound callback for use inside frameScripts
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const staticRAnchor = calculateAnchor(STATIC_R_BOUNDS);
    const self = this;

    // ---- staticR_fadeChild — behavioral fade child ---------------
    // Placed inside DefineSprite_192_staticR at frame_58.
    //
    // AS DefineSprite_192_staticR/frame_58/PlaceObject2_184_137/
    //   CLIPACTIONRECORD onClipEvent(load).as:
    //   c = 0;
    //
    // AS DefineSprite_192_staticR/frame_58/PlaceObject2_184_137/
    //   CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   if(c++ > 44) { _parent._alpha -= 3.34; }
    const fadeChildSym: SymbolDefinition = {
      name: "staticR_fadeChild",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      onLoad: (clip) => {
        // AS DefineSprite_192_staticR/frame_58/PlaceObject2_184_137/
        //   CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.c = 0;
      },

      onEnterFrame: (clip) => {
        // AS DefineSprite_192_staticR/frame_58/PlaceObject2_184_137/
        //   CLIPACTIONRECORD onClipEvent(enterFrame).as
        const c = clip.vars.c as number;
        clip.vars.c = c + 1;
        if (c > 44) {
          const parent = clip.parent;
          if (parent) {
            // AS: _parent._alpha -= 3.34  (Flash 0-100 → TS 0-1)
            parent.alpha = Math.max(0, parent.alpha - 3.34 / 100);
          }
        }
      },
    };

    // ---- staticR (DefineSprite_192_staticR) ----------------------
    // 201-frame composite animation. Shared definition used by all
    // three placements (each placement wrapper delegates to this).
    //
    // AS DefineSprite_192_staticR/frame_1/DoAction.as:
    //   ta = 80 + random(20);
    //   _xscale = ta; _yscale = ta;
    //   if(random(2) == 1) { _xscale = -_xscale; }
    //
    // AS DefineSprite_192_staticR/frame_4/DoAction.as:
    //   SOMA.playSound("impact_lourd");
    //
    // AS DefineSprite_192_staticR/frame_58/DoAction.as:
    //   if(random(50) != 1) { stop(); }
    //   [also places PlaceObject2_184_137 → attach fadeChildSym]
    this.staticRSym = {
      name: "staticR",
      totalFrames: 201,
      frames: textures.getFrames("staticR"),
      anchorX: staticRAnchor.x,
      anchorY: staticRAnchor.y,

      frameScripts: new Map([
        [
          // AS DefineSprite_192_staticR/frame_1/DoAction.as
          0,
          (clip) => {
            const ta = 80 + Math.floor(Math.random() * 20);
            clip.scaleX = ta / 100;
            clip.scaleY = ta / 100;
            if (Math.floor(Math.random() * 2) === 1) {
              clip.scaleX = -(ta / 100);
            }
          },
        ],
        [
          // AS DefineSprite_192_staticR/frame_4/DoAction.as
          3,
          (_clip) => {
            self.soundCallback?.("impact_lourd");
          },
        ],
        [
          // AS DefineSprite_192_staticR/frame_58/DoAction.as
          57,
          (clip, ctx) => {
            // Place the fade child (PlaceObject2_184_137) — its onLoad
            // and onEnterFrame drive the alpha decay on this clip.
            clip.attach(fadeChildSym, "fadeChild", 137, ctx);
            // 49/50 chance to stop the staticR timeline here.
            if (Math.floor(Math.random() * 50) !== 1) {
              clip.stop();
            }
          },
        ],
      ]),
    };

    // ---- Placement wrappers — one per main-timeline PlaceObject2 --
    // Each placement has a distinct onClipEvent(load) that positions
    // the staticR content clip in world coords using _parent.cellTo
    // and _parent.angle. We model each as a thin wrapper symbol whose
    // onLoad fires the positioning logic, then its frame_1 attaches
    // the actual staticR content as a child.

    // -- staticR_at_1 (frame_4 placement, d=0, depth=10) ----------
    // AS scripts/frame_4/PlaceObject2_192_staticR_1/
    //   CLIPACTIONRECORD onClipEvent(load).as:
    //   _X = _parent.cellTo.x;
    //   _Y = _parent.cellTo.y;
    //   this.swapDepths(10);
    this.staticRAt1Sym = {
      name: "staticR_at_1",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      onLoad: (clip) => {
        // AS scripts/frame_4/PlaceObject2_192_staticR_1/
        //   CLIPACTIONRECORD onClipEvent(load).as
        const root = clip.parent;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
        if (cellTo) {
          clip.x = cellTo.x;
          clip.y = cellTo.y;
        }
        // swapDepths(10) is handled by the depth param in attach()
      },

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            clip.attach(self.staticRSym, "staticR", 1, ctx);
          },
        ],
      ]),
    };

    // -- staticR_at_139 (frame_10 placement, d=27) -----------------
    // AS scripts/frame_10/PlaceObject2_192_staticR_139/
    //   CLIPACTIONRECORD onClipEvent(load).as:
    //   d = 27;
    //   if(_parent.angle < 0) { swapDepths(5); dy = -d/2; }
    //   else                  { swapDepths(15); dy = d/2; }
    //   if(Math.abs(_parent.angle) > 90) { dx = -d; } else { dx = d; }
    //   _X = _parent.cellTo.x + dx;
    //   _Y = _parent.cellTo.y + dy;
    this.staticRAt139Sym = {
      name: "staticR_at_139",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      onLoad: (clip) => {
        // AS scripts/frame_10/PlaceObject2_192_staticR_139/
        //   CLIPACTIONRECORD onClipEvent(load).as
        const root = clip.parent;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        const d = 27;
        let dx: number;
        let dy: number;

        if (angleDeg < 0) {
          dy = -d / 2;
        } else {
          dy = d / 2;
        }

        if (Math.abs(angleDeg) > 90) {
          dx = -d;
        } else {
          dx = d;
        }

        if (cellTo) {
          clip.x = cellTo.x + dx;
          clip.y = cellTo.y + dy;
        }
        // swapDepths(5 or 15) handled by caller depth param
      },

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            clip.attach(self.staticRSym, "staticR", 1, ctx);
          },
        ],
      ]),
    };

    // -- staticR_at_277 (frame_19 placement, d=53) -----------------
    // AS scripts/frame_19/PlaceObject2_192_staticR_277/
    //   CLIPACTIONRECORD onClipEvent(load).as:
    //   d = 53;
    //   if(_parent.angle < 0) { swapDepths(5); dy = -d/2; }
    //   else                  { swapDepths(15); dy = d/2; }
    //   if(Math.abs(_parent.angle) > 90) { dx = -d; } else { dx = d; }
    //   _X = _parent.cellTo.x + dx;
    //   _Y = _parent.cellTo.y + dy;
    this.staticRAt277Sym = {
      name: "staticR_at_277",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      onLoad: (clip) => {
        // AS scripts/frame_19/PlaceObject2_192_staticR_277/
        //   CLIPACTIONRECORD onClipEvent(load).as
        const root = clip.parent;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        const d = 53;
        let dx: number;
        let dy: number;

        if (angleDeg < 0) {
          dy = -d / 2;
        } else {
          dy = d / 2;
        }

        if (Math.abs(angleDeg) > 90) {
          dx = -d;
        } else {
          dx = d;
        }

        if (cellTo) {
          clip.x = cellTo.x + dx;
          clip.y = cellTo.y + dy;
        }
        // swapDepths(5 or 15) handled by caller depth param
      },

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            clip.attach(self.staticRSym, "staticR", 1, ctx);
          },
        ],
      ]),
    };

    this.registry.register(fadeChildSym);
    this.registry.register(this.staticRSym);
    this.registry.register(this.staticRAt1Sym);
    this.registry.register(this.staticRAt139Sym);
    this.registry.register(this.staticRAt277Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use inside frameScripts
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_1 sounds (manifest sounds[] at frame 0)
    callbacks.playSound("pandit_spell");
    callbacks.playSound("death_fall");
    callbacks.playSound("pandit_death");

    // Determine depth for angle-offset placements (mirrors swapDepths
    // logic from the onClipEvent(load) scripts — we pick the depth
    // before attaching so the attach() call uses the right zIndex).
    const angleDeg = context.angle;
    const angleOffsetDepth = angleDeg < 0 ? 5 : 15;

    // ----------------------------------------------------------------
    // frame_4 (index 3): PlaceObject2_192_staticR_1
    // AS scripts/frame_4/PlaceObject2_192_staticR_1/
    //   CLIPACTIONRECORD onClipEvent(load).as — ports to onLoad above.
    // ----------------------------------------------------------------
    this.root.attach(
      this.staticRAt1Sym,
      "staticR_wrapper_1",
      10,
      context,
    );

    // ----------------------------------------------------------------
    // frame_10 (index 9): PlaceObject2_192_staticR_139
    // AS scripts/frame_10/PlaceObject2_192_staticR_139/
    //   CLIPACTIONRECORD onClipEvent(load).as — ports to onLoad above.
    // ----------------------------------------------------------------
    this.root.attach(
      this.staticRAt139Sym,
      "staticR_wrapper_139",
      angleOffsetDepth,
      context,
    );

    // ----------------------------------------------------------------
    // frame_19 (index 18): PlaceObject2_192_staticR_277
    // AS scripts/frame_19/PlaceObject2_192_staticR_277/
    //   CLIPACTIONRECORD onClipEvent(load).as — ports to onLoad above.
    // ----------------------------------------------------------------
    this.root.attach(
      this.staticRAt277Sym,
      "staticR_wrapper_277",
      angleOffsetDepth,
      context,
    );

    // ----------------------------------------------------------------
    // Wire main-timeline frame_13 (signalHit) and frame_172 (complete)
    // via root onEnterFrame tick counter.
    //
    // AS scripts/frame_13/DoAction.as: this.end();
    // AS scripts/frame_172/DoAction.as: stop(); this.removeMovieClip();
    // ----------------------------------------------------------------
    let hitFired = false;
    let completeFired = false;
    let rootFrameCount = 0;

    this.root.onEnterFrame = (_clip, _ctx) => {
      rootFrameCount++;

      // frame_13 (index 12) → signalHit
      // AS scripts/frame_13/DoAction.as: this.end();
      if (!hitFired && rootFrameCount >= 12) {
        hitFired = true;
        this.runtime.signalHit();
      }

      // frame_172 (index 171) → stop + removeMovieClip (complete)
      // AS scripts/frame_172/DoAction.as: stop(); this.removeMovieClip();
      if (!completeFired && rootFrameCount >= 171) {
        completeFired = true;
        this.root.onEnterFrame = null;
        this.runtime.complete();
      }
    };
  }
}
