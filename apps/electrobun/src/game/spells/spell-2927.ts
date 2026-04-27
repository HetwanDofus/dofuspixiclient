/**
 * Spell 2927 — (Phoenix / Fireworks bird spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2927/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single "shoot" animation
 * anchored at the target cell — no projectile motion, no caster reference,
 * no WorldAbsolute dual-anchoring. The harness places root at target.
 *
 * Architecture:
 *   The outer SWF main timeline is a single sprite (DefineSprite_24) placed
 *   at the target. DefineSprite_24 is the "bird / fireworks" container:
 *     - frame_1:  play "bat_ailes" sound; an inner sprite (PlaceObject2_19_25,
 *                 which is DefineSprite_11) randomly toggles between frame 1/3
 *                 each tick (flapping wing effect).
 *     - frame_16: gotoAndPlay(1) — loops the wing-flap section.
 *     - frame_37:  same PlaceObject2_19_25 enterFrame handler (still flapping).
 *     - frame_58:  SOMA.playSound("explo_fireworks").
 *     - frame_64:  spawn 19 "feux" sparks inside self; spawn 9 "plumes2" at
 *                  parent; reset g/vy/vx to 0.
 *     - frame_85:  stop().
 *
 *   DefineSprite_3_shoot wraps DefineSprite_24 (the bird) as the outer shoot
 *   symbol. Its frame_1 has:
 *     - DoAction: _rotation = 0
 *     - PlaceObject2_2_1 (an inner sprite) onClipEvent(load): t=70; scale 70%.
 *     (The inner PlaceObject2_2_1 is DefineSprite_2 which spawns "plumes"
 *      particles on its own frame_1, stops at frame_58.)
 *   frame_289: _parent.removeMovieClip() → complete.
 *
 * Library symbols:
 *   - lib_plumes   — feather drift particle (used inside DefineSprite_2 &
 *                    plumes2 fireworks). onLoad seeds scale/vy/vx/physics.
 *                    onEnterFrame drifts while _Y < 0, fades after duree.
 *   - lib_feux     — spark/fire particle spawned at frame_64 of bird.
 *                    onLoad seeds rotation, velocity, etc. onEnterFrame
 *                    moves toward target radius, fades, removes parent.
 *   - lib_plumes2  — feather particle (upward variant). onLoad seeds physics.
 *                    onEnterFrame similar to plumes but with upward drift.
 *
 * The "shoot" symbol (DefineSprite_3_shoot) is the top-level container,
 * registered as a container-only symbol with 291 frames. The harness
 * (displayType=11) does NOT auto-attach "shoot"; we attach it manually
 * from onSpellStart since this spell uses the simple TargetCell pattern.
 *
 * signalHit is fired at frame_64 of the bird (the explosion frame).
 * complete() is fired at frame_289 of shoot (_parent.removeMovieClip).
 *
 * Main timeline (frame_388/DoAction.as): this.removeMovieClip() — the outer
 * SWF self-removes; we handle this via the shoot frame_289 complete signal.
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

// --- Manifest bounds for library symbols ---

const PLUMES_BOUNDS = {
  width: 14.6,
  height: 14.6,
  offsetX: -9.9,
  offsetY: -52.45,
};

const FEUX_BOUNDS = {
  width: 9,
  height: 9,
  offsetX: -4.55,
  offsetY: -4.4,
};

const PLUMES2_BOUNDS = {
  width: 14.6,
  height: 14.6,
  offsetX: -6.9,
  offsetY: 17.55,
};

export class Spell2927 extends RuntimeSpell {
  readonly spellId = 2927;
  readonly displayType = SpellDisplayType.TargetCell;

  // Keep references so onSpellStart can attach the shoot symbol.
  private plumesSym!: SymbolDefinition;
  private feux Sym!: SymbolDefinition;
  private plumes2Sym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  // Sound callback captured in onSpellStart so frameScripts can fire it.
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const plumesAnchor = calculateAnchor(PLUMES_BOUNDS);
    const feuxAnchor = calculateAnchor(FEUX_BOUNDS);
    const plumes2Anchor = calculateAnchor(PLUMES2_BOUNDS);

    // ----------------------------------------------------------------
    // lib_plumes — feather drift particle
    // Used by DefineSprite_2/frame_1 (inside shoot's inner mc) and by
    // DefineSprite_25's firework plumes.
    //
    // onLoad: AS DefineSprite_7_plumes/frame_1/PlaceObject2_5_1/onClipEvent(load)
    //   t = 30 + random(30)
    //   _xscale = t; duree = 60 + random(30); _yscale = t
    //   vy = 2 + 2 * Math.random()
    //   vx = -10 + 20 * Math.random()
    //   vch = 0.1 + 0.1 * Math.random()
    //   vr = 0.03 + 0.1 * Math.random()
    //   amp = 30 + random(50); a = 1.15; time = 0
    //
    // onEnterFrame: AS DefineSprite_7_plumes/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
    //   if (time++ > duree) { _alpha -= 6.34 }
    //   if (_Y < 0) { drift + oscillate }
    this.plumesSym = {
      name: "plumes",
      totalFrames: 1,
      frames: textures.getFrames("lib_plumes"),
      anchorX: plumesAnchor.x,
      anchorY: plumesAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_7_plumes/frame_1/PlaceObject2_5_1/onClipEvent(load)
        const t = 30 + Math.floor(Math.random() * 30);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.duree = 60 + Math.floor(Math.random() * 30);
        clip.vars.vy = 2 + 2 * Math.random();
        clip.vars.vx = -10 + 20 * Math.random();
        clip.vars.vch = 0.1 + 0.1 * Math.random();
        clip.vars.vr = 0.03 + 0.1 * Math.random();
        clip.vars.amp = 30 + Math.floor(Math.random() * 50);
        clip.vars.a = 1.15;
        clip.vars.time = 0;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_7_plumes/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
        let time = clip.vars.time as number;
        const duree = clip.vars.duree as number;
        if (time++ > duree) {
          clip.alpha = clip.alpha - 6.34 / 100;
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
          clip.y = clip.y + vy;
          clip.x = clip.x + vx;
          vy *= 0.9;
          vx *= 0.9;
          amp *= 0.98;
          a += vr;
          // AS rotation in degrees → radians
          clip.rotation = (amp * Math.sin(a) * Math.PI) / 180;

          clip.vars.vy = vy;
          clip.vars.vx = vx;
          clip.vars.amp = amp;
          clip.vars.a = a;
        }
      },
    };

    // ----------------------------------------------------------------
    // lib_feux — spark/fire particle spawned during explosion
    //
    // onLoad: AS DefineSprite_12_feux/frame_1/PlaceObject2_11_1/onClipEvent(load)
    //   _parent._rotation = random(360)
    //   vg = -6 * Math.random(); g = 1 * Math.random(); va = 0
    //   t = 100 + random(100); _xscale = t; _yscale = t
    //   dmax = 100; _X = 10 + random(20)
    //   d = dmax - random(70); acc = 5 + Math.random()*5
    //   vacc = 1.5 + 1.5 * Math.random()
    //
    // onEnterFrame: AS DefineSprite_12_feux/frame_1/PlaceObject2_11_1/onClipEvent(enterFrame)
    //   _rotation = random(360); t = 40 + random(80)
    //   _xscale = t; _yscale = t
    //   _parent._y += g
    //   _alpha = 150 - (va += vacc)
    //   _X = _X - (_X - d) / acc
    //   if (_alpha < 0) { _parent.removeMovieClip() }
    this.feuxSym = {
      name: "feux",
      totalFrames: 1,
      frames: textures.getFrames("lib_feux"),
      anchorX: feuxAnchor.x,
      anchorY: feuxAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_12_feux/frame_1/PlaceObject2_11_1/onClipEvent(load)
        // _parent._rotation = random(360) — rotate the feux container's parent
        if (clip.parent) {
          clip.parent.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        }
        clip.vars.vg = -6 * Math.random();
        clip.vars.g = 1 * Math.random();
        clip.vars.va = 0;
        const t = 100 + Math.floor(Math.random() * 100);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        const dmax = 100;
        clip.x = 10 + Math.floor(Math.random() * 20);
        clip.vars.d = dmax - Math.floor(Math.random() * 70);
        clip.vars.acc = 5 + Math.random() * 5;
        clip.vars.vacc = 1.5 + 1.5 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_12_feux/frame_1/PlaceObject2_11_1/onClipEvent(enterFrame)
        // _rotation = random(360)
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        const t = 40 + Math.floor(Math.random() * 80);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;

        const g = clip.vars.g as number;
        let va = clip.vars.va as number;
        const vacc = clip.vars.vacc as number;
        const d = clip.vars.d as number;
        const acc = clip.vars.acc as number;

        // _parent._y += g
        if (clip.parent) {
          clip.parent.y += g;
        }

        va += vacc;
        // AS: _alpha = 150 - va  (Flash 0-100 scale → 0-1)
        clip.alpha = (150 - va) / 100;
        clip.vars.va = va;

        clip.x = clip.x - (clip.x - d) / acc;

        if ((150 - va) < 0) {
          // _parent.removeMovieClip()
          clip.parent?.remove();
        }
      },
    };

    // ----------------------------------------------------------------
    // lib_plumes2 — upward feather particle (fireworks variant)
    //
    // onLoad: AS DefineSprite_6_plumes2/frame_1/PlaceObject2_5_1/onClipEvent(load)
    //   t = 30 + random(30); _xscale = t; duree = 60 + random(30); _yscale = t
    //   vy = -10 + 20 * Math.random(); vx = -10 + 20 * Math.random()
    //   vch = 0.1 + 0.1 * Math.random(); vr = 0.03 + 0.1 * Math.random()
    //   amp = 30 + random(50); a = 1.15; time = 0
    //
    // onEnterFrame: AS DefineSprite_6_plumes2/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
    //   if (time++ > duree) { _alpha -= 3.34 }
    //   if (_Y < 0) { drift + oscillate (same pattern as plumes) }
    this.plumes2Sym = {
      name: "plumes2",
      totalFrames: 1,
      frames: textures.getFrames("lib_plumes2"),
      anchorX: plumes2Anchor.x,
      anchorY: plumes2Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_6_plumes2/frame_1/PlaceObject2_5_1/onClipEvent(load)
        const t = 30 + Math.floor(Math.random() * 30);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.duree = 60 + Math.floor(Math.random() * 30);
        clip.vars.vy = -10 + 20 * Math.random();
        clip.vars.vx = -10 + 20 * Math.random();
        clip.vars.vch = 0.1 + 0.1 * Math.random();
        clip.vars.vr = 0.03 + 0.1 * Math.random();
        clip.vars.amp = 30 + Math.floor(Math.random() * 50);
        clip.vars.a = 1.15;
        clip.vars.time = 0;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_6_plumes2/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
        let time = clip.vars.time as number;
        const duree = clip.vars.duree as number;
        if (time++ > duree) {
          clip.alpha = clip.alpha - 3.34 / 100;
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
          clip.y = clip.y + vy;
          clip.x = clip.x + vx;
          vy *= 0.9;
          vx *= 0.9;
          amp *= 0.98;
          a += vr;
          // AS rotation in degrees → radians
          clip.rotation = (amp * Math.sin(a) * Math.PI) / 180;

          clip.vars.vy = vy;
          clip.vars.vx = vx;
          clip.vars.amp = amp;
          clip.vars.a = a;
        }
      },
    };

    // ----------------------------------------------------------------
    // DefineSprite_11 — inner "wing state" toggler (3-frame sprite)
    // frame_1/DoAction.as: gotoAndStop(random(3) + 2)
    // This is placed inside DefineSprite_24 at depth 25 (PlaceObject2_19_25).
    // Its enterFrame randomly toggles between frame 1 and frame 3.
    // We model it as a container-only symbol with 3 frames.
    const sprite11Sym: SymbolDefinition = {
      name: "sprite_11",
      totalFrames: 3,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_11/frame_1/DoAction.as
        // gotoAndStop(random(3) + 2) → frame indices 1, 2, or 3 (1-based)
        // → 0-based: random gives 0,1,2 → +2 → 2,3,4 → -1 → 1,2,3
        clip.gotoAndStop(Math.floor(Math.random() * 3) + 1);
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_24/frame_1/PlaceObject2_19_25/onClipEvent(enterFrame)
        // (same handler reused at frame_37)
        // if (random(4) == 1) { gotoAndStop(3) } else { gotoAndStop(1) }
        if (Math.floor(Math.random() * 4) === 1) {
          clip.gotoAndStop(2); // AS frame 3 → 0-based index 2
        } else {
          clip.gotoAndStop(0); // AS frame 1 → 0-based index 0
        }
      },
    };

    // ----------------------------------------------------------------
    // DefineSprite_2 — inner plumes spawner (placed inside shoot at depth 1)
    // frame_1/DoAction.as: spawn 10 "plumes" particles
    // frame_58/DoAction.as: stop()
    const sprite2Sym: SymbolDefinition = {
      name: "sprite_2",
      totalFrames: 58,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_2/frame_1/DoAction.as
            // c = 0; p = 0; while (p < 10) { attachMovie("plumes","plumes"+c,c); ... }
            let c = 0;
            let p = 0;
            while (p < 10) {
              const child = clip.attach(this.plumesSym, `plumes${c}`, c, ctx);
              child.vars.vx = 40 * (Math.random() - 0.5);
              child.vars.vy = 40 * (Math.random() - 0.5);
              c++;
              p++;
            }
          },
        ],
        [
          57,
          (clip) => {
            // AS: DefineSprite_2/frame_58/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // DefineSprite_24 — the bird / fireworks container
    // frame_1:  SOMA.playSound("bat_ailes") + place sprite_11 inner mc
    // frame_16: gotoAndPlay(1)
    // frame_58: SOMA.playSound("explo_fireworks")
    // frame_64: spawn 19 feux + 9 plumes2 + reset physics vars
    // frame_85: stop()
    const sprite24Sym: SymbolDefinition = {
      name: "sprite_24",
      totalFrames: 85,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_24/frame_1/DoAction.as
            // SOMA.playSound("bat_ailes") + implicit placement of sprite_11
            this.soundCallback?.("bat_ailes");
            // Place the wing-state toggler (PlaceObject2_19_25 = DefineSprite_11)
            clip.attach(sprite11Sym, "sprite_11_wing", 25, ctx);
          },
        ],
        [
          15,
          (clip) => {
            // AS: DefineSprite_24/frame_16/DoAction.as → gotoAndPlay(1)
            clip.gotoAndPlay(0);
          },
        ],
        [
          57,
          () => {
            // AS: DefineSprite_24/frame_58/DoAction.as → SOMA.playSound("explo_fireworks")
            this.soundCallback?.("explo_fireworks");
          },
        ],
        [
          63,
          (clip, ctx) => {
            // AS: DefineSprite_24/frame_64/DoAction.as
            // Spawn 19 "feux" sparks inside self
            let i = 1;
            while (i < 20) {
              clip.attach(this.feuxSym, `feux${i}`, i, ctx);
              i++;
            }
            // Spawn 9 "plumes2" at _parent (the shoot container)
            // eval("_parent.plumes2"+i).plume._x = _X; ... _y = _Y
            const parent = clip.parent;
            if (parent) {
              i = 1;
              while (i < 10) {
                const p2 = parent.attach(this.plumes2Sym, `plumes2${i}`, i, ctx);
                // AS: eval("_parent.plumes2"+i).plume._x = _X
                // The inner "plume" child is a sub-mc; here we position the
                // plumes2 clip itself at the bird's current position.
                p2.x = clip.x;
                p2.y = clip.y;
                i++;
              }
            }
            // g = 0; vy = 0; vx = 0 (reset physics for this mc)
            clip.vars.g = 0;
            clip.vars.vy = 0;
            clip.vars.vx = 0;

            // signalHit at the explosion frame
            this.runtime.signalHit();
          },
        ],
        [
          84,
          (clip) => {
            // AS: DefineSprite_24/frame_85/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // DefineSprite_3_shoot — outer 291-frame container wrapping the bird
    //
    // frame_1/DoAction.as:   _rotation = 0
    // frame_1/PlaceObject2_2_1/onClipEvent(load): t=70; scale 70%
    //   (PlaceObject2_2_1 is DefineSprite_2, the inner plumes-spawner)
    // frame_289/DoAction.as: _parent.removeMovieClip(); stop()
    this.shootSym = {
      name: "shoot",
      totalFrames: 291,
      frames: textures.getFrames("shoot"),
      anchorX: calculateAnchor({ width: 92.9, height: 92.9, offsetX: -43.5, offsetY: -74.2 }).x,
      anchorY: calculateAnchor({ width: 92.9, height: 92.9, offsetX: -43.5, offsetY: -74.2 }).y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_3_shoot/frame_1/DoAction.as → _rotation = 0
            clip.rotation = 0;

            // AS: PlaceObject2_2_1/onClipEvent(load): t=70; _xscale=t; _yscale=t
            // Attach sprite_2 (the inner plumes spawner) at depth 1.
            // onLoad of sprite_2's placed content sets scale to 70%.
            const inner = clip.attach(sprite2Sym, "sprite_2_inner", 1, ctx);
            inner.scaleX = 70 / 100;
            inner.scaleY = 70 / 100;

            // Attach the bird (sprite_24) at depth 2
            clip.attach(sprite24Sym, "sprite_24_bird", 2, ctx);
          },
        ],
        [
          288,
          (clip) => {
            // AS: DefineSprite_3_shoot/frame_289/DoAction.as
            // _parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.plumesSym);
    this.registry.register(this.feuxSym);
    this.registry.register(this.plumes2Sym);
    this.registry.register(sprite11Sym);
    this.registry.register(sprite2Sym);
    this.registry.register(sprite24Sym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback so frameScripts inside sprite_24 can fire sounds.
    this.soundCallback = callbacks.playSound;

    // Attach the shoot symbol at the target (root is already at target for
    // displayType=11). The harness does NOT auto-attach "shoot" for TargetCell;
    // we do it manually here from the main timeline.
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
