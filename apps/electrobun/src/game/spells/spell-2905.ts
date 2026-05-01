/**
 * Spell 2905 — Tofu Brasier (Osamodas fire tofu spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2905/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell places a single `shoot` symbol
 * at the target cell. No caster-anchored projectile, no world-absolute
 * dual timeline — just an impact/burst animation at the target.
 *
 * The main SWF has two top-level frames: frame_130 and frame_388 both call
 * `this.removeMovieClip()`, indicating two possible end-points depending on
 * which inner timeline finishes. The `shoot` (DefineSprite_8_shoot) outer
 * wrapper runs 97 frames and calls `_parent.removeMovieClip()` at frame 97.
 * That is the canonical spell-complete signal.
 *
 * Library symbols:
 *   - `plumes`    — 20-frame feather/plume particle. Two variants exist:
 *                   DefineSprite_7_plumes (vy upward, slower decay) and
 *                   DefineSprite_12_plumes (vy downward). Both share the
 *                   same `plumes` attachMovie name and identical physics
 *                   structure — we use the DefineSprite_7_plumes variant
 *                   since that is the named `plumes` library symbol entry
 *                   in manifest.librarySymbols. onLoad seeds t/scale,
 *                   duree, vy, vx, vch, vr, amp, a, time. onEnterFrame
 *                   drives alpha fade after duree, Y-gated physics with
 *                   oscillating rotation.
 *   - `feux`      — 1-frame spark particle. onLoad seeds random rotation,
 *                   vg/g/va, t/scale, dmax, _X, d, acc, vacc.
 *                   onEnterFrame drives random scale flicker, y-drift,
 *                   alpha decay, X-approach toward d, removal when alpha<0.
 *   - `sprite32`  — directlyDynamic clipEvent sprite (characterId 32). A
 *                   29-frame rocket/tofu body. Has complex multi-phase
 *                   timeline: frames 1,6,16 loop; frames 20,22,58 play
 *                   sounds/attach feux+plumes2; frame 29 stop; frame 64
 *                   attach feux+plumes2 batch; frame 85 stop. Also has
 *                   PlaceObject2_23 enterFrame handlers (random flame
 *                   flicker). The `placements` array shows it is placed
 *                   inside DefineSprite_33 at frame 0 depth 1.
 *   - `plumes2`   — plume particle variant 2. Two sprite IDs define it
 *                   (DefineSprite_6_plumes2 and DefineSprite_11_plumes2).
 *                   We use the DefineSprite_6_plumes2 physics (slower
 *                   decay, longer duree). Registered as `plumes2`.
 *
 * The `shoot` outer symbol (DefineSprite_8_shoot, 97 frames) wraps the
 * whole animation and removes the parent on frame 97 → runtime.complete().
 *
 * The inner sprite7 (DefineSprite_7, 58-frame plume burst) is the initial
 * explosion spawner — it attaches 10 `plumes` particles on frame_1 and
 * stops at frame 20.
 *
 * The inner sprite33 (DefineSprite_33) is a stationary wrapper: stops
 * immediately on frame_1, hosts a sprite32 instance via PlaceObject2.
 * sprite32 runs its complex looping/sound timeline and at frame 64 spawns
 * feux + plumes2 batches.
 *
 * Main timeline sounds at frames 0 (tofu_fire), 19 (explo_fireworks),
 * 57 (explo_fireworks) map to the shoot symbol's frameScripts.
 *
 * signalHit: fired at frame 19 of shoot (first explo_fireworks).
 * complete:  fired at frame 96 of shoot (_parent.removeMovieClip).
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

// ---- Manifest bounds ----

const PLUMES_BOUNDS = {
  width: 92.9,
  height: 92.9,
  offsetX: -48.55,
  offsetY: -74.85,
};

const FEUX_BOUNDS = {
  width: 9,
  height: 9,
  offsetX: -4.55,
  offsetY: -4.4,
};

const SPRITE32_BOUNDS = {
  width: 57.25,
  height: 61.9,
  offsetX: -28.85,
  offsetY: -30.55,
};

export class Spell2905 extends RuntimeSpell {
  readonly spellId = 2905;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold symbol refs so onSpellStart can attach them.
  private plumesSym!: SymbolDefinition;
  private feux1Sym!: SymbolDefinition; // DefineSprite_5_feux (used by sprite32 / DefineSprite_7)
  private feux2Sym!: SymbolDefinition; // DefineSprite_12_feux (used by sprite33)
  private plumes2Sym!: SymbolDefinition;
  private sprite32Sym!: SymbolDefinition;
  private sprite33Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;  // DefineSprite_7 (the 10-plumes spawner, 20-frame)
  private shootSym!: SymbolDefinition;    // DefineSprite_8_shoot outer wrapper

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const plumesAnchor = calculateAnchor(PLUMES_BOUNDS);
    const feuxAnchor = calculateAnchor(FEUX_BOUNDS);
    const sprite32Anchor = calculateAnchor(SPRITE32_BOUNDS);

    // ----------------------------------------------------------------
    // lib_plumes — feather/plume particle
    // AS DefineSprite_7_plumes/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD
    // onClipEvent(load) + onClipEvent(enterFrame)
    // ----------------------------------------------------------------
    this.plumesSym = {
      name: "plumes",
      totalFrames: 20,
      frames: textures.getFrames("lib_plumes"),
      anchorX: plumesAnchor.x,
      anchorY: plumesAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7_plumes/.../onClipEvent(load)
        const t = 30 + Math.floor(Math.random() * 30);
        clip.scaleX = t / 100;
        clip.vars.duree = 60 + Math.floor(Math.random() * 30);
        clip.scaleY = t / 100;
        clip.vars.vy = 2 + 2 * Math.random();
        clip.vars.vx = -10 + 20 * Math.random();
        clip.vars.vch = 0.1 + 0.1 * Math.random();
        clip.vars.vr = 0.03 + 0.1 * Math.random();
        clip.vars.amp = 30 + Math.floor(Math.random() * 50);
        clip.vars.a = 1.15;
        clip.vars.time = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7_plumes/.../onClipEvent(enterFrame)
        let time = clip.vars.time as number;
        const duree = clip.vars.duree as number;
        if (time++ > duree) {
          clip.alpha = Math.max(0, clip.alpha - 3.34 / 100);
        }
        clip.vars.time = time;
        if (clip.y < 0) {
          let vy = clip.vars.vy as number;
          let vx = clip.vars.vx as number;
          const vch = clip.vars.vch as number;
          const vr = clip.vars.vr as number;
          let amp = clip.vars.amp as number;
          let a = clip.vars.a as number;
          vy += vch;
          clip.y += vy;
          clip.x += vx;
          vy *= 0.9;
          vx *= 0.9;
          amp *= 0.98;
          a += vr;
          clip.rotation = (amp * Math.sin(a) * Math.PI) / 180;
          clip.vars.vy = vy;
          clip.vars.vx = vx;
          clip.vars.amp = amp;
          clip.vars.a = a;
        }
      },
    };

    // ----------------------------------------------------------------
    // feux (variant 1) — small spark particle (DefineSprite_5_feux)
    // Used by DefineSprite_7 (sprite7Sym) / script contexts that
    // call attachMovie("feux", ...)
    // AS DefineSprite_5_feux/.../onClipEvent(load) + onClipEvent(enterFrame)
    // ----------------------------------------------------------------
    this.feux1Sym = {
      name: "feux",
      totalFrames: 1,
      frames: textures.getFrames("lib_feux"),
      anchorX: feuxAnchor.x,
      anchorY: feuxAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_5_feux/frame_1/PlaceObject2_4_1/onClipEvent(load)
        if (clip.parent) {
          clip.parent.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        }
        clip.vars.vg = -3 * Math.random();
        clip.vars.g = 2 * Math.random();
        clip.vars.va = 0;
        const t = 50 + Math.floor(Math.random() * 50);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.dmax = 100;
        clip.x = 10 + Math.floor(Math.random() * 20);
        clip.vars.d = 100 - Math.floor(Math.random() * 70);
        clip.vars.acc = 5 + Math.random() * 5;
        clip.vars.vacc = 3 + 3 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_5_feux/frame_1/PlaceObject2_4_1/onClipEvent(enterFrame)
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        const t = 20 + Math.floor(Math.random() * 80);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        const g = clip.vars.g as number;
        if (clip.parent) {
          clip.parent.y += g;
        }
        let va = clip.vars.va as number;
        const vacc = clip.vars.vacc as number;
        va += vacc;
        clip.alpha = Math.max(0, (150 - va) / 100);
        clip.vars.va = va;
        const d = clip.vars.d as number;
        const acc = clip.vars.acc as number;
        clip.x = clip.x - (clip.x - d) / acc;
        if (clip.alpha <= 0) {
          if (clip.parent) {
            clip.parent.remove();
          }
        }
      },
    };

    // ----------------------------------------------------------------
    // feux2 — large spark particle (DefineSprite_12_feux)
    // Used by sprite33/sprite32 context (attachMovie("feux",...) in
    // DefineSprite_32/frame_22 and frame_64). Registered under the
    // same "feux" name — both contexts use the same attachMovie string,
    // so we unify them. We use the DefineSprite_12_feux physics which
    // are slightly different (larger scale, slower vacc).
    // AS DefineSprite_12_feux/.../onClipEvent(load) + onClipEvent(enterFrame)
    // ----------------------------------------------------------------
    // NOTE: Since both DefineSprite_5_feux and DefineSprite_12_feux use
    // attachMovie("feux"), we only register one "feux" symbol. We use the
    // DefineSprite_12_feux variant (larger sparks) as it is used by the
    // main explosion sequence in sprite32. The feux1Sym above is stored
    // separately and used by sprite7Sym directly by name reference.
    this.feux2Sym = {
      name: "feux",
      totalFrames: 1,
      frames: textures.getFrames("lib_feux"),
      anchorX: feuxAnchor.x,
      anchorY: feuxAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_12_feux/frame_1/PlaceObject2_11_1/onClipEvent(load)
        if (clip.parent) {
          clip.parent.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        }
        clip.vars.vg = -9 * Math.random();
        clip.vars.g = 0.67 * Math.random();
        clip.vars.va = 0;
        const t = 100 + Math.floor(Math.random() * 100);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.dmax = 100;
        clip.x = 10 + Math.floor(Math.random() * 20);
        clip.vars.d = 100 - Math.floor(Math.random() * 70);
        clip.vars.acc = 5 + Math.random() * 5;
        clip.vars.vacc = 1 + 1 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_12_feux/frame_1/PlaceObject2_11_1/onClipEvent(enterFrame)
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        const t = 40 + Math.floor(Math.random() * 80);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        const g = clip.vars.g as number;
        if (clip.parent) {
          clip.parent.y += g;
        }
        let va = clip.vars.va as number;
        const vacc = clip.vars.vacc as number;
        va += vacc;
        clip.alpha = Math.max(0, (150 - va) / 100);
        clip.vars.va = va;
        const d = clip.vars.d as number;
        const acc = clip.vars.acc as number;
        clip.x = clip.x - (clip.x - d) / acc;
        if (clip.alpha <= 0) {
          if (clip.parent) {
            clip.parent.remove();
          }
        }
      },
    };

    // ----------------------------------------------------------------
    // plumes2 — plume particle variant 2 (DefineSprite_6_plumes2)
    // AS DefineSprite_6_plumes2/.../onClipEvent(load) + onClipEvent(enterFrame)
    // ----------------------------------------------------------------
    this.plumes2Sym = {
      name: "plumes2",
      totalFrames: 20,
      // plumes2 shares the lib_plumes texture set (same visual appearance)
      frames: textures.getFrames("lib_plumes"),
      anchorX: plumesAnchor.x,
      anchorY: plumesAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6_plumes2/frame_1/PlaceObject2_5_1/onClipEvent(load)
        const t = 30 + Math.floor(Math.random() * 30);
        clip.scaleX = t / 100;
        clip.vars.duree = 60 + Math.floor(Math.random() * 30);
        clip.scaleY = t / 100;
        clip.vars.vy = -10 + 20 * Math.random();
        clip.vars.vx = -10 + 20 * Math.random();
        clip.vars.vch = 0.1 + 0.1 * Math.random();
        clip.vars.vr = 0.03 + 0.1 * Math.random();
        clip.vars.amp = 30 + Math.floor(Math.random() * 50);
        clip.vars.a = 1.15;
        clip.vars.time = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6_plumes2/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
        let time = clip.vars.time as number;
        const duree = clip.vars.duree as number;
        if (time++ > duree) {
          clip.alpha = Math.max(0, clip.alpha - 3.34 / 100);
        }
        clip.vars.time = time;
        if (clip.y < 0) {
          let vy = clip.vars.vy as number;
          let vx = clip.vars.vx as number;
          const vch = clip.vars.vch as number;
          const vr = clip.vars.vr as number;
          let amp = clip.vars.amp as number;
          let a = clip.vars.a as number;
          vy += vch;
          clip.y += vy;
          clip.x += vx;
          vy *= 0.9;
          vx *= 0.9;
          amp *= 0.98;
          a += vr;
          clip.rotation = (amp * Math.sin(a) * Math.PI) / 180;
          clip.vars.vy = vy;
          clip.vars.vx = vx;
          clip.vars.amp = amp;
          clip.vars.a = a;
        }
      },
    };

    // ----------------------------------------------------------------
    // sprite32 — directlyDynamic clipEvent sprite (characterId 32)
    // Complex 29-frame looping rocket/tofu body with multiple phases.
    // Placed inside DefineSprite_33 at frame 0, depth 1.
    //
    // Timeline summary (0-based here, AS 1-based in source):
    //   frame 0  : playSound("tofu_fire")  [AS frame_1]
    //   frame 5  : gotoAndPlay(0)          [AS frame_6  → gotoAndPlay(1)]
    //   frame 12 : PlaceObject2_23_15 enterFrame (random gotoAndStop 2 or 1)
    //   frame 15 : gotoAndPlay(0)          [AS frame_16 → gotoAndPlay(1)]
    //   frame 19 : playSound("explo_fireworks") [AS frame_20]
    //   frame 21 : attach feux×19 + plumes2×9 [AS frame_22]
    //   frame 28 : stop()                  [AS frame_29]
    //   frame 36 : PlaceObject2_23_15 enterFrame (random gotoAndStop 3 or 1) [AS frame_37]
    //   frame 57 : playSound("explo_fireworks") [AS frame_58]
    //   frame 63 : attach feux×19 + plumes2×9 [AS frame_64]
    //   frame 84 : stop()                  [AS frame_85]
    //
    // onLoad seeds vx, g, v, t.
    // onEnterFrame drives the rocket body physics (t counter, gotoAndPlay
    //   "exp" at t==50, vx scatter on frame 3, rotation, X/Y motion,
    //   vy gravity, vx friction).
    //
    // NOTE: The "exp" label maps to an internal frame — based on the
    //   script context "gotoAndPlay('exp')" is a label, but no label
    //   table is exported. Based on the timeline, frame 16 loops back
    //   to 1 and frame 6 also loops to 1, suggesting the "exp" phase
    //   starts around frame 20+ where the explosions fire. We interpret
    //   "exp" as gotoAndPlay(19) (frame_20 in 0-based = 19), the first
    //   explo_fireworks sound frame.
    // ----------------------------------------------------------------
    const feuxSym = this.feux2Sym;
    const plumes2Sym = this.plumes2Sym;
    const plumesSym = this.plumesSym;

    this.sprite32Sym = {
      name: "sprite32",
      totalFrames: 29,
      frames: textures.getFrames("lib_sprite32"),
      anchorX: sprite32Anchor.x,
      anchorY: sprite32Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_33/frame_1/PlaceObject2_32_1/onClipEvent(load)
        clip.vars.vx = 0;
        clip.vars.g = 2;
        clip.vars.v = 10;
        clip.vars.t = 0;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_33/frame_1/PlaceObject2_32_1/onClipEvent(enterFrame)
        let t = clip.vars.t as number;
        let vx = clip.vars.vx as number;
        let g = clip.vars.g as number;
        let vy = (clip.vars.vy as number) ?? 0;

        if (t++ === 50) {
          // gotoAndPlay("exp") — interpret as jumping to the explosion
          // sequence. Based on the timeline, frame_20 (index 19) is
          // the first explo_fireworks sound which marks "exp" phase.
          clip.gotoAndPlay(19);
          g = 1.5;
          vy = -7;
        }

        // AS: if(this._currentframe == 3) — spawn plumes on frame 3
        if (clip.currentFrame === 2) {
          // AS frame_3 (0-based: 2)
          vx = 15 * (-0.5 + Math.random());
          vy = -3 - 6 * Math.random();
          const r = 1 + Math.floor(Math.random() * 3);
          const parentClip = clip.parent;
          if (parentClip) {
            for (let c = 1; c < r; c++) {
              const al = Math.floor(Math.random() * 10000);
              const plumeInst = parentClip.attach(plumesSym, `plumes${al}`, al, ctx);
              // AS: eval("_parent.plumes"+al).plume._x = _X
              plumeInst.x = clip.x;
              plumeInst.y = clip.y - 20;
            }
          }
        }

        // AS: _rotation = 5 * vx (degrees → radians)
        clip.rotation = (5 * vx * Math.PI) / 180;
        clip.x += vx;
        clip.y += vy;
        vy += g;
        vx *= 0.8;

        clip.vars.t = t;
        clip.vars.vx = vx;
        clip.vars.g = g;
        clip.vars.vy = vy;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_32/frame_1/DoAction.as: SOMA.playSound("tofu_fire")
            // Sound played via stored callback
            if ((clip.vars._soundCb as ((id: string) => void) | undefined)) {
              (clip.vars._soundCb as (id: string) => void)("tofu_fire");
            }
          },
        ],
        [
          5,
          (clip) => {
            // AS DefineSprite_32/frame_6/DoAction.as: gotoAndPlay(1)
            clip.gotoAndPlay(0);
          },
        ],
        [
          15,
          (clip) => {
            // AS DefineSprite_32/frame_16/DoAction.as: gotoAndPlay(1)
            clip.gotoAndPlay(0);
          },
        ],
        [
          19,
          (clip) => {
            // AS DefineSprite_32/frame_20/DoAction.as: SOMA.playSound("explo_fireworks")
            if ((clip.vars._soundCb as ((id: string) => void) | undefined)) {
              (clip.vars._soundCb as (id: string) => void)("explo_fireworks");
            }
          },
        ],
        [
          21,
          (clip, ctx) => {
            // AS DefineSprite_32/frame_22/DoAction.as
            // Attach 19 feux inside self
            for (let i = 1; i < 20; i++) {
              clip.attach(feuxSym, `feux${i}`, i, ctx);
            }
            // Attach 9 plumes2 in parent, positioned at self's coords
            const parentClip = clip.parent;
            if (parentClip) {
              for (let i = 1; i < 10; i++) {
                const p2 = parentClip.attach(plumes2Sym, `plumes2${i}`, i, ctx);
                p2.x = clip.x;
                p2.y = clip.y;
              }
            }
            clip.vars.g = 0;
            clip.vars.vy = 0;
            clip.vars.vx = 0;
          },
        ],
        [
          28,
          (clip) => {
            // AS DefineSprite_32/frame_29/DoAction.as: stop()
            clip.stop();
          },
        ],
        [
          57,
          (clip) => {
            // AS DefineSprite_32/frame_58/DoAction.as: SOMA.playSound("explo_fireworks")
            if ((clip.vars._soundCb as ((id: string) => void) | undefined)) {
              (clip.vars._soundCb as (id: string) => void)("explo_fireworks");
            }
          },
        ],
        [
          63,
          (clip, ctx) => {
            // AS DefineSprite_32/frame_64/DoAction.as
            // Attach 19 feux inside self
            for (let i = 1; i < 20; i++) {
              clip.attach(feuxSym, `feux${i}`, i, ctx);
            }
            // Attach 9 plumes2 in parent
            const parentClip = clip.parent;
            if (parentClip) {
              for (let i = 1; i < 10; i++) {
                const p2 = parentClip.attach(plumes2Sym, `plumes2${i}`, i, ctx);
                p2.x = clip.x;
                p2.y = clip.y;
              }
            }
            clip.vars.g = 0;
            clip.vars.vy = 0;
            clip.vars.vx = 0;
          },
        ],
        [
          84,
          (clip) => {
            // AS DefineSprite_32/frame_85/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite33 — wrapper for sprite32 (DefineSprite_33)
    // frame_1: stop(). Contains PlaceObject2_32_1 which places sprite32
    // at (0.25, -28.65) with no scale/rotation change.
    // ----------------------------------------------------------------
    this.sprite33Sym = {
      name: "sprite33",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_33/frame_1/DoAction.as: stop()
            clip.stop();
            // Place sprite32 at matrix {translateX: 0.25, translateY: -28.65}
            // AS DefineSprite_33/frame_1/PlaceObject2_32_1 placement
            const s32 = clip.attach(
              this.sprite32Sym,
              "sprite32",
              1,
              ctx,
              { x: 0.25, y: -28.65 }
            );
            // Pass sound callback down into the sprite32 vars
            s32.vars._soundCb = this.soundCallback;
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite7 — 20-frame plume burst spawner (DefineSprite_7)
    // frame_1: attach 10 plumes with vx/vy seeds.
    // frame_20: stop().
    // ----------------------------------------------------------------
    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 20,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_7/frame_1/DoAction.as
            let c = 0;
            let p = 0;
            while (p < 10) {
              const pInst = clip.attach(plumesSym, `plumes${c}`, c, ctx);
              pInst.vars.vx = 40 * (Math.random() - 0.5);
              pInst.vars.vy = 40 * (Math.random() - 0.5);
              c++;
              p++;
            }
          },
        ],
        [
          19,
          (clip) => {
            // AS DefineSprite_7/frame_20/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // shoot — outer 97-frame wrapper (DefineSprite_8_shoot)
    // frame_1: _rotation = 0; contains PlaceObject2_7_1 (sub-sprite
    //   with onLoad t=70 scale).
    // frame_97: _parent.removeMovieClip() → spell complete.
    //
    // The sub-clip PlaceObject2_7_1 onLoad sets _xscale=_yscale=70.
    // Since this inner clip is the authored content of the shoot symbol
    // (the 97-frame animation frames carry all the visual content),
    // we apply the scale on the shoot symbol's onLoad.
    // ----------------------------------------------------------------
    this.shootSym = {
      name: "shoot",
      totalFrames: 97,
      frames: textures.getFrames("shoot"),
      anchorX: calculateAnchor({ width: 92.9, height: 92.9, offsetX: -43.5, offsetY: -74.2 }).x,
      anchorY: calculateAnchor({ width: 92.9, height: 92.9, offsetX: -43.5, offsetY: -74.2 }).y,
      onLoad: (clip) => {
        // AS DefineSprite_8_shoot/frame_1/PlaceObject2_7_1/onClipEvent(load)
        // The inner content clip has _xscale=_yscale=70
        clip.scaleX = 70 / 100;
        clip.scaleY = 70 / 100;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_8_shoot/frame_1/DoAction.as: _rotation = 0
            clip.rotation = 0;
            // Main timeline frame 0 sound: tofu_fire (manifest sounds[0])
            if (this.soundCallback) {
              this.soundCallback("tofu_fire");
            }
            // Attach sprite33 (the rocket body) and sprite7 (plume burst)
            clip.attach(this.sprite33Sym, "sprite33", 1, ctx);
            clip.attach(this.sprite7Sym, "sprite7", 2, ctx);
          },
        ],
        [
          19,
          () => {
            // AS manifest sounds[1]: explo_fireworks at frame 19
            if (this.soundCallback) {
              this.soundCallback("explo_fireworks");
            }
            // Canonical hit signal — first explosion
            this.runtime.signalHit();
          },
        ],
        [
          57,
          () => {
            // AS manifest sounds[2]: explo_fireworks at frame 57
            if (this.soundCallback) {
              this.soundCallback("explo_fireworks");
            }
          },
        ],
        [
          96,
          (clip) => {
            // AS DefineSprite_8_shoot/frame_97/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // Register all symbols
    this.registry.register(this.plumesSym);
    this.registry.register(this.feux2Sym); // registered as "feux"
    this.registry.register(this.plumes2Sym);
    this.registry.register(this.sprite32Sym);
    this.registry.register(this.sprite33Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Store the sound callback for use from frameScripts / onEnterFrame
    this.soundCallback = callbacks.playSound;

    // The main timeline has a `shoot` symbol at depth 1.
    // DefineSprite_3_shoot/frame_1/DoAction.as: _rotation = 0
    // DefineSprite_3_shoot/frame_289/DoAction.as: _parent.removeMovieClip()
    // But the harness for TargetCell doesn't auto-attach anything —
    // we attach the shoot symbol here from the main timeline frame_1.
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
