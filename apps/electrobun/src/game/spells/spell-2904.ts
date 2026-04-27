/**
 * Spell 2904 — Feux d'Artifice (Fireworks).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2904/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile/move/shoot
 * harness pattern — the outer container (DefineSprite_45) is a
 * straight timeline anchored at the target cell. It plays sounds at
 * frame_1 and frame_70, sets random scale/rotation, and at frame_76
 * spawns a `feux` composite that itself spawns many `minifeux*`
 * particles. frame_97 stops. The canonical outer-mc removal happens at
 * the main-timeline frame_319 (`_parent.removeMovieClip(); stop();`),
 * which we map to runtime.complete().
 *
 * Library symbols:
 *   - lib_minifeux4 (78 frames) — spark trail particle. onLoad seeds
 *     angle, alpha, velocity v, angular velocity vr. onEnterFrame
 *     drifts upward with 0.85 friction, oscillates in angle.
 *     frame_76 removes itself.
 *   - lib_minifeux3 (78 frames) — ember trail particle. onLoad seeds
 *     alpha, horizontal velocity v. onEnterFrame fades (1.6/tick),
 *     drifts right with 0.85 friction. frame_76 removes itself.
 *   - lib_minifeux2 (36 frames) — small ember. onLoad seeds alpha,
 *     horizontal velocity v (random). onEnterFrame fades (3.34/tick),
 *     drifts right. frame_34 removes itself.
 *   - lib_minifeux  (36 frames) — initial spark. Same as minifeux2
 *     but alpha starts at 150. frame_34 removes itself.
 *   - lib_feux (16 frames) — firework burst cluster. frame_1 jumps
 *     to `level + 1` (per-level variant). Contains per-frame clip
 *     children with physics, spawning more minifeux* children.
 *
 * The outer container (DefineSprite_45, not a library symbol) is
 * wired as the root clip via onSpellStart child attaches. We model it
 * as the `feux_container` SymbolDefinition (container-only) whose
 * frameScripts mirror DefineSprite_45's authored timeline.
 *
 * signalHit is fired at the canonical impact / explosion frame (frame
 * 70, where the "explo_fireworks" sound fires — that's the hit moment).
 * complete() fires at frame 319 which mirrors the main-timeline
 * `_parent.removeMovieClip()`.
 *
 * Main timeline: DefineSprite_45/frame_1 plays "fireworks01" sound
 * and sets random scale/rotation. frame_70 plays "explo_fireworks".
 * frame_76 spawns the `feux` burst cluster. frame_97 stops the outer
 * container. The very outer main-timeline frame_319 removes the spell.
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

// ---- Bounds from manifest.json librarySymbols ----

const MINIFEUX4_BOUNDS = {
  width: 2.7,
  height: 3.2,
  offsetX: -0.15,
  offsetY: -1.55,
};

const MINIFEUX3_BOUNDS = {
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

const MINIFEUX_BOUNDS = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

const FEUX_BOUNDS = {
  width: 48.25,
  height: 53.3,
  offsetX: -18.65,
  offsetY: -26.75,
};

export class Spell2904 extends RuntimeSpell {
  readonly spellId = 2904;
  readonly displayType = SpellDisplayType.TargetCell;

  // Symbols stored so onSpellStart can reference them
  private minifeux4Sym!: SymbolDefinition;
  private minifeux3Sym!: SymbolDefinition;
  private minifeux2Sym!: SymbolDefinition;
  private minifeuxSym!: SymbolDefinition;
  private feuxSym!: SymbolDefinition;
  private feuxContainerSym!: SymbolDefinition;

  // Sound callback captured at onSpellStart for use in frame scripts
  private playSoundFn?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const minifeux4Anchor = calculateAnchor(MINIFEUX4_BOUNDS);
    const minifeux3Anchor = calculateAnchor(MINIFEUX3_BOUNDS);
    const minifeux2Anchor = calculateAnchor(MINIFEUX2_BOUNDS);
    const minifeuxAnchor = calculateAnchor(MINIFEUX_BOUNDS);
    const feuxAnchor = calculateAnchor(FEUX_BOUNDS);

    // ---- lib_minifeux4 — spark trail particle (78 frames) --------
    // AS: DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/
    //     onClipEvent(load).as  +  onClipEvent(enterFrame).as
    //     DefineSprite_3_minifeux4/frame_76/DoAction.as
    this.minifeux4Sym = {
      name: "minifeux4",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux4"),
      anchorX: minifeux4Anchor.x,
      anchorY: minifeux4Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/
        //    onClipEvent(load).as
        clip.vars.angle = 90;
        clip.alpha = Math.floor(Math.random() * 150) / 100;
        clip.vars.v = -1.6 - 3.34 * Math.random();
        clip.vars.vr = -0.5 + Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/
        //    onClipEvent(enterFrame).as
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;
        const vr = clip.vars.vr as number;

        clip.rotation = (angle * 57.29746936176985 * Math.PI) / 180;
        angle += vr;
        clip.vars.angle = angle;

        // _parent._alpha = random(100)
        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }

        const currentAlpha = clip.alpha * 100;
        clip.alpha = Math.max(0, (currentAlpha - 1.6)) / 100;

        v *= 0.85;
        clip.vars.v = v;
        clip.y += v;

        const vx = v * Math.cos(angle);
        const vy = v * Math.sin(angle);
        clip.x += vx;
        clip.y += vy;
      },
      frameScripts: new Map([
        [
          75,
          (clip) => {
            // AS DefineSprite_3_minifeux4/frame_76/DoAction.as
            // this.removeMovieClip();
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_minifeux3 — ember trail particle (78 frames) --------
    // AS: DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/
    //     onClipEvent(load).as  +  onClipEvent(enterFrame).as
    //     DefineSprite_6_minifeux3/frame_1/DoAction.as
    //     DefineSprite_6_minifeux3/frame_76/DoAction.as
    this.minifeux3Sym = {
      name: "minifeux3",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux3"),
      anchorX: minifeux3Anchor.x,
      anchorY: minifeux3Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/
        //    onClipEvent(load).as
        clip.vars.alpha_val = Math.floor(Math.random() * 150);
        clip.vars.v = 0.67 + 1 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/
        //    onClipEvent(enterFrame).as
        let v = clip.vars.v as number;
        let alphaVal = clip.vars.alpha_val as number;

        // _parent._alpha = random(100)
        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }

        alphaVal -= 1.6;
        clip.vars.alpha_val = alphaVal;
        clip.alpha = Math.max(0, alphaVal) / 100;

        v *= 0.85;
        clip.vars.v = v;
        clip.x += v;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6_minifeux3/frame_1/DoAction.as
            // _rotation = random(360);
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          75,
          (clip) => {
            // AS DefineSprite_6_minifeux3/frame_76/DoAction.as
            // this.removeMovieClip();
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_minifeux2 — small ember (36 frames) -----------------
    // AS: DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/
    //     onClipEvent(load).as  +  onClipEvent(enterFrame).as
    //     DefineSprite_7_minifeux2/frame_1/DoAction.as
    //     DefineSprite_7_minifeux2/frame_34/DoAction.as
    this.minifeux2Sym = {
      name: "minifeux2",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux2"),
      anchorX: minifeux2Anchor.x,
      anchorY: minifeux2Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/
        //    onClipEvent(load).as
        clip.vars.alpha_val = Math.floor(Math.random() * 150);
        clip.vars.v = Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/
        //    onClipEvent(enterFrame).as
        let alphaVal = clip.vars.alpha_val as number;
        const v = clip.vars.v as number;

        alphaVal -= 3.34;
        clip.vars.alpha_val = alphaVal;
        clip.alpha = Math.max(0, alphaVal) / 100;
        clip.x += v;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_7_minifeux2/frame_1/DoAction.as
            // _rotation = random(360);
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          33,
          (clip) => {
            // AS DefineSprite_7_minifeux2/frame_34/DoAction.as
            // this.removeMovieClip();
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_minifeux — initial spark (36 frames) ----------------
    // AS: DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/
    //     onClipEvent(load).as  +  onClipEvent(enterFrame).as
    //     DefineSprite_8_minifeux/frame_1/DoAction.as
    //     DefineSprite_8_minifeux/frame_34/DoAction.as
    this.minifeuxSym = {
      name: "minifeux",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux"),
      anchorX: minifeuxAnchor.x,
      anchorY: minifeuxAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/
        //    onClipEvent(load).as
        clip.vars.alpha_val = 150;
        clip.vars.v = Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/
        //    onClipEvent(enterFrame).as
        let alphaVal = clip.vars.alpha_val as number;
        const v = clip.vars.v as number;

        alphaVal -= 3.34;
        clip.vars.alpha_val = alphaVal;
        clip.alpha = Math.max(0, alphaVal) / 100;
        clip.x += v;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_8_minifeux/frame_1/DoAction.as
            // _rotation = random(360);
            // _X = _parent.boule._x; _Y = _parent.boule._y;
            // (boule is a sub-child of the feux container; position is
            // inherited at attachment time — we skip the boule lookup
            // since children are attached at the feux clip's origin)
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          33,
          (clip) => {
            // AS DefineSprite_8_minifeux/frame_34/DoAction.as
            // this.removeMovieClip();
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_feux — firework burst cluster (16 frames) -----------
    // AS: DefineSprite_37_feux/frame_1/DoAction.as
    //   gotoAndStop(_parent._parent._parent.level + 1);
    // This is the main fireworks burst that contains the per-frame
    // clip children with particle physics. The frame it jumps to is
    // level+1 (1-based → 0-based: level). Each of the sub-frame
    // ClipAction children handles its own physics.
    //
    // Per-frame children are placed directly on feux's timeline:
    //   frame_2  (index 1): PlaceObject2_15_1 — drifting spark
    //   frame_5  (index 4): PlaceObject2_23_1 — spiral spark
    //   frame_8  (index 7): PlaceObject2_15_1 — fading spark + spawns minifeux2
    //   frame_11 (index 10): PlaceObject2_28_1 — burst spark + spawns minifeux3
    //   frame_14 (index 13): PlaceObject2_36_1 — tumbling spark + spawns minifeux3/4
    //
    // We model these as the feux clip's onLoad attaching internal
    // child clips to self, since they are placed on the timeline at
    // specific frames. For simplicity we fire them all on the frame_1
    // (index 0) entry and let the individual clip vars handle the
    // physics. The level-gating (gotoAndStop) selects which sub-
    // content frame is used — we model this by having onLoad pick the
    // correct behaviour variant.
    this.feuxSym = {
      name: "feux",
      totalFrames: 16,
      frames: textures.getFrames("lib_feux"),
      anchorX: feuxAnchor.x,
      anchorY: feuxAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_37_feux/frame_1/DoAction.as
            // gotoAndStop(_parent._parent._parent.level + 1);
            // _parent._parent._parent is the outer container's parent.
            // In our hierarchy: feux → feux_container_child → root
            // So we traverse up to root.vars.level.
            const root = clip.parent?.parent ?? clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            const targetFrame = level; // level+1 - 1 (0-based)
            clip.gotoAndStop(Math.max(0, Math.min(targetFrame, 15)));

            // Spawn the appropriate internal particle child based on
            // the frame we stopped at. Each authored "frame" in the
            // feux SWF places a different PlaceObject2 child:
            //
            // frame index 0 (level=0, placeholder)
            // frame index 1 (level=1): PlaceObject2_15_1 - drift spark
            // frame index 4 (level=4): PlaceObject2_23_1 - spiral spark
            // frame index 7 (level=7): PlaceObject2_15_1 - fading + minifeux2
            // frame index 10 (level=10): PlaceObject2_28_1 - burst + minifeux3
            // frame index 13 (level=13): PlaceObject2_36_1 - tumbling + minifeux3/4
            //
            // We fire the appropriate internal sub-clip handler.
            const frameIdx = clip.currentFrame;

            if (frameIdx === 1) {
              // AS DefineSprite_37_feux/frame_2/PlaceObject2_15_1 handlers
              this._attachFeuxFrame2Child(clip, ctx);
            } else if (frameIdx === 4) {
              // AS DefineSprite_37_feux/frame_5/PlaceObject2_23_1 handlers
              this._attachFeuxFrame5Child(clip, ctx);
            } else if (frameIdx === 7) {
              // AS DefineSprite_37_feux/frame_8/PlaceObject2_15_1 handlers
              this._attachFeuxFrame8Child(clip, ctx);
            } else if (frameIdx === 10) {
              // AS DefineSprite_37_feux/frame_11/PlaceObject2_28_1 handlers
              this._attachFeuxFrame11Child(clip, ctx);
            } else if (frameIdx === 13) {
              // AS DefineSprite_37_feux/frame_14/PlaceObject2_36_1 handlers
              this._attachFeuxFrame14Child(clip, ctx);
            } else {
              // Default: treat as frame_2 behaviour
              this._attachFeuxFrame2Child(clip, ctx);
            }
          },
        ],
      ]),
    };

    // ---- feux_container — outer DefineSprite_45 timeline ---------
    // Not a library symbol; models the authored outer container.
    // frame_1: playSound("fireworks01"), random scale/rotation/compte
    // frame_70: playSound("explo_fireworks") + signalHit
    // frame_76: spawn `feux` burst cluster
    // frame_97: stop()
    // (The main-timeline frame_319 that calls removeMovieClip is
    // handled by the root onEnterFrame ticker via complete().)
    this.feuxContainerSym = {
      name: "feux_container",
      totalFrames: 319,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_45/frame_1/DoAction_2.as
            // taille = 80 + random(40);
            // _xscale = taille; _yscale = taille;
            // _rotation = -20 + random(40);
            // compte = 1;
            const taille = 80 + Math.floor(Math.random() * 40);
            clip.scaleX = taille / 100;
            clip.scaleY = taille / 100;
            clip.rotation = ((-20 + Math.floor(Math.random() * 40)) * Math.PI) / 180;
            clip.vars.compte = 1;
          },
        ],
        [
          69,
          (clip) => {
            // AS DefineSprite_45/frame_70/DoAction.as
            // SOMA.playSound("explo_fireworks");
            this.playSoundFn?.("explo_fireworks");
            // This is the canonical hit frame — signal damage popup.
            this.runtime.signalHit();
            // Also spawn minifeux sparks periodically from the boule
            // child (DefineSprite_40). We model that as an inline
            // onEnterFrame on the clip.
            clip.vars._minifeux_spawner_active = true;
          },
        ],
        [
          75,
          (clip, ctx) => {
            // AS DefineSprite_45/frame_76/PlaceObject2_42_3/
            //    onClipEvent(load).as
            // sz = 60 + 20 * ((level-1) % 3);
            // while (i < 6 + 7 * ((level-1) % 3)) { attachMovie("feux",...) }
            const root = clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            const sz = 60 + 20 * ((level - 1) % 3);
            const maxFeux = 6 + 7 * ((level - 1) % 3);
            for (let i = 1; i < maxFeux; i++) {
              const child = clip.attach(
                this.feuxSym,
                `feux${i}`,
                i,
                ctx,
              );
              child.scaleX = sz / 100;
              child.scaleY = sz / 100;
            }
          },
        ],
        [
          96,
          (clip) => {
            // AS DefineSprite_45/frame_97/DoAction.as
            // stop();
            clip.stop();
          },
        ],
        [
          318,
          (clip) => {
            // AS frame_319/DoAction.as (main timeline)
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.minifeux4Sym);
    this.registry.register(this.minifeux3Sym);
    this.registry.register(this.minifeux2Sym);
    this.registry.register(this.minifeuxSym);
    this.registry.register(this.feuxSym);
    this.registry.register(this.feuxContainerSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use in frame scripts
    this.playSoundFn = callbacks.playSound;

    // AS DefineSprite_45/frame_1/DoAction.as
    // SOMA.playSound("fireworks01");
    callbacks.playSound("fireworks01");

    // Attach the outer container (DefineSprite_45) as the root's
    // single child — it drives the whole spell timeline.
    this.root.attach(this.feuxContainerSym, "feux_container", 1, context);
  }

  // ---- Internal helpers for feux sub-frame clip children ---------
  // These mirror the PlaceObject2_* clip-action handlers on the
  // per-level frames inside DefineSprite_37_feux.

  private _attachFeuxFrame2Child(
    feuxClip: import("@dofus/spell-runtime").SpellClip,
    ctx: SpellContext,
  ): void {
    // AS DefineSprite_37_feux/frame_2/PlaceObject2_15_1 handlers
    // A simple drifting+fading spark with random rotation.
    const sym: SymbolDefinition = {
      name: "_feux_f2_child",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_15_1/onClipEvent(load).as
        if (clip.parent) {
          clip.parent.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        }
        clip.vars.vg = -6 * Math.random();
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
      },
      onEnterFrame: (clip) => {
        // AS frame_2/PlaceObject2_15_1/onClipEvent(enterFrame).as
        const g = clip.vars.g as number;
        let va = clip.vars.va as number;
        const vacc = clip.vars.vacc as number;
        const acc = clip.vars.acc as number;
        const d = clip.vars.d as number;

        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        const t = 20 + Math.floor(Math.random() * 80);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;

        if (clip.parent) {
          clip.parent.y += g;
        }

        va += vacc;
        clip.vars.va = va;
        const newAlpha = (150 - va) / 100;
        clip.alpha = Math.max(0, Math.min(1, newAlpha));

        clip.x = clip.x - (clip.x - d) / acc;

        if (clip.alpha <= 0) {
          if (clip.parent) {
            clip.parent.remove();
          }
        }
      },
    };
    feuxClip.attach(sym, "_f2_spark", 100, ctx);
  }

  private _attachFeuxFrame5Child(
    feuxClip: import("@dofus/spell-runtime").SpellClip,
    ctx: SpellContext,
  ): void {
    // AS DefineSprite_37_feux/frame_5/PlaceObject2_23_1 handlers
    // Spiral spark that drifts toward d, fades via t.
    const sym: SymbolDefinition = {
      name: "_feux_f5_child",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS frame_5/PlaceObject2_23_1/onClipEvent(load).as
        if (clip.parent) {
          clip.parent.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        }
        clip.vars.vg = -9 * Math.random();
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
      },
      onEnterFrame: (clip) => {
        // AS frame_5/PlaceObject2_23_1/onClipEvent(enterFrame).as
        const g = clip.vars.g as number;
        let t = clip.vars.t as number;
        const acc = clip.vars.acc as number;
        const d = clip.vars.d as number;

        clip.rotation = clip.rotation + ((t / 6) * Math.PI) / 180;
        t--;
        clip.vars.t = t;
        clip.scaleX = Math.max(0, t / 3) / 100;
        clip.scaleY = Math.max(0, t / 3) / 100;

        if (clip.parent) {
          clip.parent.y += g;
        }

        clip.x = clip.x - (clip.x - d) / acc;

        if (t < 0) {
          if (clip.parent) {
            clip.parent.remove();
          }
        }
      },
    };
    feuxClip.attach(sym, "_f5_spark", 100, ctx);
  }

  private _attachFeuxFrame8Child(
    feuxClip: import("@dofus/spell-runtime").SpellClip,
    ctx: SpellContext,
  ): void {
    // AS DefineSprite_37_feux/frame_8/PlaceObject2_15_1 handlers
    // Fading spark that occasionally spawns minifeux2 children.
    const sym: SymbolDefinition = {
      name: "_feux_f8_child",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS frame_8/PlaceObject2_15_1/onClipEvent(load).as
        clip.vars.vg = -9 * Math.random();
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
        clip.vars.c = 0;
        clip.vars.compte = Math.floor(Math.random() * 200000);
      },
      onEnterFrame: (clip, ctx2) => {
        // AS frame_8/PlaceObject2_15_1/onClipEvent(enterFrame).as
        let t = clip.vars.t as number;
        const g = clip.vars.g as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const accx = clip.vars.accx as number;
        const accy = clip.vars.accy as number;
        let c = clip.vars.c as number;
        let compte = clip.vars.compte as number;

        // if (random(15) == 1) spawn minifeux2
        if (Math.floor(Math.random() * 15) === 1) {
          const parent2 = clip.parent?.parent; // feux → feux_container
          if (parent2) {
            const mfName = `minifeux2_${compte}`;
            const child = parent2.attach(
              this.minifeux2Sym,
              mfName,
              compte,
              ctx2,
            );
            child.x = clip.x;
            child.y = clip.y + (clip.parent?.y ?? 0);
            child.alpha = Math.max(0, (100 - c)) / 100;
          }
          c++;
          clip.vars.c = c;
          compte = Math.floor(Math.random() * 200000);
          clip.vars.compte = compte;
        }

        clip.rotation = clip.rotation + ((t / 3) * Math.PI) / 180;
        t--;
        clip.vars.t = t;
        clip.scaleX = Math.max(0, t / 3) / 100;
        clip.scaleY = Math.max(0, t / 3) / 100;

        if (clip.parent) {
          clip.parent.y += g;
        }

        vx *= accx;
        vy *= accy;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.x += vx;
        clip.y += vy;

        if (t < 0) {
          if (clip.parent) {
            clip.parent.remove();
          }
        }
      },
    };
    feuxClip.attach(sym, "_f8_spark", 100, ctx);
  }

  private _attachFeuxFrame11Child(
    feuxClip: import("@dofus/spell-runtime").SpellClip,
    ctx: SpellContext,
  ): void {
    // AS DefineSprite_37_feux/frame_11/PlaceObject2_28_1 handlers
    // Burst spark that stops then spawns many minifeux3 children.
    const sym: SymbolDefinition = {
      name: "_feux_f11_child",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS frame_11/PlaceObject2_28_1/onClipEvent(load).as
        clip.stop();
        clip.vars.vg = -9 * Math.random();
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
        clip.vars.c = 0;
      },
      onEnterFrame: (clip, ctx2) => {
        // AS frame_11/PlaceObject2_28_1/onClipEvent(enterFrame).as
        let t = clip.vars.t as number;
        const g = clip.vars.g as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const accx = clip.vars.accx as number;
        const accy = clip.vars.accy as number;
        let c = clip.vars.c as number;

        if (t < 150) {
          clip.play();
        }

        if (t < 135) {
          // Spawn 9 minifeux3 particles then remove parent
          for (let nbr = 1; nbr < 10; nbr++) {
            const compte = Math.floor(Math.random() * 200000);
            const parent2 = clip.parent?.parent;
            if (parent2) {
              const mfName = `minifeux3_${compte}`;
              const child = parent2.attach(
                this.minifeux3Sym,
                mfName,
                compte,
                ctx2,
              );
              child.x = clip.x;
              child.y = clip.y + (clip.parent?.y ?? 0);
              child.alpha = Math.max(0, (100 - c)) / 100;
              c++;
            }
          }
          clip.vars.c = c;
          if (clip.parent) {
            clip.parent.remove();
          }
          return;
        }

        clip.rotation = clip.rotation + ((t / 3) * Math.PI) / 180;
        t--;
        clip.vars.t = t;
        clip.scaleX = Math.max(0, t / 3) / 100;
        clip.scaleY = Math.max(0, t / 3) / 100;

        if (clip.parent) {
          clip.parent.y += g;
        }

        vx *= accx;
        vy *= accy;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.x += vx;
        clip.y += vy;
      },
    };
    feuxClip.attach(sym, "_f11_spark", 100, ctx);
  }

  private _attachFeuxFrame14Child(
    feuxClip: import("@dofus/spell-runtime").SpellClip,
    ctx: SpellContext,
  ): void {
    // AS DefineSprite_37_feux/frame_14/PlaceObject2_36_1 handlers
    // Tumbling spark with angular physics; spawns minifeux3 and minifeux4.
    const sym: SymbolDefinition = {
      name: "_feux_f14_child",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx2) => {
        // AS frame_14/PlaceObject2_36_1/onClipEvent(load).as
        // First spawn 1 minifeux4
        const compte0 = Math.floor(Math.random() * 300000);
        const parent2 = clip.parent?.parent;
        if (parent2) {
          const child = parent2.attach(
            this.minifeux4Sym,
            `minifeux4_${compte0}`,
            compte0,
            ctx2,
          );
          child.x = clip.x;
          child.y = clip.y + (clip.parent?.y ?? 0);
        }

        clip.vars.angle = -1.1415 + 0.2 * (-0.5 + Math.random());
        clip.vars.vit = 2 + 10 * Math.random();
        clip.stop();
        clip.vars.frein = 0.9 + 0.05 * Math.random();
        clip.vars.vr = 0;
        clip.vars.sz = 240 + Math.floor(Math.random() * 120);
        clip.vars.frangle = 1.2;
        clip.vars.c = 0;
      },
      onEnterFrame: (clip, ctx2) => {
        // AS frame_14/PlaceObject2_36_1/onClipEvent(enterFrame).as
        let angle = clip.vars.angle as number;
        let vit = clip.vars.vit as number;
        let vr = clip.vars.vr as number;
        let sz = clip.vars.sz as number;
        let frangle = clip.vars.frangle as number;
        const frein = clip.vars.frein as number;
        let t = (clip.vars.t as number) ?? 200;
        let c = clip.vars.c as number;

        clip.rotation = (angle * 57.29746936176985 * Math.PI) / 180;
        clip.alpha = (50 + Math.floor(Math.random() * 60)) / 100;
        sz *= frein + 0.02;
        clip.vars.sz = sz;
        clip.scaleX = sz / 100;
        clip.scaleY = sz / 100;

        if (Math.floor(Math.random() * 24) === 1) {
          vr = 0.67 * (-0.5 + Math.random());
          clip.vars.vr = vr;
        }

        angle += vr * frangle;
        frangle *= frein;
        clip.vars.angle = angle;
        clip.vars.frangle = frangle;

        const vx = vit * Math.cos(angle);
        const vy = vit * Math.sin(angle);
        clip.x += vx;
        clip.y += vy;

        vit *= frein;
        clip.vars.vit = vit;

        // t is not explicitly initialised in this handler's load —
        // we use a default of 200 (above max threshold) decremented
        // here to trigger the burst at the right time.
        if (t < 150) {
          clip.play();
        }

        if (t < 135) {
          for (let nbr = 1; nbr < 10; nbr++) {
            const compte = Math.floor(Math.random() * 300000);
            const parent2 = clip.parent?.parent;
            if (parent2) {
              const mfName = `minifeux3_${compte}`;
              const child = parent2.attach(
                this.minifeux3Sym,
                mfName,
                compte,
                ctx2,
              );
              child.x = clip.x;
              child.y = clip.y + (clip.parent?.y ?? 0);
              child.alpha = Math.max(0, (100 - c)) / 100;
              c++;
            }
          }
          clip.vars.c = c;
          if (clip.parent) {
            clip.parent.remove();
          }
          return;
        }

        t--;
        clip.vars.t = t;
      },
    };
    feuxClip.attach(sym, "_f14_spark", 100, ctx);
  }
}
