/**
 * Spell 2903 — Feux d'Artifice (Fireworks).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2903/scripts/scripts/
 *
 * displayType=10 (CasterCell). The outer container is a single sprite
 * (DefineSprite_31) anchored at the caster cell. It has a 97-frame
 * authored timeline that:
 *   - frame_1:  plays "fireworks01" sound, sets random size/rotation
 *   - frame_70: plays "explo_fireworks" sound
 *   - frame_76: onClipEvent(load) on its child (DefineSprite_28) spawns
 *               N `feux` sub-sprites
 *   - frame_97: stop()
 *
 * The `feux` symbol (DefineSprite_23_feux) selects a display mode via
 * gotoAndStop(level + 1), driving different particle behaviors:
 *   - frame_2  (level=1): single "boule" particle drifting outward,
 *              spawning minifeux2 streaks
 *   - frame_5  (level=4): rotating shrinking particle
 *   - frame_8  (level=7): "boule" particle with minifeux2 spawning
 *   - frame_11 (level=10): "boule" particle with minifeux3 spawning +
 *              parent removal
 *   - frame_14 (level=13): "fusee" rocket particle with minifeux3/
 *              minifeux4 spawning
 *
 * Library symbols:
 *   - lib_minifeux  — 36-frame spark sprite. onLoad: alpha+v. onEnterFrame:
 *                     alpha fade + X drift. frame_34: removeMovieClip.
 *   - lib_minifeux2 — 36-frame spark. onLoad: alpha+v. onEnterFrame:
 *                     alpha fade + X drift. frame_34: removeMovieClip.
 *   - lib_minifeux3 — 78-frame spark. onLoad: alpha+v (slower). onEnterFrame:
 *                     parent alpha flicker + fade + X drift with friction.
 *                     frame_76: removeMovieClip.
 *   - lib_minifeux4 — 78-frame large spark. onLoad: angle/v/vr physics.
 *                     onEnterFrame: rotation + position integration + alpha
 *                     fade. frame_76: removeMovieClip.
 *   - lib_feux      — 16-frame composite firework burst. frame_1: goto
 *                     level+1. Complex per-frame particles with minifeux2/3/4
 *                     spawning.
 *
 * Main timeline (DefineSprite_31 = outer "shoot"):
 *   The spell is an impact at the caster cell (self/AOE origin). The outer
 *   mc is attached by configureHarness for displayType=10 (CasterCell) — but
 *   since this spell has no "move"/"shoot" harness pattern, we drive the whole
 *   animation as a single top-level "outer" symbol attached in onSpellStart,
 *   with completion at frame_97 (stop → complete).
 *
 * The `feux` symbol's frame_1 calls `gotoAndStop(_parent._parent._parent.level + 1)`.
 * The parent chain is: feux → DefineSprite_28 child → DefineSprite_31 outer mc
 * → root. So `_parent._parent._parent` = root, and level is read from root.vars.level.
 *
 * Sounds:
 *   - "fireworks01" at frame_1 of DefineSprite_31
 *   - "explo_fireworks" at frame_70 of DefineSprite_31
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

// ---- Bounds from manifest librarySymbols[] ----
const MINIFEUX_BOUNDS = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};
const MINIFEUX2_BOUNDS = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};
const MINIFEUX3_BOUNDS = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};
const MINIFEUX4_BOUNDS = {
  width: 5.35,
  height: 6.6,
  offsetX: -1.25,
  offsetY: -2.85,
};
const FEUX_BOUNDS = {
  width: 48.25,
  height: 53.3,
  offsetX: -18.65,
  offsetY: -26.75,
};

export class Spell2903 extends RuntimeSpell {
  readonly spellId = 2903;
  readonly displayType = SpellDisplayType.CasterCell;

  // Symbol references held for cross-symbol spawning
  private minifeux2Sym!: SymbolDefinition;
  private minifeux3Sym!: SymbolDefinition;
  private minifeux4Sym!: SymbolDefinition;
  private minis2Counter = 0;
  private minis3Counter = 0;
  private minis4Counter = 0;

  // Sound callback captured for use in frame scripts
  private playSoundFn?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const minifeuxAnchor = calculateAnchor(MINIFEUX_BOUNDS);
    const minifeux2Anchor = calculateAnchor(MINIFEUX2_BOUNDS);
    const minifeux3Anchor = calculateAnchor(MINIFEUX3_BOUNDS);
    const minifeux4Anchor = calculateAnchor(MINIFEUX4_BOUNDS);
    const feuxAnchor = calculateAnchor(FEUX_BOUNDS);

    // ---- lib_minifeux — short-lived spark (spawned from DefineSprite_26 enterFrame) ----
    // AS DefineSprite_8_minifeux/frame_1/DoAction.as:
    //   _rotation = random(360)
    //   _X = _parent.boule._x
    //   _Y = _parent.boule._y
    // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/onClipEvent(load):
    //   _alpha = 150; v = Math.random()
    // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame):
    //   _alpha -= 3.34; _X += v
    // AS DefineSprite_8_minifeux/frame_34/DoAction.as:
    //   this.removeMovieClip()
    const minifeuxSym: SymbolDefinition = {
      name: "minifeux",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux"),
      anchorX: minifeuxAnchor.x,
      anchorY: minifeuxAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/onClipEvent(load)
        clip.alpha = 150 / 100;
        clip.vars.v = Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
        const v = clip.vars.v as number;
        clip.alpha = clip.alpha - 3.34 / 100;
        clip.x = clip.x + v;
        clip.vars.v = v;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_8_minifeux/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            // _X = _parent.boule._x / _Y = _parent.boule._y
            // In the spawning context (DefineSprite_26 enterFrame), position
            // is set by the caller via onLoad before frameScripts[0] fires,
            // so we skip the _parent.boule lookup here — position is already
            // set by the attach() transform or set by the spawner.
          },
        ],
        [
          33,
          (clip) => {
            // AS DefineSprite_8_minifeux/frame_34/DoAction.as
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_minifeux2 — spark with random alpha, used by feux frame_8 ----
    // AS DefineSprite_7_minifeux2/frame_1/DoAction.as:
    //   _rotation = random(360)
    // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/onClipEvent(load):
    //   _alpha = random(150); v = Math.random()
    // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame):
    //   _alpha -= 3.34; _X += v
    // AS DefineSprite_7_minifeux2/frame_34/DoAction.as:
    //   this.removeMovieClip()
    this.minifeux2Sym = {
      name: "minifeux2",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux2"),
      anchorX: minifeux2Anchor.x,
      anchorY: minifeux2Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/onClipEvent(load)
        clip.alpha = Math.floor(Math.random() * 150) / 100;
        clip.vars.v = Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
        const v = clip.vars.v as number;
        clip.alpha = clip.alpha - 3.34 / 100;
        clip.x = clip.x + v;
        clip.vars.v = v;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_7_minifeux2/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          33,
          (clip) => {
            // AS DefineSprite_7_minifeux2/frame_34/DoAction.as
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_minifeux3 — 78-frame spark with parent alpha flicker ----
    // AS DefineSprite_6_minifeux3/frame_1/DoAction.as:
    //   _rotation = random(360)
    // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/onClipEvent(load):
    //   _alpha = random(150); v = 0.67 + 1 * Math.random()
    // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame):
    //   _parent._alpha = random(100); _alpha -= 1.6; _X += (v *= 0.85)
    // AS DefineSprite_6_minifeux3/frame_76/DoAction.as:
    //   this.removeMovieClip()
    this.minifeux3Sym = {
      name: "minifeux3",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux3"),
      anchorX: minifeux3Anchor.x,
      anchorY: minifeux3Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/onClipEvent(load)
        clip.alpha = Math.floor(Math.random() * 150) / 100;
        clip.vars.v = 0.67 + 1 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
        const v = clip.vars.v as number;
        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }
        clip.alpha = clip.alpha - 1.6 / 100;
        const newV = v * 0.85;
        clip.x = clip.x + newV;
        clip.vars.v = newV;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6_minifeux3/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          75,
          (clip) => {
            // AS DefineSprite_6_minifeux3/frame_76/DoAction.as
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_minifeux4 — 78-frame large angled spark ----
    // AS DefineSprite_3_minifeux4/frame_1/DoAction.as: (empty)
    // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/onClipEvent(load):
    //   angle=90; _alpha=random(150); v=-1.6-3.34*Math.random(); vr=-0.5+Math.random()
    // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/onClipEvent(enterFrame):
    //   _rotation = angle * 57.29...; angle += vr; _parent._alpha = random(100);
    //   _alpha -= 1.6; _Y += (v *= 0.85); vx=v*cos(angle); vy=v*sin(angle);
    //   _X += vx; _Y += vy
    // AS DefineSprite_3_minifeux4/frame_76/DoAction.as:
    //   this.removeMovieClip()
    this.minifeux4Sym = {
      name: "minifeux4",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux4"),
      anchorX: minifeux4Anchor.x,
      anchorY: minifeux4Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/onClipEvent(load)
        clip.vars.angle = 90;
        clip.alpha = Math.floor(Math.random() * 150) / 100;
        clip.vars.v = -1.6 - 3.34 * Math.random();
        clip.vars.vr = -0.5 + Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/onClipEvent(enterFrame)
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;
        const vr = clip.vars.vr as number;

        // AS: _rotation = angle * 57.29746936176985 (converts radians to degrees then Flash uses degrees)
        // But angle starts at 90 and vr is ~radians, so the AS does:
        // _rotation (Flash degrees) = angle * 57.29... → angle is in radians
        clip.rotation = angle * 57.29746936176985 * (Math.PI / 180);
        angle += vr;

        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }
        clip.alpha = clip.alpha - 1.6 / 100;

        v = v * 0.85;
        clip.y = clip.y + v;

        const vx = v * Math.cos(angle);
        const vy = v * Math.sin(angle);
        clip.x = clip.x + vx;
        clip.y = clip.y + vy;

        clip.vars.angle = angle;
        clip.vars.v = v;
      },
      frameScripts: new Map([
        [
          75,
          (clip) => {
            // AS DefineSprite_3_minifeux4/frame_76/DoAction.as
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_feux — 16-frame composite firework burst ----
    // AS DefineSprite_23_feux/frame_1/DoAction.as:
    //   gotoAndStop(_parent._parent._parent.level + 1)
    //
    // The feux symbol has multiple frame behaviors selected by level.
    // _parent chain: feux → DefineSprite_28 child → DefineSprite_31 → root
    // So _parent._parent._parent.level = root.vars.level
    //
    // Each frame hosts a particle with onClipEvent(load/enterFrame).
    // We model each particle behavior in the frameScripts for the
    // corresponding frame, hooking onLoad/onEnterFrame onto the feux
    // clip itself (since there's one inner particle per frame mode).
    //
    // For simplicity we model the feux clip as a single SymbolDefinition
    // whose frameScripts[0] jumps to the level-appropriate frame, and
    // the onLoad/onEnterFrame handle the selected particle physics via
    // mode stored in clip.vars.mode.
    const self = this;
    const feuxSym: SymbolDefinition = {
      name: "feux",
      totalFrames: 16,
      frames: textures.getFrames("lib_feux"),
      anchorX: feuxAnchor.x,
      anchorY: feuxAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_23_feux/frame_1/DoAction.as:
            //   gotoAndStop(_parent._parent._parent.level + 1)
            // feux._parent = DefineSprite_28 child clip
            // DefineSprite_28._parent = DefineSprite_31 (outer spell sprite)
            // DefineSprite_31._parent = root
            const outerMc = clip.parent?.parent?.parent ?? clip.parent?.parent ?? clip.parent;
            const level = (outerMc?.vars.level as number) ?? (ctx.level ?? 1);
            const targetFrame = level + 1 - 1; // gotoAndStop is 1-based
            const clamped = Math.max(0, Math.min(15, targetFrame));
            clip.gotoAndStop(clamped);
            // Initialize particle state for whichever mode we landed on
            self.initFeuxParticle(clip, ctx, clamped + 1); // pass 1-based frame
          },
        ],
      ]),
      onLoad: (clip, ctx) => {
        // Will be re-initialized via frame_1 script above; pre-init defaults
        clip.vars.feuxMode = 0;
        clip.vars.t = 0;
        clip.vars.g = 0;
        clip.vars.va = 0;
        clip.vars.vx = 0;
        clip.vars.vy = 0;
        clip.vars.accx = 1;
        clip.vars.accy = 1;
        clip.vars.acc = 1;
        clip.vars.vacc = 1;
        clip.vars.d = 100;
        clip.vars.c = 0;
        clip.vars.compte = 0;
        clip.vars.angle = 0;
        clip.vars.vit = 0;
        clip.vars.frein = 0.9;
        clip.vars.vr = 0;
        clip.vars.sz = 100;
        clip.vars.frangle = 1.2;
      },
      onEnterFrame: (clip, ctx) => {
        const mode = clip.vars.feuxMode as number;
        if (mode === 0) {
          return;
        }
        self.tickFeuxParticle(clip, ctx, mode);
      },
    };

    this.registry.register(minifeuxSym);
    this.registry.register(this.minifeux2Sym);
    this.registry.register(this.minifeux3Sym);
    this.registry.register(this.minifeux4Sym);
    this.registry.register(feuxSym);

    // ---- DefineSprite_28 — container that hosts feux children ----
    // AS DefineSprite_28/frame_2/DoAction.as: stop()
    // DefineSprite_31/frame_76/PlaceObject2_28_3/onClipEvent(load):
    //   sz = 60 + 20 * ((level-1)%3); scale self
    //   i = 1; while (i < 6 + 7*((level-1)%3)) { attachMovie("feux","feux"+i,i); i++ }
    const self2 = this;
    const sprite28Sym: SymbolDefinition = {
      name: "sprite28",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_31/frame_76/PlaceObject2_28_3/onClipEvent(load)
        const outerMc = clip.parent;
        const level = (outerMc?.vars.level as number) ?? (ctx.level ?? 1);
        const sz = 60 + 20 * ((level - 1) % 3);
        clip.scaleX = sz / 100;
        clip.scaleY = sz / 100;
        const limit = 6 + 7 * ((level - 1) % 3);
        const feuxSymDef = self2.registry.resolve("feux");
        if (feuxSymDef) {
          for (let i = 1; i < limit; i++) {
            clip.attach(feuxSymDef, `feux${i}`, i, ctx);
          }
        }
      },
      frameScripts: new Map([
        [
          1,
          (clip) => {
            // AS DefineSprite_28/frame_2/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };
    this.registry.register(sprite28Sym);

    // ---- DefineSprite_31 — outer spell mc (97-frame firework) ----
    // AS DefineSprite_31/frame_1/DoAction.as: SOMA.playSound("fireworks01")
    // AS DefineSprite_31/frame_1/DoAction_2.as:
    //   taille = 80 + random(40); _xscale = _yscale = taille
    //   _rotation = -20 + random(40); compte = 1
    // AS DefineSprite_31/frame_70/DoAction.as: SOMA.playSound("explo_fireworks")
    // AS DefineSprite_31/frame_97/DoAction.as: stop()
    // frame_76 places DefineSprite_28 child (sprite28) at depth 3
    const outerSym: SymbolDefinition = {
      name: "outer",
      totalFrames: 97,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_31/frame_1/DoAction_2.as
            const taille = 80 + Math.floor(Math.random() * 40);
            clip.scaleX = taille / 100;
            clip.scaleY = taille / 100;
            clip.rotation = ((-20 + Math.floor(Math.random() * 40)) * Math.PI) / 180;
            clip.vars.compte = 1;
            // Store level on clip.vars for feux to read
            clip.vars.level = self2.root.vars.level;
          },
        ],
        [
          69,
          () => {
            // AS DefineSprite_31/frame_70/DoAction.as: SOMA.playSound("explo_fireworks")
            self2.playSoundFn?.("explo_fireworks");
            self2.runtime.signalHit();
          },
        ],
        [
          75,
          (clip, ctx) => {
            // frame_76: PlaceObject2_28_3 onClipEvent(load) — attach sprite28
            const sprite28Def = self2.registry.resolve("sprite28");
            if (sprite28Def) {
              clip.attach(sprite28Def, "sprite28", 3, ctx);
            }
          },
        ],
        [
          96,
          (clip) => {
            // AS DefineSprite_31/frame_97/DoAction.as: stop()
            clip.stop();
            clip.remove();
            self2.runtime.complete();
          },
        ],
      ]),
    };
    this.registry.register(outerSym);
  }

  /**
   * Initialize feux particle state based on the selected frame (1-based AS frame).
   * Called from frame_1 script of the feux clip after gotoAndStop.
   */
  private initFeuxParticle(clip: import("@dofus/spell-runtime").SpellClip, ctx: import("@dofus/spell-runtime").SpellContext, frame1Based: number): void {
    clip.vars.feuxMode = frame1Based;
    clip.vars.c = 0;

    if (frame1Based === 2) {
      // AS DefineSprite_23_feux/frame_2/PlaceObject2_12_1/onClipEvent(load)
      if (clip.parent) {
        clip.parent.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      }
      clip.vars.g = 1 * Math.random();
      clip.vars.va = 0;
      const t = 100 + Math.floor(Math.random() * 100);
      clip.vars.t = t;
      clip.scaleX = t / 100;
      clip.scaleY = t / 100;
      clip.vars.dmax = 100;
      clip.x = 10 + Math.floor(Math.random() * 20);
      clip.vars.d = 100 - Math.floor(Math.random() * 70);
      clip.vars.acc = 3.34 + Math.random() * 5;
      clip.vars.vacc = 1 + 1 * Math.random();
    } else if (frame1Based === 5) {
      // AS DefineSprite_23_feux/frame_5/PlaceObject2_14_1/onClipEvent(load)
      if (clip.parent) {
        clip.parent.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      }
      clip.vars.g = 0.6 * Math.random();
      clip.vars.va = 0;
      const t = 200 + Math.floor(Math.random() * 100);
      clip.vars.t = t;
      clip.scaleX = t / 100;
      clip.scaleY = t / 100;
      clip.vars.dmax = 100;
      clip.x = 10 + Math.floor(Math.random() * 20);
      clip.vars.d = 100 - Math.floor(Math.random() * 70);
      clip.vars.acc = 1.67 + Math.random() * 5;
      clip.vars.vacc = 1 + 1 * Math.random();
    } else if (frame1Based === 8) {
      // AS DefineSprite_23_feux/frame_8/PlaceObject2_12_1/onClipEvent(load)
      clip.vars.g = 0.67 * Math.random();
      clip.vars.va = 0;
      const t = 100 + Math.floor(Math.random() * 100);
      clip.vars.t = t;
      clip.scaleX = t / 100;
      clip.scaleY = t / 100;
      clip.vars.dmax = 100;
      clip.vars.d = 100 - Math.floor(Math.random() * 70);
      clip.vars.acc = 1.67 + Math.random() * 5;
      clip.vars.vacc = 1 + 1 * Math.random();
      clip.vars.vx = 10 * (-0.5 + Math.random());
      clip.vars.vy = 10 * (-0.5 + Math.random());
      clip.vars.accx = 0.8 + 0.1 * Math.random();
      clip.vars.accy = 0.8 + 0.1 * Math.random();
      clip.vars.compte = Math.floor(Math.random() * 200000);
    } else if (frame1Based === 11) {
      // AS DefineSprite_23_feux/frame_11/PlaceObject2_19_1/onClipEvent(load)
      clip.stop();
      clip.vars.g = 0.67 * Math.random();
      clip.vars.va = 0;
      const t = 100 + Math.floor(Math.random() * 100);
      clip.vars.t = t;
      clip.scaleX = t / 100;
      clip.scaleY = t / 100;
      clip.vars.dmax = 100;
      clip.x = -10 + Math.floor(Math.random() * 20);
      clip.vars.d = 100 - Math.floor(Math.random() * 70);
      clip.vars.acc = 1.67 + Math.random() * 5;
      clip.vars.vacc = 1.5 + 1.5 * Math.random();
      clip.vars.vx = 20 * (-0.5 + Math.random());
      clip.vars.vy = 20 * (-0.5 + Math.random());
      clip.vars.accx = 0.8 + 0.1 * Math.random();
      clip.vars.accy = 0.8 + 0.1 * Math.random();
    } else if (frame1Based === 14) {
      // AS DefineSprite_23_feux/frame_14/PlaceObject2_22_1/onClipEvent(load)
      // nbr=1; while(nbr<2) { attachMovie("minifeux4",...) } — spawn one minifeux4
      const parent = clip.parent;
      const outerMc = parent?.parent?.parent ?? parent?.parent ?? parent;
      const cx = clip.x;
      const cy = clip.y + (parent ? parent.y : 0);
      const mf4 = this.minifeux4Sym;
      if (outerMc && mf4) {
        const compte = Math.floor(Math.random() * 300000);
        const child = outerMc.attach(mf4, `minifeux4_${compte}`, compte, ctx);
        child.x = cx;
        child.y = cy;
      }

      clip.vars.angle = -1.1415 + 0.2 * (-0.5 + Math.random());
      clip.vars.vit = 2 + 10 * Math.random();
      clip.stop();
      clip.vars.frein = 0.9 + 0.05 * Math.random();
      clip.vars.vr = 0;
      clip.vars.sz = 240 + Math.floor(Math.random() * 120);
      clip.vars.frangle = 1.2;
      clip.vars.c = 0;
    }
  }

  /**
   * Tick feux particle physics per onEnterFrame, keyed by mode (1-based AS frame).
   */
  private tickFeuxParticle(clip: import("@dofus/spell-runtime").SpellClip, ctx: import("@dofus/spell-runtime").SpellContext, mode: number): void {
    if (mode === 2) {
      // AS DefineSprite_23_feux/frame_2/PlaceObject2_12_1/onClipEvent(enterFrame)
      let t = clip.vars.t as number;
      let va = clip.vars.va as number;
      const vacc = clip.vars.vacc as number;
      const g = clip.vars.g as number;
      const d = clip.vars.d as number;
      const acc = clip.vars.acc as number;

      clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      t = 20 + Math.floor(Math.random() * 80);
      clip.scaleX = t / 100;
      clip.scaleY = t / 100;
      if (clip.parent) {
        clip.parent.y += g;
      }
      va += vacc;
      clip.alpha = (150 - va) / 100;
      clip.x = clip.x - (clip.x - d) / acc;

      clip.vars.t = t;
      clip.vars.va = va;

      if (clip.alpha < 0) {
        if (clip.parent) {
          clip.parent.remove();
        }
      }
    } else if (mode === 5) {
      // AS DefineSprite_23_feux/frame_5/PlaceObject2_14_1/onClipEvent(enterFrame)
      let t = clip.vars.t as number;
      const g = clip.vars.g as number;
      const d = clip.vars.d as number;
      const acc = clip.vars.acc as number;

      clip.rotation = clip.rotation + (t / 6) * (Math.PI / 180);
      t--;
      clip.scaleX = t / 3 / 100;
      clip.scaleY = t / 3 / 100;
      if (clip.parent) {
        clip.parent.y += g;
      }
      clip.x = clip.x - (clip.x - d) / acc;

      clip.vars.t = t;

      if (t < 0) {
        if (clip.parent) {
          clip.parent.remove();
        }
      }
    } else if (mode === 8) {
      // AS DefineSprite_23_feux/frame_8/PlaceObject2_12_1/onClipEvent(enterFrame)
      let t = clip.vars.t as number;
      let vx = clip.vars.vx as number;
      let vy = clip.vars.vy as number;
      const g = clip.vars.g as number;
      const accx = clip.vars.accx as number;
      const accy = clip.vars.accy as number;
      let c = clip.vars.c as number;

      if (Math.floor(Math.random() * 15) === 1) {
        const parent = clip.parent;
        const outerMc = parent?.parent?.parent ?? parent?.parent ?? parent;
        const cx = clip.x;
        const cy = clip.y + (parent ? parent.y : 0);
        const compte = Math.floor(Math.random() * 200000);
        const mf2 = this.minifeux2Sym;
        if (outerMc && mf2) {
          const child = outerMc.attach(mf2, `minifeux2_${compte}`, compte, ctx);
          child.x = cx;
          child.y = cy;
          child.alpha = (100 - c) / 100;
          c++;
        }
        clip.vars.compte = compte;
      }

      clip.rotation = clip.rotation + (t / 3) * (Math.PI / 180);
      t--;
      clip.scaleX = t / 3 / 100;
      clip.scaleY = t / 3 / 100;
      if (clip.parent) {
        clip.parent.y += g;
      }
      vx = vx * accx;
      vy = vy * accy;
      clip.x = clip.x + vx;
      clip.y = clip.y + vy;

      clip.vars.t = t;
      clip.vars.vx = vx;
      clip.vars.vy = vy;
      clip.vars.c = c;

      if (t < 0) {
        if (clip.parent) {
          clip.parent.remove();
        }
      }
    } else if (mode === 11) {
      // AS DefineSprite_23_feux/frame_11/PlaceObject2_19_1/onClipEvent(enterFrame)
      let t = clip.vars.t as number;
      let vx = clip.vars.vx as number;
      let vy = clip.vars.vy as number;
      const g = clip.vars.g as number;
      const accx = clip.vars.accx as number;
      const accy = clip.vars.accy as number;
      let c = clip.vars.c as number;

      if (t < 150) {
        clip.play();
      }
      if (t < 135) {
        const parent = clip.parent;
        const outerMc = parent?.parent?.parent ?? parent?.parent ?? parent;
        const cx = clip.x;
        const cy = clip.y + (parent ? parent.y : 0);
        const mf3 = this.minifeux3Sym;
        if (outerMc && mf3) {
          for (let nbr = 1; nbr < 10; nbr++) {
            const compte = Math.floor(Math.random() * 200000);
            const child = outerMc.attach(mf3, `minifeux3_${compte}`, compte, ctx);
            child.x = cx;
            child.y = cy;
            child.alpha = (100 - c) / 100;
            c++;
          }
        }
        if (clip.parent) {
          clip.parent.remove();
        }
        clip.vars.c = c;
        return;
      }

      clip.rotation = clip.rotation + (t / 3) * (Math.PI / 180);
      t--;
      clip.scaleX = t / 3 / 100;
      clip.scaleY = t / 3 / 100;
      if (clip.parent) {
        clip.parent.y += g;
      }
      vx = vx * accx;
      vy = vy * accy;
      clip.x = clip.x + vx;
      clip.y = clip.y + vy;

      clip.vars.t = t;
      clip.vars.vx = vx;
      clip.vars.vy = vy;
      clip.vars.c = c;
    } else if (mode === 14) {
      // AS DefineSprite_23_feux/frame_14/PlaceObject2_22_1/onClipEvent(enterFrame)
      let angle = clip.vars.angle as number;
      let vit = clip.vars.vit as number;
      let vr = clip.vars.vr as number;
      let sz = clip.vars.sz as number;
      let frangle = clip.vars.frangle as number;
      const frein = clip.vars.frein as number;
      let t = clip.vars.t as number;
      let c = clip.vars.c as number;

      // AS: _rotation = angle * 57.29746936176985 (angle in radians → Flash degrees → back to radians)
      clip.rotation = angle * 57.29746936176985 * (Math.PI / 180);
      clip.alpha = (50 + Math.floor(Math.random() * 60)) / 100;
      sz = sz * (frein + 0.02);
      clip.scaleX = sz / 100;
      clip.scaleY = sz / 100;

      if (Math.floor(Math.random() * 24) === 1) {
        vr = 0.67 * (-0.5 + Math.random());
      }
      angle += vr * frangle;
      frangle = frangle * frein;

      const vx = vit * Math.cos(angle);
      const vy = vit * Math.sin(angle);
      clip.x = clip.x + vx;
      clip.y = clip.y + vy;
      vit = vit * frein;

      if (t < 150) {
        clip.play();
      }
      if (t < 135) {
        const parent = clip.parent;
        const outerMc = parent?.parent?.parent ?? parent?.parent ?? parent;
        const cx = clip.x;
        const cy = clip.y + (parent ? parent.y : 0);
        const mf3 = this.minifeux3Sym;
        if (outerMc && mf3) {
          for (let nbr = 1; nbr < 10; nbr++) {
            const compte = Math.floor(Math.random() * 300000);
            const child = outerMc.attach(mf3, `minifeux3_${compte}`, compte, ctx);
            child.x = cx;
            child.y = cy;
            child.alpha = (100 - c) / 100;
            c++;
          }
        }
        if (clip.parent) {
          clip.parent.remove();
        }
        clip.vars.c = c;
        return;
      }

      clip.vars.angle = angle;
      clip.vars.vit = vit;
      clip.vars.vr = vr;
      clip.vars.sz = sz;
      clip.vars.frangle = frangle;
      clip.vars.t = t;
      clip.vars.c = c;
    }
  }

  protected onSpellStart(callbacks: SpellCallbacks, context: SpellContext): void {
    // AS DefineSprite_31/frame_1/DoAction.as: SOMA.playSound("fireworks01")
    callbacks.playSound("fireworks01");
    this.playSoundFn = callbacks.playSound;

    // Attach the outer spell sprite (DefineSprite_31) to root.
    // This drives the full 97-frame firework timeline.
    const outerSym = this.registry.resolve("outer");
    if (outerSym) {
      this.root.attach(outerSym, "outer", 1, context);
    }
  }
}
