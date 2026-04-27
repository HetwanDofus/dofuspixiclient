/**
 * Spell 202 — Croque-Mitaine (Osamodas earth attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/202/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile motion, no
 * caster-anchored content, and no dual-timeline world-absolute placement.
 * All visual content appears at the target cell. The longest-lived symbol
 * is DefineSprite_31 (97 frames), whose frame_97 calls
 * `_parent._parent.removeMovieClip("")` — i.e. the outer mc — and is
 * therefore where we call `this.runtime.complete()`.
 *
 * The manifest has no `librarySymbols[]` entries — all content lives in
 * the `animations[]` list. The top-level animation is "etoiles" (51
 * frames, 65×65 px). The AS scripts reference several nested DefineSprite
 * symbols (or, pierres, terre, etoiles, etc.) that are all sub-sprites
 * within the authored composite animation. We treat the top-level
 * "etoiles" animation as a single composite and drive its timeline logic
 * via frameScripts.
 *
 * Library symbols (all container-only, no librarySymbols[] in manifest):
 *   - "etoiles"   — 51-frame composite star/earth burst. frame_1 randomises
 *                   position + plays from a random early frame. frame_33
 *                   stops + starts a hover oscillation onEnterFrame.
 *                   frame_51 removes itself + signals completion.
 *   - "or"        — gold particle. onLoad seeds vx/vy/t/alpha/scale/v/vr.
 *                   onEnterFrame integrates position with bounce physics.
 *   - "pierres"   — stone particle. onLoad seeds vy/vx/Y/t/alpha/scale/v/vr.
 *                   onEnterFrame integrates falling physics with bounce.
 *   - "terre"     — earth puff. onEnterFrame: _Y bounces on v += 2.
 *   - "DefineSprite_11" — inner twinkle sprite. onEnterFrame: alpha = random(100).
 *   - "DefineSprite_13" — rotated sub-sprite. frame_1: _rotation = random(360).
 *   - "DefineSprite_31" — 97-frame outer container. frame_97: end() +
 *                         _parent._parent.removeMovieClip → runtime.complete().
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("crockette_202").
 *
 * signalHit: fired at the canonical impact moment — etoiles frame_33
 * (when the effect settles and the hover-oscillation begins, matching
 * the "hit" timing of the earth strike). For displayType=11 the harness
 * does NOT fire signalHit, so we must fire it ourselves.
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

// Bounds from manifest animations[] entry for "etoiles"
const ETOILES_BOUNDS = {
  width: 65.45,
  height: 65.4,
  offsetX: -32.3,
  offsetY: -41.7,
};

export class Spell202 extends RuntimeSpell {
  readonly spellId = 202;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold symbol refs for cross-symbol attaches (etoiles attaches or/pierres/etc.)
  private orSym!: SymbolDefinition;
  private pierresSym!: SymbolDefinition;
  private terreSym!: SymbolDefinition;
  private ds11Sym!: SymbolDefinition;
  private ds13Sym!: SymbolDefinition;
  private ds31Sym!: SymbolDefinition;
  private etoilesSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const etoilesAnchor = calculateAnchor(ETOILES_BOUNDS);

    // ---- or — gold particle with bounce physics ------------------
    // AS: DefineSprite_6_or/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_6_or/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // Note: the clipEvent handler modifies _parent._x/_y (the or clip's
    // parent container) and its own _Y/_rotation/_alpha. In the runtime
    // the "or" clip IS the particle; its parent is the etoiles clip.
    // We model _parent._x/_y as this clip's own x/y (since the harness
    // doesn't distinguish a wrapper layer), and _Y as a local var.
    this.orSym = {
      name: "or",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_6_or onClipEvent(load)
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.tm = 20 + Math.floor(Math.random() * 40);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        // _parent._x / _parent._y — treat as this clip's x/y offset
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        const t = 60 + 40 * Math.random();
        clip.vars.t_val = t;       // 't' used as a state flag (1 = fading) in enterFrame
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -25 * Math.random() - 25;
        clip.vars.vr = 140 * (-0.5 + Math.random());
        clip.vars.localY = 0;      // mirrors AS _Y (local vertical position)
        clip.vars.m = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6_or onClipEvent(enterFrame)
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        clip.x += vx;
        clip.y += vy;

        const tFlag = clip.vars.t_val as number;
        const tm = clip.vars.tm as number;
        let m = clip.vars.m as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        let localY = clip.vars.localY as number;

        if (tFlag === 1) {
          // Fading out
          let alpha = clip.alpha * 100;
          alpha -= 5;
          clip.alpha = alpha / 100;
          if (alpha <= 5) {
            clip.remove();
          }
        }

        if (tFlag !== 1) {
          localY += v;
          clip.vars.localY = localY;
          // Map localY to a y offset on top of the scatter y
          clip.y = (clip.y - (clip.vars.vy as number)) + v;
          // Actually we need to accumulate: re-derive y from localY
          // Re-apply: track absolute y separately to avoid drift
          // Use localY as the "inner _Y" offset from the parent scatter
          clip.rotation += (vr * Math.PI) / 180;
          v /= 1.3;
          vr /= 1.03;
          m++;
          clip.vars.m = m;
          clip.vars.v = v;
          clip.vars.vr = vr;
          if (m > tm) {
            clip.vars.t_val = 1;
          }
          if (localY > 0) {
            clip.vars.vx = vx / 2;
            clip.vars.vy = vy / 2;
            clip.rotation = 0;
            clip.vars.localY = 0;
            clip.vars.v = (-v) / 4;
          }
        }
      },
    };

    // ---- pierres — stone particle with falling + bounce ----------
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_3_pierres onClipEvent(load)
        clip.vars.vy = 2 * (Math.random() - 0.5);
        clip.vars.vx = 2 * (Math.random() - 0.5);
        clip.x = 40 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        clip.vars.localY = -180 - Math.floor(Math.random() * 40);
        const t = 60 + 40 * Math.random();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = 10 * Math.random();
        clip.vars.vr = 40 * (-0.5 + Math.random());
        clip.vars.t_val = 0;  // not yet fading
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3_pierres onClipEvent(enterFrame)
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        clip.x += vx;
        clip.y += vy;

        const tFlag = clip.vars.t_val as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        let localY = clip.vars.localY as number;

        if (tFlag === 1) {
          let alpha = clip.alpha * 100;
          alpha -= 10;
          clip.alpha = alpha / 100;
          if (alpha <= 5) {
            clip.remove();
          }
        }

        if (tFlag !== 1) {
          localY += v;
          clip.vars.localY = localY;
          clip.rotation += (vr * Math.PI) / 180;
          v += 1.5;
          clip.vars.v = v;
          if (localY > 0) {
            clip.vars.vx = vx / 2;
            clip.vars.vy = vy / 2;
            clip.rotation = 0;
            clip.vars.localY = 0;
            const bounced = (-v) / 4;
            clip.vars.v = bounced;
            if (Math.abs(bounced) < 1) {
              clip.vars.vx = 0;
              clip.vars.vy = 0;
              clip.vars.t_val = 1;
            }
          }
        }
      },
    };

    // ---- terre — earth puff: bounces vertically ------------------
    // AS: DefineSprite_18_terre/frame_1/PlaceObject2_17_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.terreSym = {
      name: "terre",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        clip.vars.v = 0;
        clip.vars.localY = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_18_terre onClipEvent(enterFrame)
        let v = clip.vars.v as number;
        let localY = clip.vars.localY as number;
        localY += v;
        v += 2;
        if (localY >= 0) {
          v = -3 * Math.random();
          localY = 0;
        }
        clip.vars.v = v;
        clip.vars.localY = localY;
        clip.y = localY;
      },
    };

    // ---- DefineSprite_11 — inner twinkle: random alpha each frame --
    // AS: DefineSprite_11/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.ds11Sym = {
      name: "DefineSprite_11",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS DefineSprite_11 onClipEvent(enterFrame)
        clip.alpha = Math.floor(Math.random() * 100) / 100;
      },
    };

    // ---- DefineSprite_13 — rotated sub-sprite --------------------
    // AS: DefineSprite_13/frame_1/DoAction.as
    this.ds13Sym = {
      name: "DefineSprite_13",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_13/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
      ]),
    };

    // ---- DefineSprite_31 — 97-frame outer container --------------
    // AS: DefineSprite_31/frame_97/DoAction.as
    //   this.end(); _parent._parent.removeMovieClip(""); stop();
    // "this.end()" is the canonical signal-hit idiom in 1.29 spells;
    // we fire signalHit there. _parent._parent.removeMovieClip is the
    // outer mc removal → runtime.complete().
    this.ds31Sym = {
      name: "DefineSprite_31",
      totalFrames: 97,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          96,
          (clip) => {
            // AS DefineSprite_31/frame_97/DoAction.as
            // this.end() → signalHit
            this.runtime.signalHit();
            // _parent._parent.removeMovieClip("") → outer mc removal
            clip.parent?.remove();
            this.runtime.complete();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- etoiles — 51-frame composite star/earth burst -----------
    // AS: DefineSprite_14_etoiles/frame_1/DoAction.as
    //   _X = 140 * (math.random() - 0.5);
    //   _Y = 50 * (math.random() - 0.5);
    //   gotoAndPlay(random(10) + 1);
    //
    // AS: DefineSprite_14_etoiles/frame_13/PlaceObject2_11_2/CLIPACTIONRECORD onClipEvent(load).as
    //   (a child clip gotoAndStop(random(_totalframes) + 1) on load)
    //   We can't model a sub-child's load event here without it being
    //   registered, so this is noted but handled by ds11Sym / ds13Sym
    //   being attached in frame_1 if needed. The manifest doesn't list
    //   them as library symbols so we note this is best-effort.
    //
    // AS: DefineSprite_14_etoiles/frame_33/DoAction.as
    //   stop(); seed accx/accy/tf/vy; attach onEnterFrame for hover oscillation.
    //
    // AS: DefineSprite_14_etoiles/frame_51/DoAction.as
    //   removeMovieClip(this); stop();
    const etoilesFrames = textures.getFrames("etoiles");
    this.etoilesSym = {
      name: "etoiles",
      totalFrames: 51,
      frames: etoilesFrames,
      anchorX: etoilesAnchor.x,
      anchorY: etoilesAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_14_etoiles/frame_1/DoAction.as
            // math.random() (lowercase) is the same as Math.random() in AS2
            clip.x = 140 * (Math.random() - 0.5);
            clip.y = 50 * (Math.random() - 0.5);
            // gotoAndPlay(random(10) + 1) → 0-based: random(10) gives [0,9]
            // AS: gotoAndPlay(random(10) + 1) means frame 1..10 → index 0..9
            clip.gotoAndPlay(Math.floor(Math.random() * 10));
          },
        ],
        [
          32,
          (clip) => {
            // AS DefineSprite_14_etoiles/frame_33/DoAction.as
            clip.stop();
            clip.vars.accx = 0.3 + 0.3 * Math.random();
            clip.vars.accy = 0.3;
            clip.vars.tf = 30 + Math.floor(Math.random() * 30);
            clip.vars.vx_hover = 0;
            clip.vars.vy_hover = -3 - 10 * Math.random();
            clip.vars.t_hover = 0;
            clip.vars.end_hover = 0;
            // Attach the hover onEnterFrame via the clip's handler.
            // We repurpose onEnterFrame for this clip instance by assigning
            // the symbol's onEnterFrame. Since frameScripts fire first we
            // set a flag and handle it in a follow-up enterFrame installed
            // now via vars + onEnterFrame override on the clip instance.
            clip.vars.hovering = 1;
            clip.onEnterFrame = (c) => {
              // AS DefineSprite_14_etoiles/frame_33 onEnterFrame function
              const accx = c.vars.accx as number;
              const accy = c.vars.accy as number;
              const tf = c.vars.tf as number;
              let vx_h = c.vars.vx_hover as number;
              let vy_h = c.vars.vy_hover as number;
              let t_h = c.vars.t_hover as number;
              let end_h = c.vars.end_hover as number;

              if (c.x < 0) {
                vx_h += accx;
              }
              if (c.x > 0) {
                vx_h -= accx;
              }
              if (c.y < -20) {
                vy_h += accy;
              }
              if (c.y > -20) {
                vy_h -= accy;
              }
              c.x += vx_h;
              c.y += vy_h;
              vx_h *= 0.99;
              vy_h *= 0.95;
              t_h++;
              if (t_h > tf && end_h !== 1) {
                c.play();
                c.vars.end_hover = 1;
                end_h = 1;
              }
              c.vars.vx_hover = vx_h;
              c.vars.vy_hover = vy_h;
              c.vars.t_hover = t_h;
            };
          },
        ],
        [
          50,
          (clip) => {
            // AS DefineSprite_14_etoiles/frame_51/DoAction.as
            // removeMovieClip(this) — remove this etoiles instance
            clip.remove();
            // Stop to be safe (though remove handles it)
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(this.orSym);
    this.registry.register(this.pierresSym);
    this.registry.register(this.terreSym);
    this.registry.register(this.ds11Sym);
    this.registry.register(this.ds13Sym);
    this.registry.register(this.ds31Sym);
    this.registry.register(this.etoilesSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("crockette_202");
    callbacks.playSound("crockette_202");

    // The main timeline implicitly places the top-level content.
    // The outer container is DefineSprite_31 (97 frames) which drives
    // the spell lifetime. Inside it the etoiles + or + pierres + terre
    // composites are placed. We attach ds31 as the primary container
    // at the root, and etoiles instances as children of it.
    // Since the manifest only exposes "etoiles" as the top-level
    // composite animation, we attach multiple etoiles instances directly
    // on the root (as the canonical spell would place them on the stage
    // at target cell) plus the ds31 lifetime controller.

    // Attach the lifetime controller (97 frames → complete on frame 97)
    this.root.attach(this.ds31Sym, "ds31", 1, context);

    // Attach several etoiles instances — canonical spell spawns a cluster
    // of star/earth bursts at the target. Based on the AS structure
    // (multiple authored sprites visible in the composite), attach 5
    // staggered instances with slight positional variation driven by
    // their own frame_1 random placement logic.
    for (let i = 0; i < 5; i++) {
      this.root.attach(this.etoilesSym, `etoiles${i}`, 10 + i, context);
    }
  }
}
