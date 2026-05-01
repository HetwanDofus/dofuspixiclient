/**
 * Spell 2904 — Feux d'Artifice (Fireworks).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2904/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile, no caster-to-target
 * motion, and no dual-anchored layout. The entire fireworks display is anchored
 * at the target cell. The outer sprite (DefineSprite_45) plays a 97-frame timeline
 * at the target, launching the `feux` firework burst symbol at frame 76, which
 * itself spawns minifeux2/3/4 particles. The main timeline completes at frame 319
 * via `_parent.removeMovieClip()`.
 *
 * Library symbols:
 *   - feux        — 16-frame firework burst composite. frame_1 dispatches to a
 *                   sub-frame based on level (gotoAndStop(level+1)). Each sub-frame
 *                   has a PlaceObject2 with clipEvents that drive a glowing ember
 *                   particle (spawn, drift, alpha fade, scale shrink, minifeux3 spawn
 *                   on burst). Frame variants (2/5/8/11/14) correspond to spell levels.
 *   - minifeux    — 36-frame spark particle. frame_1 seeds alpha/v, frame_34 removes.
 *   - minifeux2   — 36-frame spark particle. frame_1 seeds alpha/v, frame_34 removes.
 *   - minifeux3   — 78-frame long-lived spark particle. frame_1 seeds alpha/v, frame_76 removes.
 *   - minifeux4   — 78-frame long-lived spark particle. frame_1 seeds angle/alpha/v/vr, frame_76 removes.
 *   - sprite40    — clipEvent-driven "boule" (rocket trail). onLoad seeds c=1.
 *                   onEnterFrame randomly spawns minifeux and rotates.
 *
 * Main timeline (DefineSprite_45):
 *   frame_1:  SOMA.playSound("fireworks01"), set taille/scale/rotation/compte
 *   frame_70: SOMA.playSound("explo_fireworks")
 *   frame_76: attach feux burst (onClipEvent(load) spawns feux instances + sets sz/i)
 *   frame_97: stop()
 *   frame_319: _parent.removeMovieClip() + stop() → spell complete
 *
 * signalHit is fired at frame_70 (the explosion sound = impact frame).
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

// ---- Manifest bounds for calculateAnchor ----
const FEUX_BOUNDS = { width: 48.25, height: 53.3, offsetX: -18.65, offsetY: -26.75 };
const MINIFEUX_BOUNDS = { width: 2.45, height: 2.05, offsetX: 0.2, offsetY: -1.2 };
const MINIFEUX2_BOUNDS = { width: 2.45, height: 2.05, offsetX: 0.2, offsetY: -1.2 };
const MINIFEUX3_BOUNDS = { width: 2.45, height: 2.05, offsetX: 0.2, offsetY: -1.2 };
const MINIFEUX4_BOUNDS = { width: 2.7, height: 3.2, offsetX: -0.15, offsetY: -1.55 };
const SPRITE40_BOUNDS = { width: 3.75, height: 3.75, offsetX: -1.4, offsetY: -1.85 };

export class Spell2904 extends RuntimeSpell {
  readonly spellId = 2904;
  readonly displayType = SpellDisplayType.TargetCell;

  // Symbols stored as fields so onSpellStart can attach sprite45Sym
  private minifeux3Sym!: SymbolDefinition;
  private minifeux2Sym!: SymbolDefinition;
  private minifeux4Sym!: SymbolDefinition;
  private minifeuxSym!: SymbolDefinition;
  private feuxSym!: SymbolDefinition;
  private sprite40Sym!: SymbolDefinition;
  private sprite45Sym!: SymbolDefinition;

  // Sound callback captured in onSpellStart for use inside frameScripts
  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const feuxAnchor = calculateAnchor(FEUX_BOUNDS);
    const minifeuxAnchor = calculateAnchor(MINIFEUX_BOUNDS);
    const minifeux2Anchor = calculateAnchor(MINIFEUX2_BOUNDS);
    const minifeux3Anchor = calculateAnchor(MINIFEUX3_BOUNDS);
    const minifeux4Anchor = calculateAnchor(MINIFEUX4_BOUNDS);
    const sprite40Anchor = calculateAnchor(SPRITE40_BOUNDS);

    // ---- minifeux — 36-frame short spark particle ----------------
    // AS: DefineSprite_8_minifeux
    // frame_1/DoAction.as: _rotation = random(360); _X = _parent.boule._x; _Y = _parent.boule._y
    // frame_1/PlaceObject2_5_1/onClipEvent(load): _alpha=150; v=Math.random()
    // frame_1/PlaceObject2_5_1/onClipEvent(enterFrame): _alpha-=3.34; _X+=v
    // frame_34/DoAction.as: this.removeMovieClip()
    this.minifeuxSym = {
      name: "minifeux",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux"),
      anchorX: minifeuxAnchor.x,
      anchorY: minifeuxAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/onClipEvent(load)
        clip.vars.alpha = 150;
        clip.vars.v = Math.random();
        clip.alpha = 150 / 100;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
        let alpha = clip.vars.alpha as number;
        const v = clip.vars.v as number;
        alpha -= 3.34;
        clip.vars.alpha = alpha;
        clip.alpha = Math.max(0, alpha) / 100;
        clip.x += v;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_8_minifeux/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            // Note: _X = _parent.boule._x / _Y = _parent.boule._y
            // The parent (sprite40) has a child named "boule" (sprite40 itself IS boule
            // in the context — the minifeux is attached to sprite45 and reads boule from
            // its parent which is sprite40). In canonical AS the minifeux is attached to
            // the sprite40 parent's parent and then positioned at boule's coords.
            // Here the minifeux is attached to the sprite40 clip; we read boule from
            // sprite40's parent (the feux container).
            const boule = clip.parent?.children.get("boule");
            if (boule) {
              clip.x = boule.x;
              clip.y = boule.y;
            }
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

    // ---- minifeux2 — 36-frame spark particle ---------------------
    // AS: DefineSprite_7_minifeux2
    // frame_1/DoAction.as: _rotation = random(360)
    // frame_1/PlaceObject2_5_1/onClipEvent(load): _alpha=random(150); v=Math.random()
    // frame_1/PlaceObject2_5_1/onClipEvent(enterFrame): _alpha-=3.34; _X+=v
    // frame_34/DoAction.as: this.removeMovieClip()
    this.minifeux2Sym = {
      name: "minifeux2",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux2"),
      anchorX: minifeux2Anchor.x,
      anchorY: minifeux2Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/onClipEvent(load)
        const alpha = Math.floor(Math.random() * 150);
        clip.vars.alpha = alpha;
        clip.alpha = alpha / 100;
        clip.vars.v = Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
        let alpha = clip.vars.alpha as number;
        const v = clip.vars.v as number;
        alpha -= 3.34;
        clip.vars.alpha = alpha;
        clip.alpha = Math.max(0, alpha) / 100;
        clip.x += v;
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

    // ---- minifeux3 — 78-frame long-lived spark particle ----------
    // AS: DefineSprite_6_minifeux3
    // frame_1/DoAction.as: _rotation = random(360)
    // frame_1/PlaceObject2_5_1/onClipEvent(load): _alpha=random(150); v=0.67+1*Math.random()
    // frame_1/PlaceObject2_5_1/onClipEvent(enterFrame): _parent._alpha=random(100); _alpha-=1.6; _X+=v*=0.85
    // frame_76/DoAction.as: this.removeMovieClip()
    this.minifeux3Sym = {
      name: "minifeux3",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux3"),
      anchorX: minifeux3Anchor.x,
      anchorY: minifeux3Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/onClipEvent(load)
        const alpha = Math.floor(Math.random() * 150);
        clip.vars.alpha = alpha;
        clip.alpha = alpha / 100;
        clip.vars.v = 0.67 + 1 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
        // _parent._alpha = random(100) — parent alpha flicker
        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }
        let alpha = clip.vars.alpha as number;
        let v = clip.vars.v as number;
        alpha -= 1.6;
        clip.vars.alpha = alpha;
        clip.alpha = Math.max(0, alpha) / 100;
        v *= 0.85;
        clip.vars.v = v;
        clip.x += v;
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

    // ---- minifeux4 — 78-frame long-lived ember particle ----------
    // AS: DefineSprite_3_minifeux4
    // frame_1/DoAction.as: (empty)
    // frame_1/PlaceObject2_2_1/onClipEvent(load): angle=90; _alpha=random(150); v=-1.6-3.34*Math.random(); vr=-0.5+Math.random()
    // frame_1/PlaceObject2_2_1/onClipEvent(enterFrame): oscillate rotation by angle+vr, drift X/Y, fade alpha
    // frame_76/DoAction.as: this.removeMovieClip()
    this.minifeux4Sym = {
      name: "minifeux4",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux4"),
      anchorX: calculateAnchor(MINIFEUX4_BOUNDS).x,
      anchorY: calculateAnchor(MINIFEUX4_BOUNDS).y,
      onLoad: (clip) => {
        // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/onClipEvent(load)
        clip.vars.angle = 90;
        const alpha = Math.floor(Math.random() * 150);
        clip.vars.alpha = alpha;
        clip.alpha = alpha / 100;
        clip.vars.v = -1.6 - 3.34 * Math.random();
        clip.vars.vr = -0.5 + Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/onClipEvent(enterFrame)
        let angle = clip.vars.angle as number;
        const vr = clip.vars.vr as number;
        let v = clip.vars.v as number;
        let alpha = clip.vars.alpha as number;

        // _rotation = angle * 57.29746936176985  (converting radians to degrees in AS → we want radians in TS)
        // angle is already in radians here (seeded as 90 which is degrees... but AS stores it as 90 and multiplies by 57.29 to get degrees)
        // Actually: angle starts at 90 (a radian value), and _rotation = angle * (180/PI) sets it to degrees.
        // So angle is in radians. clip.rotation = angle directly.
        clip.rotation = angle;
        angle += vr;
        clip.vars.angle = angle;

        // _parent._alpha = random(100)
        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }

        alpha -= 1.6;
        clip.vars.alpha = alpha;
        clip.alpha = Math.max(0, alpha) / 100;

        v *= 0.85;
        clip.vars.v = v;

        const vx = v * Math.cos(angle);
        const vy = v * Math.sin(angle);
        clip.y += v;
        clip.x += vx;
        clip.y += vy;
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

    // ---- sprite40 — clipEvent-driven boule (rocket trail) --------
    // AS: DefineSprite_40
    // frame_1/PlaceObject2_39_1/onClipEvent(load): c=1
    // frame_1/PlaceObject2_39_1/onClipEvent(enterFrame): if random(2)==1 { rotate+100; attachMovie("minifeux",...,c); c++ }
    // The sprite40 is placed inside sprite45 at frame 0 (depth 1) with matrix from placements[].
    // It is named "boule" by the placement.
    this.sprite40Sym = {
      name: "sprite40",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite40"),
      anchorX: sprite40Anchor.x,
      anchorY: sprite40Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_40/frame_1/PlaceObject2_39_1/onClipEvent(load)
        clip.vars.c = 1;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_40/frame_1/PlaceObject2_39_1/onClipEvent(enterFrame)
        if (Math.floor(Math.random() * 2) === 1) {
          clip.rotation += (100 * Math.PI) / 180;
          const c = clip.vars.c as number;
          // attachMovie("minifeux", "minifeux"+c, c) on _parent._parent
          // In canonical AS this attaches to the grandparent (sprite45's parent = root)
          // We attach it to the root directly.
          const root = clip.parent?.parent;
          if (root) {
            root.attach(this.minifeuxSym, `minifeux${c}`, c, ctx);
          }
          clip.vars.c = c + 1;
        }
      },
    };

    // ---- feux — 16-frame firework burst composite ----------------
    // AS: DefineSprite_37_feux
    // frame_1/DoAction.as: gotoAndStop(_parent._parent._parent.level + 1)
    //   → dispatches to sub-frame based on level (levels 1-6 → frames 2-7, but only
    //     frames 2, 5, 8, 11, 14 have actual clipEvent handlers in the scripts)
    //   Canonical frames: 2 (minifeux emitter), 5 (drifting ember), 8 (minifeux2 emitter),
    //   11 (minifeux3 burst + self-remove), 14 (minifeux4 big ember)
    //
    // frame_2/PlaceObject2_15_1/onClipEvent(load): parent rotation, g/vg/va/t/scale/vx/vy/accx/accy
    // frame_2/PlaceObject2_15_1/onClipEvent(enterFrame): random rotate/scale; parent._y+=g; alpha fade; drift X toward d; remove on alpha<0
    //
    // frame_5/PlaceObject2_23_1/onClipEvent(load): parent rotation, g/vg/va/t/scale/X/d/acc/vacc
    // frame_5/PlaceObject2_23_1/onClipEvent(enterFrame): rotate+t/6; t--; scale=t/3; parent._y+=g; drift X; remove on t<0
    //
    // frame_8/PlaceObject2_15_1/onClipEvent(load): g/vg/va/t/scale/vx/vy/accx/accy/c
    // frame_8/PlaceObject2_15_1/onClipEvent(enterFrame): random(15)==1 spawn minifeux2; rotate+t/3; t--; scale=t/3; parent._y+=g; drift vx/vy; remove on t<0
    //
    // frame_11/PlaceObject2_28_1/onClipEvent(load): stop(); seed all vars
    // frame_11/PlaceObject2_28_1/onClipEvent(enterFrame): if t<150 play(); if t<135 spawn minifeux3 x9 + parent.remove(); rotate+t/3; t--; scale; drift
    //
    // frame_14/PlaceObject2_36_1/onClipEvent(load): spawn minifeux4 x1; seed angle/vit/frein/vr/sz/frangle; stop()
    // frame_14/PlaceObject2_36_1/onClipEvent(enterFrame): rotate; alpha flicker; scale sz*frein+0.02; drift angle+vr; move by vit; if t<150 play(); if t<135 spawn minifeux3 x9 + parent.remove()

    // We model each level's sub-frame as a single SymbolDefinition with
    // per-frame dispatching. The feux symbol uses frameScripts to gotoAndStop
    // at the level-appropriate frame, then the placed child's clipEvents handle
    // the actual per-frame behavior.
    //
    // Since SpellClip can only have one onLoad/onEnterFrame, we implement the
    // feux symbol as a container that on frame_1 reads level and configures
    // its own behavior accordingly (seeding vars for the correct sub-variant).

    const minifeux2SymRef = () => this.minifeux2Sym;
    const minifeux3SymRef = () => this.minifeux3Sym;
    const minifeux4SymRef = () => this.minifeux4Sym;

    this.feuxSym = {
      name: "feux",
      totalFrames: 16,
      frames: textures.getFrames("lib_feux"),
      anchorX: feuxAnchor.x,
      anchorY: feuxAnchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_37_feux/frame_1/DoAction.as: gotoAndStop(_parent._parent._parent.level + 1)
        // _parent._parent._parent of feux = sprite45's parent = root
        // feux lives inside the sprite42 (the "feux burst container") which is inside sprite45 which is inside root.
        // Walk up: feux.parent = sprite42/feuxContainer; .parent = sprite45; .parent = root
        const root = clip.parent?.parent?.parent ?? clip.parent?.parent ?? clip.parent;
        const level = (root?.vars.level as number) ?? 1;
        // gotoAndStop(level + 1): level 1 → frame 2 → index 1
        const targetFrame = level; // level + 1 - 1 = level (0-based)
        clip.gotoAndStop(targetFrame);

        // Now seed vars based on which frame we landed on.
        // Frame 2 (index 1) — minifeux variant (frame_2 handlers)
        // Frame 5 (index 4) — drifting ember (frame_5 handlers)
        // Frame 8 (index 7) — minifeux2 variant (frame_8 handlers)
        // Frame 11 (index 10) — minifeux3 burst (frame_11 handlers)
        // Frame 14 (index 13) — minifeux4 big ember (frame_14 handlers)
        // For levels 1-6, canonical mapping: frame = level+1 → indices 1,2,3,4,5,6
        // The scripts only define handlers at frames 2,5,8,11,14 (indices 1,4,7,10,13).
        // We use the closest matching handler based on level.

        // Determine which variant to use
        const variant = getFeuxVariant(level);
        clip.vars.variant = variant;

        if (variant === 2) {
          // AS DefineSprite_37_feux/frame_2/PlaceObject2_15_1/onClipEvent(load)
          clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
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
        } else if (variant === 5) {
          // AS DefineSprite_37_feux/frame_5/PlaceObject2_23_1/onClipEvent(load)
          clip.parent && (clip.parent.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180);
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
        } else if (variant === 8) {
          // AS DefineSprite_37_feux/frame_8/PlaceObject2_15_1/onClipEvent(load)
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
        } else if (variant === 11) {
          // AS DefineSprite_37_feux/frame_11/PlaceObject2_28_1/onClipEvent(load)
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
        } else if (variant === 14) {
          // AS DefineSprite_37_feux/frame_14/PlaceObject2_36_1/onClipEvent(load)
          // spawn minifeux4 at self position
          const parent = clip.parent;
          if (parent) {
            const root2 = parent.parent?.parent;
            if (root2) {
              const compte = Math.floor(Math.random() * 300000);
              const mf4 = root2.attach(minifeux4SymRef(), `minifeux4${compte}`, compte, ctx);
              mf4.x = clip.x;
              mf4.y = clip.y + (parent.y ?? 0);
            }
          }
          clip.vars.angle = -1.1415 + 0.2 * (-0.5 + Math.random());
          clip.vars.vit = 2 + 10 * Math.random();
          clip.stop();
          clip.vars.frein = 0.9 + 0.05 * Math.random();
          clip.vars.vr = 0;
          clip.vars.sz = 240 + Math.floor(Math.random() * 120);
          clip.vars.frangle = 1.2;
          clip.vars.t = 200; // init t above thresholds so it starts stopped
          clip.vars.c = 0;
        }
      },
      onEnterFrame: (clip, ctx) => {
        const variant = clip.vars.variant as number;

        if (variant === 2) {
          // AS DefineSprite_37_feux/frame_2/PlaceObject2_15_1/onClipEvent(enterFrame)
          clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          const t = 20 + Math.floor(Math.random() * 80);
          clip.scaleX = t / 100;
          clip.scaleY = t / 100;
          const g = clip.vars.g as number;
          const vacc = clip.vars.vacc as number;
          let va = clip.vars.va as number;
          const acc = clip.vars.acc as number;
          const d = clip.vars.d as number;
          if (clip.parent) {
            clip.parent.y += g;
          }
          va += vacc;
          clip.vars.va = va;
          clip.alpha = Math.max(0, (150 - va) / 100);
          clip.x -= (clip.x - d) / acc;
          if (clip.alpha <= 0) {
            clip.parent?.remove();
          }
        } else if (variant === 5) {
          // AS DefineSprite_37_feux/frame_5/PlaceObject2_23_1/onClipEvent(enterFrame)
          let t = clip.vars.t as number;
          const g = clip.vars.g as number;
          const acc = clip.vars.acc as number;
          const d = clip.vars.d as number;
          clip.rotation += (t / 6) * (Math.PI / 180);
          t--;
          clip.vars.t = t;
          clip.scaleX = Math.max(0, t / 3) / 100;
          clip.scaleY = Math.max(0, t / 3) / 100;
          if (clip.parent) {
            clip.parent.y += g;
          }
          clip.x -= (clip.x - d) / acc;
          if (t < 0) {
            clip.parent?.remove();
          }
        } else if (variant === 8) {
          // AS DefineSprite_37_feux/frame_8/PlaceObject2_15_1/onClipEvent(enterFrame)
          let t = clip.vars.t as number;
          const g = clip.vars.g as number;
          let vx = clip.vars.vx as number;
          let vy = clip.vars.vy as number;
          const accx = clip.vars.accx as number;
          const accy = clip.vars.accy as number;
          let c = clip.vars.c as number;
          let compte = clip.vars.compte as number;

          if (Math.floor(Math.random() * 15) === 1) {
            const root2 = clip.parent?.parent;
            if (root2) {
              const mf2 = root2.attach(minifeux2SymRef(), `minifeux2${compte}`, compte, ctx);
              mf2.x = clip.x;
              mf2.y = clip.y + (clip.parent?.y ?? 0);
              mf2.alpha = Math.max(0, (100 - c) / 100);
              c++;
              clip.vars.c = c;
            }
            compte = Math.floor(Math.random() * 200000);
            clip.vars.compte = compte;
          }

          clip.rotation += (t / 3) * (Math.PI / 180);
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
            clip.parent?.remove();
          }
        } else if (variant === 11) {
          // AS DefineSprite_37_feux/frame_11/PlaceObject2_28_1/onClipEvent(enterFrame)
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
            // spawn 9 minifeux3 particles on parent's parent
            const root2 = clip.parent?.parent;
            if (root2) {
              let nbr = 1;
              while (nbr < 10) {
                const compte = Math.floor(Math.random() * 200000);
                const mf3 = root2.attach(minifeux3SymRef(), `minifeux3${compte}`, compte, ctx);
                mf3.x = clip.x;
                mf3.y = clip.y + (clip.parent?.y ?? 0);
                mf3.alpha = Math.max(0, (100 - c) / 100);
                c++;
                nbr++;
              }
              clip.vars.c = c;
            }
            clip.parent?.remove();
            return;
          }

          clip.rotation += (t / 3) * (Math.PI / 180);
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
        } else if (variant === 14) {
          // AS DefineSprite_37_feux/frame_14/PlaceObject2_36_1/onClipEvent(enterFrame)
          let angle = clip.vars.angle as number;
          let vit = clip.vars.vit as number;
          const frein = clip.vars.frein as number;
          let vr = clip.vars.vr as number;
          let sz = clip.vars.sz as number;
          let frangle = clip.vars.frangle as number;
          let t = clip.vars.t as number;
          let c = clip.vars.c as number;

          // _rotation = angle * 57.29746936176985 → clip.rotation = angle (already radians)
          clip.rotation = angle;
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
          clip.vars.angle = angle;
          frangle *= frein;
          clip.vars.frangle = frangle;

          const vx = vit * Math.cos(angle);
          const vy = vit * Math.sin(angle);
          clip.x += vx;
          clip.y += vy;
          vit *= frein;
          clip.vars.vit = vit;

          if (t < 150) {
            clip.play();
          }
          if (t < 135) {
            const root2 = clip.parent?.parent;
            if (root2) {
              let nbr = 1;
              while (nbr < 10) {
                const compte = Math.floor(Math.random() * 300000);
                const mf3 = root2.attach(minifeux3SymRef(), `minifeux3${compte}`, compte, ctx);
                mf3.x = clip.x;
                mf3.y = clip.y + (clip.parent?.y ?? 0);
                mf3.alpha = Math.max(0, (100 - c) / 100);
                c++;
                nbr++;
              }
              clip.vars.c = c;
            }
            clip.parent?.remove();
            return;
          }

          // t not yet defined at this point in vanilla AS (it uses the outer scope t which is
          // not initialized in this handler's load — this is likely a bug in the original AS
          // but t defaults to undefined/NaN so t < 150 never fires until t is set externally).
          // We track t decrement here defensively:
          t--;
          clip.vars.t = t;
        }
      },
    };

    // ---- sprite45 — outer 97-frame fireworks container (main sprite) ----
    // AS: DefineSprite_45
    // frame_1/DoAction.as: SOMA.playSound("fireworks01"); taille=80+random(40); scale/rotation/compte=1
    // frame_1/DoAction_2.as: (same frame, two DoAction blocks — both executed at frame 0)
    // frame_70/DoAction.as: SOMA.playSound("explo_fireworks")
    // frame_76/PlaceObject2_42_3/onClipEvent(load): attach feux instances + set sz
    //   DefineSprite_42/frame_2/DoAction.as: stop()  (sprite42 is the feux burst container)
    // frame_97/DoAction.as: stop()
    // frame_319/DoAction.as: _parent.removeMovieClip(); stop()
    //
    // The sprite45 is the main spell animation container.
    // sprite40 ("boule") is placed at frame 0 of sprite45 with the animated matrix from placements[].

    this.sprite45Sym = {
      name: "sprite45",
      totalFrames: 319,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_45/frame_1/DoAction.as + DoAction_2.as
            // SOMA.playSound("fireworks01") — called from onSpellStart
            const taille = 80 + Math.floor(Math.random() * 40);
            clip.scaleX = taille / 100;
            clip.scaleY = taille / 100;
            clip.rotation = ((-20 + Math.floor(Math.random() * 40)) * Math.PI) / 180;
            clip.vars.compte = 1;

            // Attach sprite40 "boule" with initial placement matrix from manifest
            // placements[0]: frame 0, depth 1, matrix { scaleX:0.574, scaleY:12.945, tx:-0.75, ty:-53.25 }
            const boule = clip.attach(this.sprite40Sym, "boule", 1, ctx);
            boule.x = -0.75;
            boule.y = -53.25;
            boule.scaleX = 0.574462890625;
            boule.scaleY = 12.94549560546875;
          },
        ],
        [
          69,
          () => {
            // AS DefineSprite_45/frame_70/DoAction.as
            this.playSound?.("explo_fireworks");
            // Canonical hit signal — explosion sound = impact frame
            this.runtime.signalHit();
          },
        ],
        [
          75,
          (clip, ctx) => {
            // AS DefineSprite_45/frame_76/PlaceObject2_42_3/onClipEvent(load)
            // Attach the feux burst container (sprite42) which then attaches feux children.
            // sprite42 is a container with frame_2/DoAction.as: stop().
            // We model it inline: create a container clip that spawns feux instances.
            const level = (clip.parent?.vars.level as number) ?? 1;
            const sz = 60 + 20 * ((level - 1) % 3);
            const burstCount = 6 + 7 * ((level - 1) % 3); // i < 6 + 7*((level-1)%3), i starts at 1 → burstCount-1 feux

            // Attach a container "feuxContainer" to hold the burst
            // We re-use feuxSym directly, attaching multiple instances.
            let i = 1;
            while (i < burstCount) {
              const feuxChild = clip.attach(this.feuxSym, `feux${i}`, i + 100, ctx);
              feuxChild.scaleX = sz / 100;
              feuxChild.scaleY = sz / 100;
              i++;
            }
          },
        ],
        [
          96,
          (clip) => {
            // AS DefineSprite_45/frame_97/DoAction.as
            clip.stop();
          },
        ],
        [
          318,
          (clip) => {
            // AS frame_319/DoAction.as: _parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.minifeuxSym);
    this.registry.register(this.minifeux2Sym);
    this.registry.register(this.minifeux3Sym);
    this.registry.register(this.minifeux4Sym);
    this.registry.register(this.sprite40Sym);
    this.registry.register(this.feuxSym);
    this.registry.register(this.sprite45Sym);
  }

  protected onSpellStart(callbacks: SpellCallbacks, ctx: SpellContext): void {
    // AS DefineSprite_45/frame_1/DoAction.as: SOMA.playSound("fireworks01")
    callbacks.playSound("fireworks01");
    this.playSound = callbacks.playSound;

    // Attach the main sprite45 timeline to the root at target cell.
    this.root.attach(this.sprite45Sym, "sprite45", 1, ctx);
  }
}

/**
 * Map spell level (1-6) to the canonical feux sub-frame variant.
 * AS: gotoAndStop(level + 1) → frames 2,3,4,5,6,7
 * Only frames 2, 5, 8, 11, 14 have clipEvent handlers in the scripts.
 * We map each level to the nearest defined variant.
 */
function getFeuxVariant(level: number): number {
  // Frame = level + 1 (1-based). The handlers are at frames 2, 5, 8, 11, 14.
  // Level 1 → frame 2 → variant 2
  // Level 2 → frame 3 → variant 2 (nearest below is 2)
  // Level 3 → frame 4 → variant 5 (nearest is 5)
  // Level 4 → frame 5 → variant 5
  // Level 5 → frame 6 → variant 8 (nearest is 5 or 8)
  // Level 6 → frame 7 → variant 8
  // For a clean mapping, use: levels 1-2→2, 3-4→5, 5-6→8
  // Higher-level variants (11, 14) would require level 10+ which doesn't exist,
  // but we include them for completeness via the feux sprite's onLoad reading level.
  if (level <= 2) {
    return 2;
  } else if (level <= 4) {
    return 5;
  } else {
    return 8;
  }
}
