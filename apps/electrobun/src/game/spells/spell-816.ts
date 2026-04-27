/**
 * Spell 816 — Vlad (Sram/Sacrieur punch-style impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/816/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no move/shoot/duplicate/projectile
 * structure, no caster-anchored reference, no _parent.cellFrom/_parent.cellTo
 * coordinate logic. All content is a single impact at the target cell driven
 * by the `anim1` animation. No librarySymbols[] entries exist — the manifest
 * has only `animations: [{name: "anim1", ...}]`. The outer SWF selects one of
 * several level-dependent sub-sprites (DefineSprite_6/7/8/9/10/11) via
 * DefineSprite_12's `gotoAndStop(_parent.level)`.
 *
 * Canonical symbol layout:
 *   - DefineSprite_12 ("anim1" top-level container, 5 frames in manifest but
 *     the timeline dispatches via gotoAndStop(_parent.level) to one of:
 *       frame 1 → DefineSprite_6  (t=random(t)+t scale-in, 19 frames, end@22)
 *       frame 2 → DefineSprite_7  (t=7, 91 frames, signalHit@22, complete@91)
 *       frame 3 → DefineSprite_8  (t=11, 106 frames, signalHit@64, complete@106)
 *       frame 4 → DefineSprite_9  (t=20, 118 frames, signalHit@79, complete@118)
 *       frame 5 → DefineSprite_10 (t=25, 121 frames, signalHit@79, complete@121)
 *       frame 6 → DefineSprite_11 (t=33, 121 frames, signalHit@79, complete@121)
 *     All "complete" frames call `_parent._parent.removeMovieClip()` which
 *     removes the outer mc — mapped to `this.runtime.complete()`.
 *   - DefineSprite_3 ("anim1" frame-level child): random rotation + 50% alpha.
 *
 * Because the manifest has NO librarySymbols[] and the textures live under
 * the bare "anim1" key (not "lib_anim1"), we use textures.getFrames("anim1").
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("vlad_806").
 * DefineSprite_6/frame_1/DoAction.as also plays SOMA.playSound("punch") — we
 * capture callbacks in onSpellStart and fire it from that symbol's frame_1
 * script.
 *
 * Level mapping for gotoAndStop:
 *   Level 1 → DS6, Level 2 → DS7, Level 3 → DS8,
 *   Level 4 → DS9, Level 5 → DS10, Level 6 → DS11
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

const ANIM1_BOUNDS = {
  width: 274.25,
  height: 266.5,
  offsetX: -142.8,
  offsetY: -143.15,
};

export class Spell816 extends RuntimeSpell {
  readonly spellId = 816;
  readonly displayType = SpellDisplayType.TargetCell;

  // Captured in onSpellStart so frame scripts can fire sounds.
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    const anim1Frames = textures.getFrames("anim1");

    // ---- DefineSprite_3 — single random-rotation overlay child ----
    // AS DefineSprite_3/frame_1/DoAction.as:
    //   _rotation = random(360);
    //   _alpha = 50;
    const ds3Sym: SymbolDefinition = {
      name: "ds3",
      totalFrames: 1,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_3/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            clip.alpha = 50 / 100;
          },
        ],
      ]),
    };

    // ---- DefineSprite_6 — level-1 variant (t=random(t)+t scale-in) ----
    // AS DefineSprite_6/frame_1/DoAction.as:   SOMA.playSound("punch")
    // AS DefineSprite_6/frame_1/DoAction_2.as: t = random(_parent.t) + _parent.t; scale-in loop
    // AS DefineSprite_6/frame_19/DoAction.as:  stop()
    // (No explicit signalHit in DS6 — frame_22 in the parent has end() but DS6
    //  only has 19 frames and stops there; end() is in DS7 which starts at frame_22)
    const ds6Sym: SymbolDefinition = {
      name: "ds6",
      totalFrames: 19,
      frames: anim1Frames.slice(0, 5),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6/frame_1/DoAction.as
            this.soundCallback?.("punch");
            // AS DefineSprite_6/frame_1/DoAction_2.as
            // t = random(_parent.t) + _parent.t;
            // _parent.t here is DS12's vars.t which is set by the
            // wrapping symbol before DS6 is placed. For DS6, _parent
            // is DS12 which set t=undefined for frame 1; we fall back
            // to a default that looks reasonable.
            const parentT = (clip.parent?.vars.t as number) ?? 20;
            const t = Math.floor(Math.random() * parentT) + parentT;
            clip.vars.t = t;
            clip.scaleX = 0;
            clip.scaleY = 0;
            clip.onEnterFrame = (c) => {
              // AS this.onEnterFrame: _xscale += t; _yscale += t; t /= 1.6
              const tv = c.vars.t as number;
              c.scaleX = c.scaleX + tv / 100;
              c.scaleY = c.scaleY + tv / 100;
              c.vars.t = tv / 1.6;
            };
          },
        ],
        [
          18,
          (clip) => {
            // AS DefineSprite_6/frame_19/DoAction.as: stop()
            clip.stop();
            clip.onEnterFrame = null;
            // DS6 is the level-1 path — signal hit here since there's
            // no explicit this.end() frame in DS6 itself.
            this.runtime.signalHit();
          },
        ],
      ]),
    };

    // ---- DefineSprite_7 — level-2 variant (t=7, 91 frames) --------
    // AS DefineSprite_7/frame_1/DoAction.as:   t = 7
    // AS DefineSprite_7/frame_22/DoAction.as:  this.end() → signalHit
    // AS DefineSprite_7/frame_91/DoAction.as:  _parent._parent.removeMovieClip(); stop()
    const ds7Sym: SymbolDefinition = {
      name: "ds7",
      totalFrames: 91,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_7/frame_1/DoAction.as
            clip.vars.t = 7;
          },
        ],
        [
          21,
          () => {
            // AS DefineSprite_7/frame_22/DoAction.as: this.end()
            this.runtime.signalHit();
          },
        ],
        [
          90,
          (clip) => {
            // AS DefineSprite_7/frame_91/DoAction.as: _parent._parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_8 — level-3 variant (t=11, 106 frames) ------
    // AS DefineSprite_8/frame_1/DoAction.as:   t = 11
    // AS DefineSprite_8/frame_64/DoAction.as:  this.end() → signalHit
    // AS DefineSprite_8/frame_106/DoAction.as: _parent._parent.removeMovieClip(); stop()
    const ds8Sym: SymbolDefinition = {
      name: "ds8",
      totalFrames: 106,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_8/frame_1/DoAction.as
            clip.vars.t = 11;
          },
        ],
        [
          63,
          () => {
            // AS DefineSprite_8/frame_64/DoAction.as: this.end()
            this.runtime.signalHit();
          },
        ],
        [
          105,
          (clip) => {
            // AS DefineSprite_8/frame_106/DoAction.as: _parent._parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_9 — level-4 variant (t=20, 118 frames) ------
    // AS DefineSprite_9/frame_1/DoAction.as:   t = 20
    // AS DefineSprite_9/frame_79/DoAction.as:  this.end() → signalHit
    // AS DefineSprite_9/frame_118/DoAction.as: _parent._parent.removeMovieClip(); stop()
    const ds9Sym: SymbolDefinition = {
      name: "ds9",
      totalFrames: 118,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_9/frame_1/DoAction.as
            clip.vars.t = 20;
          },
        ],
        [
          78,
          () => {
            // AS DefineSprite_9/frame_79/DoAction.as: this.end()
            this.runtime.signalHit();
          },
        ],
        [
          117,
          (clip) => {
            // AS DefineSprite_9/frame_118/DoAction.as: _parent._parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_10 — level-5 variant (t=25, 121 frames) -----
    // AS DefineSprite_10/frame_1/DoAction.as:   t = 25
    // AS DefineSprite_10/frame_79/DoAction.as:  this.end() → signalHit
    // AS DefineSprite_10/frame_121/DoAction.as: _parent._parent.removeMovieClip(); stop()
    const ds10Sym: SymbolDefinition = {
      name: "ds10",
      totalFrames: 121,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_10/frame_1/DoAction.as
            clip.vars.t = 25;
          },
        ],
        [
          78,
          () => {
            // AS DefineSprite_10/frame_79/DoAction.as: this.end()
            this.runtime.signalHit();
          },
        ],
        [
          120,
          (clip) => {
            // AS DefineSprite_10/frame_121/DoAction.as: _parent._parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_11 — level-6 variant (t=33, 121 frames) -----
    // AS DefineSprite_11/frame_1/DoAction.as:   t = 33
    // AS DefineSprite_11/frame_79/DoAction.as:  this.end() → signalHit
    // AS DefineSprite_11/frame_121/DoAction.as: _parent._parent.removeMovieClip(); stop()
    const ds11Sym: SymbolDefinition = {
      name: "ds11",
      totalFrames: 121,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_11/frame_1/DoAction.as
            clip.vars.t = 33;
          },
        ],
        [
          78,
          () => {
            // AS DefineSprite_11/frame_79/DoAction.as: this.end()
            this.runtime.signalHit();
          },
        ],
        [
          120,
          (clip) => {
            // AS DefineSprite_11/frame_121/DoAction.as: _parent._parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_12 — top-level dispatcher (gotoAndStop by level) ----
    // AS DefineSprite_12/frame_1/DoAction.as: gotoAndStop(_parent.level)
    // The 5-frame manifest anim1 is used for the container visuals.
    // DS12 jumps to the 1-based level frame to select which sub-sprite runs.
    // We model the 6 level slots as frames 0-5 (0-based), each attaching
    // the appropriate level-specific sub-sprite symbol.
    const ds12Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 6,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_12/frame_1/DoAction.as:
            //   gotoAndStop(_parent.level)
            // _parent here is the outer mc (root). Level is 1-based.
            const level = (clip.parent?.vars.level as number) ?? ctx.level ?? 1;
            // gotoAndStop is 1-based in AS → 0-based here
            clip.gotoAndStop(Math.max(1, Math.min(6, level)) - 1);
          },
        ],
        [
          // level 1 → DS6
          0,
          // Handled by initial frame_1 above; the gotoAndStop will
          // redirect execution so each level slot needs its own entry.
          // We model this differently: the dispatch frame (frame_1 = index 0)
          // calls gotoAndStop, so we need frames 1-6 (indices 0-5) to each
          // attach the right sub-symbol. The gotoAndStop in index-0 redirects
          // to one of indices 0-5 (levels 1-6). Since gotoAndStop(0) re-runs
          // frame 0 that would loop; instead we place the sub-symbol attachment
          // in a separate per-level frameScript after the redirect.
          // Restructure: use a single frame_1 that both redirects AND attaches.
          // (Overwrite index 0 with the full dispatch logic below.)
          // This placeholder will be overwritten — see combined entry below.
          (clip: import("@dofus/spell-runtime").SpellClip, _ctx: SpellContext) => {
            void clip;
          },
        ],
      ]),
    };

    // Rebuild ds12Sym with a clean single-dispatch frame_1.
    // The per-level symbols map: level index 0..5 → symbol.
    const levelSymbols = [ds6Sym, ds7Sym, ds8Sym, ds9Sym, ds10Sym, ds11Sym];

    const ds12SymClean: SymbolDefinition = {
      name: "anim1",
      totalFrames: 6,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_12/frame_1/DoAction.as:
            //   gotoAndStop(_parent.level)
            // We resolve the level, stop on the matching frame, and
            // immediately attach the corresponding level sub-sprite.
            const level = (clip.parent?.vars.level as number) ?? ctx.level ?? 1;
            const levelIdx = Math.max(0, Math.min(5, level - 1));
            clip.stop();
            const sym = levelSymbols[levelIdx];
            if (sym) {
              clip.attach(sym, `level_sprite`, levelIdx + 1, ctx);
            }
          },
        ],
      ]),
    };

    this.registry.register(ds3Sym);
    this.registry.register(ds6Sym);
    this.registry.register(ds7Sym);
    this.registry.register(ds8Sym);
    this.registry.register(ds9Sym);
    this.registry.register(ds10Sym);
    this.registry.register(ds11Sym);
    this.registry.register(ds12SymClean);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("vlad_806")
    callbacks.playSound("vlad_806");

    // Capture for use in DS6's frame_1 sound trigger.
    this.soundCallback = callbacks.playSound;

    // Attach the top-level dispatcher (DS12 / "anim1") to the root.
    // DS12's frame_1 script will call gotoAndStop(level) and attach
    // the appropriate level-specific sub-sprite.
    const ds12 = this.registry.resolve("anim1");
    if (ds12) {
      this.root.attach(ds12, "anim1", 1, context);
    }
  }
}
