/**
 * Spell 2926 — (Fireworks / Bird spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2926/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single `shoot` symbol
 * (DefineSprite_3_shoot) that is a 291-frame composite animation placed at
 * the target cell. The harness attaches `shoot` for ProjectileLinear/Ballistic
 * but here the `shoot` is the entire authored content — there is no `move`,
 * no ballistic arc, no caster-relative logic. The outer main timeline
 * (DefineSprite_24) plays sound, drives child attaches (feux, plumes2), and
 * stops at frame 85. Frame 289 of shoot removes the parent and completes.
 *
 * Architecture note: The canonical SWF has a complex nested structure:
 *   - DefineSprite_3_shoot (291 frames) — the top-level spell container
 *     placed at the target cell. Its frame_1 sets _rotation=0. It has a
 *     child (PlaceObject2_2_1) that is a sub-container (DefineSprite_2)
 *     whose frame_1 spawns 10 `plumes` particles, frame_58 stops.
 *     DefineSprite_2 contains a child DefineSprite_24 (the main firework
 *     body, 85 frames):
 *       frame_1:  plays "bat_ailes" sound; has a child (PlaceObject2_19_21,
 *                 DefineSprite_11) that randomly gotoAndStop(1) or (3).
 *       frame_16: gotoAndPlay(1) — looping flap.
 *       frame_37: same child enterFrame handler.
 *       frame_58: plays "explo_fireworks" sound.
 *       frame_64: attaches 19 `feux` particles; attaches 9 `plumes2`
 *                 particles to _parent.
 *       frame_85: stop().
 *   - DefineSprite_21 — "plumes" inner content (feather-like item), frame_1
 *     sets random rotation + scale.
 *   - lib_plumes (DefineSprite_7) — feather particle spawned from DefineSprite_2
 *     and from the firework explosion. Has onLoad + onEnterFrame physics.
 *   - lib_plumes2 (DefineSprite_6) — upward-floating feather variant.
 *   - lib_feux (DefineSprite_12) — spark particle spawned during explosion.
 *
 * The `shoot` is in animations[] (not librarySymbols[]) and is the only
 * top-level timeline. The harness for displayType=11 places the root at
 * target cell; we attach `shoot` explicitly from onSpellStart since the
 * canonical SWF places it on the main timeline (it IS the spell).
 *
 * Signal flow:
 *   - signalHit: fired at shoot frame_1 (frame index 0) — the spell
 *     "hits" immediately on landing (impact is instantaneous, all subsequent
 *     frames are the burn/explode animation). Alternatively it could be at
 *     the explosion frame (64 of DefineSprite_24). Using frame 0 of shoot
 *     as the hit frame to match "projectile arrives = hit".
 *   - complete: shoot frame_289 → _parent.removeMovieClip() →
 *     this.runtime.complete().
 *
 * Library symbols:
 *   - lib_plumes — feather particle. onLoad seeds vx/vy ±20, scale t∈[30,60],
 *     duree, amp, a, vr, vch, time. onEnterFrame oscillates + fades after duree.
 *   - lib_plumes2 — upward feather variant. Same physics but vy positive (upward).
 *   - lib_feux — spark. onLoad seeds rotation, vg, g, t, dmax, d, acc, vacc.
 *     onEnterFrame moves toward target d, fades; removes parent when alpha < 0.
 *
 * Main timeline: shoot is placed at depth 1 on root; sounds played from
 * frameScripts inside DefineSprite_24 sub-timeline (modelled as sub-clips
 * within shoot's frame_0 attach chain).
 *
 * Implementation simplification: DefineSprite_24 (the firework body inside
 * DefineSprite_2 inside shoot) is modelled as a frameScript-driven sub-
 * symbol. DefineSprite_2 is a container that spawns plumes on frame_1 and
 * stops on frame_58. DefineSprite_21 is the feather "plume" inner visual.
 * DefineSprite_11 is the wing-flap randomizer (just randomizes between frames).
 * DefineSprite_25 is the rocket/firework projectile internal sub-clip (not
 * used directly — it's an internal sub of DefineSprite_24 per the script
 * paths; however the manifest shows it is not in librarySymbols, meaning
 * it is an internal authored timeline of the SWF not exposed as attachMovie).
 * We model the essential behaviour: sounds, particle spawning, completion.
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

// --- Bounds from manifest librarySymbols[] ---

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

// --- Bounds from manifest animations[] (shoot) ---

const SHOOT_BOUNDS = {
  width: 92.9,
  height: 92.9,
  offsetX: -43.5,
  offsetY: -74.2,
};

export class Spell2926 extends RuntimeSpell {
  readonly spellId = 2926;
  readonly displayType = SpellDisplayType.TargetCell;

  // Symbols stored as instance fields so frameScripts can reference them.
  private plumesSym!: SymbolDefinition;
  private plumes2Sym!: SymbolDefinition;
  private feuxSym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  // Sound callback captured in onSpellStart for use in sub-clip frameScripts.
  private playSoundFn?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const plumesAnchor = calculateAnchor(PLUMES_BOUNDS);
    const plumes2Anchor = calculateAnchor(PLUMES2_BOUNDS);
    const feuxAnchor = calculateAnchor(FEUX_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- lib_plumes — feather particle (upward drift / oscillate) ----
    // AS: DefineSprite_7_plumes/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_7_plumes/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // Also: DefineSprite_21/frame_1/DoAction.as runs when the inner content is placed.
    // In canonical AS, each "plumes" instance has an inner child (DefineSprite_21)
    // that randomizes its own rotation+scale. We fold that into onLoad for simplicity
    // since DefineSprite_21 has no enterFrame behaviour.
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
        clip.vars.duree = 60 + Math.floor(Math.random() * 30);
        clip.scaleY = t / 100;
        clip.vars.vy = 2 + 2 * Math.random();
        clip.vars.vx = -10 + 20 * Math.random();
        clip.vars.vch = 0.1 + 0.1 * Math.random();
        clip.vars.vr = 0.03 + 0.1 * Math.random();
        clip.vars.amp = 30 + Math.floor(Math.random() * 50);
        clip.vars.a = 1.15;
        clip.vars.time = 0;
        // AS: DefineSprite_21/frame_1/DoAction.as — inner content random rotation+scale
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        const tInner = 60 + Math.floor(Math.random() * 40);
        // scaleX/Y already set above; the inner DefineSprite_21 scale is applied
        // on the same visual node in AS (nested mc), here we fold it in.
        clip.scaleX = (t / 100) * (tInner / 100);
        clip.scaleY = (t / 100) * (tInner / 100);
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_7_plumes/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
        let time = clip.vars.time as number;
        const duree = clip.vars.duree as number;
        time++;
        clip.vars.time = time;
        if (time > duree) {
          clip.alpha = clip.alpha - 6.34 / 100;
          if (clip.alpha <= 0) {
            clip.remove();
            return;
          }
        }
        if (clip.y < 0) {
          let vy = clip.vars.vy as number;
          const vch = clip.vars.vch as number;
          let vx = clip.vars.vx as number;
          let amp = clip.vars.amp as number;
          let a = clip.vars.a as number;
          const vr = clip.vars.vr as number;
          vy += vch;
          clip.y = clip.y + vy;
          clip.x = clip.x + vx;
          vy *= 0.9;
          vx *= 0.9;
          amp *= 0.98;
          clip.rotation = (amp * Math.sin(a + vr)) * Math.PI / 180;
          a += vr;
          clip.vars.vy = vy;
          clip.vars.vx = vx;
          clip.vars.amp = amp;
          clip.vars.a = a;
        }
      },
    };

    // ---- lib_plumes2 — upward feather variant ----
    // AS: DefineSprite_6_plumes2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_6_plumes2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
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
        // AS: DefineSprite_6_plumes2/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
        let time = clip.vars.time as number;
        const duree = clip.vars.duree as number;
        time++;
        clip.vars.time = time;
        if (time > duree) {
          clip.alpha = clip.alpha - 3.34 / 100;
          if (clip.alpha <= 0) {
            clip.remove();
            return;
          }
        }
        if (clip.y < 0) {
          let vy = clip.vars.vy as number;
          const vch = clip.vars.vch as number;
          let vx = clip.vars.vx as number;
          let amp = clip.vars.amp as number;
          let a = clip.vars.a as number;
          const vr = clip.vars.vr as number;
          vy += vch;
          clip.y = clip.y + vy;
          clip.x = clip.x + vx;
          vy *= 0.9;
          vx *= 0.9;
          amp *= 0.98;
          clip.rotation = (amp * Math.sin(a + vr)) * Math.PI / 180;
          a += vr;
          clip.vars.vy = vy;
          clip.vars.vx = vx;
          clip.vars.amp = amp;
          clip.vars.a = a;
        }
      },
    };

    // ---- lib_feux — spark/fire particle ----
    // AS: DefineSprite_12_feux/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_12_feux/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // Note: in canonical AS the _parent (the feux mc wrapper) gets _rotation and _y changes.
    // Here clip IS the feux particle — we apply those to clip directly.
    this.feuxSym = {
      name: "feux",
      totalFrames: 1,
      frames: textures.getFrames("lib_feux"),
      anchorX: feuxAnchor.x,
      anchorY: feuxAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_12_feux/frame_1/PlaceObject2_11_1/onClipEvent(load)
        // _parent._rotation = random(360) — applies to feux wrapper mc
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        clip.vars.vg = -6 * Math.random();
        clip.vars.g = 1 * Math.random();
        clip.vars.va = 0;
        const t = 100 + Math.floor(Math.random() * 100);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.dmax = 100;
        clip.x = 10 + Math.floor(Math.random() * 20);
        clip.vars.d = 100 - Math.floor(Math.random() * 70);
        clip.vars.acc = 5 + Math.random() * 5;
        clip.vars.vacc = 1.5 + 1.5 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_12_feux/frame_1/PlaceObject2_11_1/onClipEvent(enterFrame)
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        const t = 40 + Math.floor(Math.random() * 80);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        // _parent._y += g — move the parent (feux wrapper) down
        const g = clip.vars.g as number;
        clip.y = clip.y + g;
        let va = clip.vars.va as number;
        const vacc = clip.vars.vacc as number;
        va += vacc;
        clip.vars.va = va;
        clip.alpha = (150 - va) / 100;
        const d = clip.vars.d as number;
        const acc = clip.vars.acc as number;
        clip.x = clip.x - (clip.x - d) / acc;
        if (clip.alpha < 0) {
          clip.remove();
        }
      },
    };

    // ---- shoot — 291-frame top-level composite ----
    // AS: DefineSprite_3_shoot — placed at target cell, IS the spell.
    // frame_1/DoAction.as: _rotation = 0
    // frame_1 has a child (PlaceObject2_2_1 = DefineSprite_2) with onClipEvent(load):
    //   t = 70; _xscale = t; _yscale = t;
    // DefineSprite_2/frame_1: spawns 10 plumes; frame_58: stop()
    // DefineSprite_2 contains DefineSprite_24 (the firework body).
    // frame_289/DoAction.as: _parent.removeMovieClip(); stop();
    //
    // We model DefineSprite_2 + DefineSprite_24 as inline logic within
    // shoot's frameScripts, since they are authored children placed on
    // shoot's timeline (not attachMovie'd library symbols).
    // The "shoot" symbol uses the animations[] textures (no lib_ prefix).
    const shootFrames = textures.getFrames("shoot");
    this.shootSym = {
      name: "shoot",
      totalFrames: 291,
      frames: shootFrames,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_3_shoot/frame_1/DoAction.as
            // _rotation = 0 — override any harness-applied rotation
            clip.rotation = 0;

            // AS: DefineSprite_3_shoot/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load)
            // t = 70; _xscale = t; _yscale = t;
            // This is the inner container (DefineSprite_2) placed on shoot's frame_1.
            // We model it as a sub-clip attached here.
            // DefineSprite_2/frame_1/DoAction.as: spawns 10 plumes particles
            // DefineSprite_2/frame_58/DoAction.as: stop()
            // DefineSprite_24 (the firework body) is also inside DefineSprite_2.
            // We attach an inline "body" symbol to represent this.
            const bodySym: SymbolDefinition = {
              name: "body",
              totalFrames: 85,
              frames: [],
              anchorX: 0.5,
              anchorY: 0.5,
              onLoad: (bodyClip) => {
                // AS: PlaceObject2_2_1/onClipEvent(load)
                // t = 70; _xscale = t; _yscale = t;
                bodyClip.scaleX = 70 / 100;
                bodyClip.scaleY = 70 / 100;
              },
              frameScripts: new Map([
                [
                  0,
                  (bodyClip, bodyCtx) => {
                    // AS: DefineSprite_2/frame_1/DoAction.as — spawn 10 plumes
                    // c = 0; p = 0; while(p < 10) { attachMovie("plumes","plumes"+c,c); ... }
                    for (let p = 0; p < 10; p++) {
                      const pClip = bodyClip.attach(
                        this.plumesSym,
                        `plumes${p}`,
                        p,
                        bodyCtx
                      );
                      // eval("this.plumes" + c).vx = 40 * (Math.random() - 0.5)
                      // eval("this.plumes" + c).vy = 40 * (Math.random() - 0.5)
                      // These override the onLoad-seeded vx/vy for the initial plumes.
                      pClip.vars.vx = 40 * (Math.random() - 0.5);
                      pClip.vars.vy = 40 * (Math.random() - 0.5);
                    }
                    // AS: DefineSprite_24/frame_1/DoAction.as — SOMA.playSound("bat_ailes")
                    this.playSoundFn?.("bat_ailes");
                    // Signal hit immediately when shoot begins (spell lands at target)
                    this.runtime.signalHit();
                  },
                ],
                [
                  57,
                  (bodyClip) => {
                    // AS: DefineSprite_2/frame_58/DoAction.as — stop()
                    // AND: DefineSprite_24/frame_58/DoAction.as — SOMA.playSound("explo_fireworks")
                    this.playSoundFn?.("explo_fireworks");
                    bodyClip.stop();
                  },
                ],
                [
                  63,
                  (bodyClip, bodyCtx) => {
                    // AS: DefineSprite_24/frame_64/DoAction.as
                    // Spawn 19 feux particles (i = 1; while(i < 20))
                    for (let i = 1; i < 20; i++) {
                      bodyClip.attach(this.feuxSym, `feux${i}`, i, bodyCtx);
                    }
                    // Spawn 9 plumes2 particles on _parent (i = 1; while(i < 10))
                    // _parent here is shoot (bodyClip.parent)
                    const shootClip = bodyClip.parent;
                    if (shootClip) {
                      for (let i = 1; i < 10; i++) {
                        const p2 = shootClip.attach(
                          this.plumes2Sym,
                          `plumes2${i}`,
                          100 + i,
                          bodyCtx
                        );
                        // eval("_parent.plumes2" + i).plume._x = _X
                        // eval("_parent.plumes2" + i).plume._y = _Y
                        // _X/_Y of bodyClip within shoot
                        p2.x = bodyClip.x;
                        p2.y = bodyClip.y;
                      }
                    }
                  },
                ],
                [
                  84,
                  (bodyClip) => {
                    // AS: DefineSprite_24/frame_85/DoAction.as — stop()
                    bodyClip.stop();
                  },
                ],
              ]),
            };

            clip.attach(bodySym, "body", 1, ctx);
          },
        ],
        [
          288,
          (clip) => {
            // AS: DefineSprite_3_shoot/frame_289/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.plumesSym);
    this.registry.register(this.plumes2Sym);
    this.registry.register(this.feuxSym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Capture sound callback for use in sub-clip frameScripts.
    this.playSoundFn = callbacks.playSound;

    // The canonical SWF places shoot on the main timeline (frame_1).
    // For displayType=11, the harness does NOT auto-attach shoot —
    // we attach it manually here as the root content.
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
