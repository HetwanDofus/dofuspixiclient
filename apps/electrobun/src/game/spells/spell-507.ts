/**
 * Spell 507 — Tremblement de Terre / Earth Tremor (Sacrieur / Earth class).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/507/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell is a pure impact effect at the
 * target cell — no projectile, no caster reference. The outer sprite
 * (DefineSprite_23) drives the lifetime: frame_7 spawns 58 "etoiles"
 * particles, frame_13 plays the sound, frame_247 removes the outer mc
 * and signals completion.
 *
 * Library symbols:
 *   - lib_etoiles (DefineSprite_16) — 57-frame star burst. frame_1 randomises
 *     own X/Y and jumps to a random start frame. frame_13 stops and installs
 *     an inline onEnterFrame for slow float + delayed resume. frame_55
 *     removes self. Contains a child sprite13 placed at parent frame 6 (depth 2)
 *     which carries DefineSprite_13 clip events.
 *   - lib_sprite13 (DefineSprite_13) — 24-frame star graphic, child of etoiles.
 *     frame_1 has a sub-child (PlaceObject2_9_1) whose onEnterFrame randomises
 *     alpha each tick. frame_13 places a second sub-child (PlaceObject2_12_1)
 *     that seeds a vr and spins it each tick.
 *   - or (DefineSprite_6) — gold/light particle. onLoad seeds drift + bounce
 *     physics. onEnterFrame bounces off y=0 and fades out.
 *   - pierres (DefineSprite_3) — stone/rock particle. onLoad seeds drop
 *     physics. onEnterFrame drops with gravity, bounces off y=0, fades out.
 *   - terre (DefineSprite_20) — ground bounce child of the outer sprite.
 *     onEnterFrame: falls with gravity, bounces at y=0 with negative vy.
 *   - sprite15 (DefineSprite_15) — single-frame shape child. frame_1 sets
 *     random rotation.
 *
 * The outer container (DefineSprite_23, 247 frames) is not in librarySymbols
 * because it IS the "root attachment" — we treat the root itself as this
 * container via onSpellStart attaching its children and wiring the frame
 * scripts directly on the root.
 *
 * Main timeline (DefineSprite_23):
 *   frame_7  — spawn 58 etoiles particles (c=2..59)
 *   frame_13 — SOMA.playSound("many_507"); signalHit
 *   frame_247 — _parent._parent.removeMovieClip(); complete
 *
 * NOTE: sprite13 is a child INSIDE etoiles (placed at etoiles' frame 6 at
 * depth 2). The "or" and "pierres" sprites are referenced by the outer
 * container (DefineSprite_23) in a pattern where each etoiles attachment
 * implicitly contains sub-children. However, reading the AS carefully:
 * - DefineSprite_6_or and DefineSprite_3_pierres have their CLIPACTIONRECORD
 *   scripts filed under the DefineSprite_6_or / DefineSprite_3_pierres
 *   directories directly. They are standalone library symbols attachable
 *   from the outer container.
 * - DefineSprite_16_etoiles/frame_7 places sprite13 (characterId 13) as
 *   a child at depth 2 — ported in etoiles' frameScripts[6].
 * - DefineSprite_20_terre and DefineSprite_15 are additional children of
 *   the outer container that appear in the SWF timeline but whose attach
 *   frames are inferred from their placement context.
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

// ---- Manifest bounds for calculateAnchor ----------------------------------------

const ETOILES_BOUNDS = {
  width: 82.55,
  height: 95.7,
  offsetX: -44.7,
  offsetY: -57.15,
};

const SPRITE13_BOUNDS = {
  width: 21.95,
  height: 25.45,
  offsetX: -11.7,
  offsetY: -12.8,
};

// or / pierres / terre / sprite15 are not in librarySymbols with explicit bounds —
// use sensible mid-registration fallback; the actual visible content is driven
// by the SVG textures (if any) and the clip-event physics.
// From AS, these are spawned at runtime by the outer container with no explicit
// bounds; we use centered anchors (0.5/0.5) for container-style symbols and
// actual texture frames where available.

export class Spell507 extends RuntimeSpell {
  readonly spellId = 507;
  readonly displayType = SpellDisplayType.TargetCell;

  // Keep references to symbols needed for cross-symbol attaches
  private sprite13Sym!: SymbolDefinition;
  private etoilesSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // =========================================================================
    // lib_sprite13 (DefineSprite_13) — the animated star inside etoiles
    //
    // This sprite has TWO sets of child clip-event handlers at different
    // parent frames:
    //   - frame_1 (PlaceObject2_9_1): sub-child whose onEnterFrame randomises
    //     its own alpha each tick.
    //   - frame_13 (PlaceObject2_12_1): sub-child seeded with vr that spins
    //     each tick.
    //
    // Since our runtime doesn't support nested sub-children via PlaceObject2
    // directly, we fold both effects into sprite13's own onEnterFrame so
    // the visible twinkling / spinning behaviour is reproduced. The alpha
    // flicker is applied to the clip itself; the rotation effect begins
    // only after frame 13 (we track an internal frame counter via vars.f).
    // =========================================================================
    const sprite13Anchor = calculateAnchor(SPRITE13_BOUNDS);

    const sprite13Sym: SymbolDefinition = {
      name: "sprite13",
      totalFrames: 24,
      frames: textures.getFrames("lib_sprite13"),
      anchorX: sprite13Anchor.x,
      anchorY: sprite13Anchor.y,
      // AS DefineSprite_13/frame_13/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        // Seed the spinning child's vr (frames < 13 use the alpha-flicker
        // behaviour only; after frame 13 we also apply rotation).
        clip.vars.vr = (-12.5 + Math.floor(Math.random() * 33)) * Math.PI / 180;
        clip.vars.f = 0; // internal frame counter for phase tracking
      },
      onEnterFrame: (clip) => {
        const f = (clip.vars.f as number) + 1;
        clip.vars.f = f;

        // AS DefineSprite_13/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // Sub-child alpha = random(100). We apply this to the clip's own alpha
        // as a stand-in for the inner child's flicker.
        clip.alpha = Math.floor(Math.random() * 100) / 100;

        // AS DefineSprite_13/frame_13/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // Spinning starts after frame 13 of the parent etoiles timeline, but
        // since sprite13 is attached at etoiles frame 6 and runs independently,
        // we activate spin after ~7 own ticks (frame 6 + 7 = frame 13 of etoiles).
        if (f >= 7) {
          const vr = clip.vars.vr as number;
          clip.rotation += vr;
        }
      },
    };
    this.sprite13Sym = sprite13Sym;
    this.registry.register(sprite13Sym);

    // =========================================================================
    // lib_etoiles (DefineSprite_16) — 57-frame star burst particle
    //
    // frame_1 (DoAction.as): randomise _X/_Y; gotoAndPlay(random(15)+1)
    // frame_7 (PlaceObject2_13_2 onClipEvent(load)): sprite13 child placed
    //         here — gotoAndStop(random(totalFrames)+1) on the child
    // frame_13 (DoAction.as): stop(); install inline onEnterFrame for float
    // frame_55 (DoAction.as): removeMovieClip(this)
    // =========================================================================
    const etoilesAnchor = calculateAnchor(ETOILES_BOUNDS);

    const etoilesSym: SymbolDefinition = {
      name: "etoiles",
      totalFrames: 57,
      frames: textures.getFrames("lib_etoiles"),
      anchorX: etoilesAnchor.x,
      anchorY: etoilesAnchor.y,
      frameScripts: new Map([
        [
          // AS DefineSprite_16_etoiles/frame_1/DoAction.as
          // _X = 140 * (Math.random() - 0.5);
          // _Y = 70 * (Math.random() - 0.5);
          // gotoAndPlay(random(15) + 1);
          0,
          (clip, ctx) => {
            clip.x = 140 * (Math.random() - 0.5);
            clip.y = 70 * (Math.random() - 0.5);
            const startFrame = Math.floor(Math.random() * 15) + 1;
            clip.gotoAndPlay(startFrame - 1); // AS 1-based → 0-based

            // The sprite13 child is placed at etoiles frame_7 (0-based: 6).
            // We defer attaching until then via vars so we can check in
            // the frameScripts[6] entry. Mark as not yet attached.
            clip.vars.sprite13Attached = false;

            // vars for the inline onEnterFrame installed at frame_13
            clip.vars.accy = 0.3;
            clip.vars.tf = 30 + Math.floor(Math.random() * 90);
            clip.vars.vy = -3 * Math.random();
            clip.vars.t_inner = 0;
            clip.vars.end = 0;
            clip.vars.innerActive = false;

            // Suppress the _unused_ ctx warning
            void ctx;
          },
        ],
        [
          // AS DefineSprite_16_etoiles/frame_7/PlaceObject2_13_2/CLIPACTIONRECORD onClipEvent(load).as
          // sprite13 is placed at etoiles frame 7 (0-based: 6), depth 2.
          // On load: gotoAndStop(random(_totalframes) + 1)
          6,
          (clip, ctx) => {
            if (!clip.vars.sprite13Attached) {
              clip.vars.sprite13Attached = true;
              const child = clip.attach(this.sprite13Sym, "sprite13_child", 2, ctx, {
                x: 0,
                y: -0.25, // canonical PlaceObject2 translateY at frame 6 = -0.25
              });
              // AS onClipEvent(load): gotoAndStop(random(_totalframes) + 1)
              const randomFrame = Math.floor(Math.random() * this.sprite13Sym.totalFrames);
              child.gotoAndStop(randomFrame);
            }
          },
        ],
        [
          // AS DefineSprite_16_etoiles/frame_13/DoAction.as
          // stop(); accy=0.3; tf=30+random(90); vy=-3*Math.random(); t=0;
          // this.onEnterFrame = function() { ... };
          12,
          (clip) => {
            clip.stop();
            // Re-seed the inline float vars (may have already been set at frame_1,
            // but canonical AS resets them here).
            clip.vars.accy = 0.3;
            clip.vars.tf = 30 + Math.floor(Math.random() * 90);
            clip.vars.vy = -3 * Math.random();
            clip.vars.t_inner = 0;
            clip.vars.end = 0;
            clip.vars.innerActive = true;
          },
        ],
        [
          // AS DefineSprite_16_etoiles/frame_55/DoAction.as
          // removeMovieClip(this); stop();
          54,
          (clip) => {
            clip.remove();
          },
        ],
      ]),
      // The inline onEnterFrame installed at frame_13 is implemented here.
      // It only activates once vars.innerActive = true (set by frameScripts[12]).
      onEnterFrame: (clip) => {
        if (!clip.vars.innerActive) {
          return;
        }
        // AS DefineSprite_16_etoiles/frame_13/DoAction.as (inline function):
        // _Y = _Y + vy; vy *= 0.9;
        // if(t++ > tf & end != 1) { play(); end = 1; }
        let vy = clip.vars.vy as number;
        let t = clip.vars.t_inner as number;
        const tf = clip.vars.tf as number;
        const end = clip.vars.end as number;

        clip.y += vy;
        vy *= 0.9;
        clip.vars.vy = vy;

        if (t++ > tf && end !== 1) {
          clip.play();
          clip.vars.end = 1;
        }
        clip.vars.t_inner = t;
      },
    };
    this.etoilesSym = etoilesSym;
    this.registry.register(etoilesSym);

    // =========================================================================
    // or (DefineSprite_6) — gold/light bounce particle
    //
    // onClipEvent(load):
    //   seed vx, tm, vy, _parent._x/_y, t, _xscale/_yscale/_alpha, v, vr
    // onClipEvent(enterFrame):
    //   drift _parent._x/_y by vx/vy
    //   t==1: fade alpha; remove when alpha<=5
    //   t!=1: bounce at _Y==0, apply rotation, decelerate v and vr; flip to t=1 after tm ticks
    // =========================================================================
    const orSym: SymbolDefinition = {
      name: "or",
      totalFrames: 1,
      frames: textures.getFrames("lib_or"),
      anchorX: 0.5,
      anchorY: 0.5,
      // AS DefineSprite_6_or/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.tm = 20 + Math.floor(Math.random() * 40);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        // _parent._x/_y in AS refers to the wrapper container's position.
        // Since we don't have a separate wrapper, we apply to this clip's
        // parent offset via vars and accumulate in onEnterFrame.
        clip.vars.px = 20 * (Math.random() - 0.5);
        clip.vars.py = 10 * (Math.random() - 0.5);
        clip.x = clip.vars.px as number;
        clip.y = clip.vars.py as number;
        const t = 60 + 40 * Math.random();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -25 * Math.random() - 25;
        clip.vars.vr = 140 * (-0.5 + Math.random());
        clip.vars.t_phase = 0; // t in AS (phase flag: 0 or 1)
        clip.vars.m = 0; // tick counter
        clip.vars.inner_y = 0; // tracks the inner _Y (relative vertical position)
      },
      // AS DefineSprite_6_or/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        const vx = clip.vars.vx as number;
        const vy_drift = clip.vars.vy as number;
        let px = clip.vars.px as number;
        let py = clip.vars.py as number;
        px += vx;
        py += vy_drift;
        clip.vars.px = px;
        clip.vars.py = py;

        const t_phase = clip.vars.t_phase as number;

        if (t_phase === 1) {
          // Fading out
          let alpha = clip.alpha * 100;
          alpha -= 2.5;
          clip.alpha = alpha / 100;
          if (alpha <= 5) {
            clip.remove();
          }
          // Update base position to follow drift
          clip.x = px + 0;
          clip.y = py + (clip.vars.inner_y as number);
        } else {
          // Active bounce phase
          let inner_y = clip.vars.inner_y as number;
          let v = clip.vars.v as number;
          let vr = clip.vars.vr as number;
          let m = clip.vars.m as number;
          const tm = clip.vars.tm as number;

          inner_y += v;
          clip.rotation += (vr * Math.PI) / 180;
          v /= 1.3;
          vr /= 1.03;
          m++;

          if (m > tm) {
            clip.vars.t_phase = 1;
          }

          if (inner_y > 0) {
            clip.vars.vx = vx / 2;
            clip.vars.vy = vy_drift / 2;
            clip.rotation = 0;
            inner_y = 0;
            v = (-v) / 4;
          }

          clip.vars.inner_y = inner_y;
          clip.vars.v = v;
          clip.vars.vr = vr;
          clip.vars.m = m;

          clip.x = px;
          clip.y = py + inner_y;
        }
      },
    };
    this.registry.register(orSym);

    // =========================================================================
    // pierres (DefineSprite_3) — stone/rock drop particle
    //
    // onClipEvent(load):
    //   seed vy, vx, _parent._x/_y, _Y (high up), t, _xscale/_yscale/_alpha, v, vr
    // onClipEvent(enterFrame):
    //   drift _parent; t==1: fade alpha; t!=1: gravity drop, bounce at _Y==0
    // =========================================================================
    const pierresSym: SymbolDefinition = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: 0.5,
      anchorY: 0.5,
      // AS DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.vy = 2 * (Math.random() - 0.5);
        clip.vars.vx = 2 * (Math.random() - 0.5);
        clip.vars.px = 40 * (Math.random() - 0.5);
        clip.vars.py = 10 * (Math.random() - 0.5);
        clip.vars.inner_y = -180 - Math.floor(Math.random() * 40);
        const t = 60 + 40 * Math.random();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = 10 * Math.random();
        clip.vars.vr = 40 * (-0.5 + Math.random());
        clip.vars.t_phase = 0;

        // Set initial position
        clip.x = clip.vars.px as number;
        clip.y = (clip.vars.py as number) + (clip.vars.inner_y as number);
      },
      // AS DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        let vx = clip.vars.vx as number;
        let vy_drift = clip.vars.vy as number;
        let px = clip.vars.px as number;
        let py = clip.vars.py as number;
        px += vx;
        py += vy_drift;
        clip.vars.px = px;
        clip.vars.py = py;

        const t_phase = clip.vars.t_phase as number;

        if (t_phase === 1) {
          // Fading out
          let alpha = clip.alpha * 100;
          alpha -= 5;
          clip.alpha = alpha / 100;
          if (alpha <= 5) {
            clip.remove();
          }
          clip.x = px;
          clip.y = py + (clip.vars.inner_y as number);
        } else {
          // Active fall/bounce phase
          let inner_y = clip.vars.inner_y as number;
          let v = clip.vars.v as number;
          let vr = clip.vars.vr as number;

          inner_y += v;
          clip.rotation += (vr * Math.PI) / 180;
          v += 1.5;

          if (inner_y > 0) {
            vx /= 2;
            vy_drift /= 2;
            clip.vars.vx = vx;
            clip.vars.vy = vy_drift;
            clip.rotation = 0;
            inner_y = 0;
            v = (-v) / 4;
            if (Math.abs(v) < 1) {
              clip.vars.vx = 0;
              clip.vars.vy = 0;
              clip.vars.t_phase = 1;
            }
          }

          clip.vars.inner_y = inner_y;
          clip.vars.v = v;
          clip.vars.vr = vr;

          clip.x = px;
          clip.y = py + inner_y;
        }
      },
    };
    this.registry.register(pierresSym);

    // =========================================================================
    // terre (DefineSprite_20) — ground bounce effect, child of outer container
    //
    // onClipEvent(enterFrame):
    //   _Y += v; v += 1; if(_Y >= 0) { v = -6 * Math.random(); }
    // No onLoad in the manifest scripts — v starts at 0 implicitly.
    // =========================================================================
    const terreSym: SymbolDefinition = {
      name: "terre",
      totalFrames: 1,
      frames: textures.getFrames("lib_terre"),
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        clip.vars.v = 0;
        clip.vars.inner_y = 0;
      },
      // AS DefineSprite_20_terre/frame_1/PlaceObject2_19_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        let v = clip.vars.v as number;
        let inner_y = clip.vars.inner_y as number;

        inner_y += v;
        v += 1;

        if (inner_y >= 0) {
          inner_y = 0;
          v = -6 * Math.random();
        }

        clip.vars.v = v;
        clip.vars.inner_y = inner_y;
        clip.y = inner_y;
      },
    };
    this.registry.register(terreSym);

    // =========================================================================
    // sprite15 (DefineSprite_15) — single-frame shape, random rotation on load
    //
    // AS DefineSprite_15/frame_1/DoAction.as:
    //   _rotation = random(360);
    // =========================================================================
    const sprite15Sym: SymbolDefinition = {
      name: "sprite15",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite15"),
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          // AS DefineSprite_15/frame_1/DoAction.as
          0,
          (clip) => {
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
      ]),
    };
    this.registry.register(sprite15Sym);

    // =========================================================================
    // The outer container (DefineSprite_23, 247 frames) — not in librarySymbols.
    // We model it directly on the root clip via onSpellStart + root frameScripts.
    // The root IS the outer container for displayType 11.
    //
    // frame_7  (DoAction.as): c=2; while(c < 60) { attachMovie("etoiles","etoiles"+c, c); c++ }
    // frame_13 (DoAction.as): SOMA.playSound("many_507")
    // frame_247 (DoAction.as): _parent._parent.removeMovieClip(); stop();
    // =========================================================================
    // Root frame scripts are wired in onSpellStart below by registering a
    // synthetic "root" container symbol. We use a trick: register frame scripts
    // on the root SpellClip directly through a dummy symbol, or wire them via
    // onSpellStart by attaching to root. The cleanest approach for the root
    // is to use a container symbol with totalFrames=247 and the appropriate
    // frame scripts. We wire this as a synthetic outer symbol attached at root.

    const outerSym: SymbolDefinition = {
      name: "outer23",
      totalFrames: 247,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          // AS DefineSprite_23/frame_7/DoAction.as
          // c = 2; while(c < 60) { this.attachMovie("etoiles","etoiles"+c, c); c++ }
          6,
          (clip, ctx) => {
            for (let c = 2; c < 60; c++) {
              clip.attach(this.etoilesSym, `etoiles${c}`, c, ctx);
            }
          },
        ],
        [
          // AS DefineSprite_23/frame_13/DoAction.as
          // SOMA.playSound("many_507");
          // (sound was pre-scheduled at init time; signalHit here)
          12,
          (_clip) => {
            this.runtime.signalHit();
          },
        ],
        [
          // AS DefineSprite_23/frame_247/DoAction.as
          // _parent._parent.removeMovieClip(); stop();
          246,
          (clip) => {
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };
    this.registry.register(outerSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS DefineSprite_23/frame_13/DoAction.as: SOMA.playSound("many_507")
    // The sound fires at frame 13 of the outer container. We play it at spell
    // start (frame 1) per the manifest sounds[] entry which lists frame=12
    // (0-based). The canonical sound cue is frame_13 of the outer sprite —
    // we honour it here as the main-timeline sound call.
    callbacks.playSound("many_507");

    // Attach the outer 247-frame container to root. All subsequent frame
    // scripts (etoiles spawn at frame 7, sound at frame 13, completion at
    // frame 247) are driven from within this child container.
    const outerSym = this.registry.resolve("outer23");
    if (outerSym) {
      this.root.attach(outerSym, "outer23", 1, context);
    }
  }
}
