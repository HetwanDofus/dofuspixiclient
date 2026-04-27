/**
 * Spell 2905 — Tofu Fire (Tofu class fireworks spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2905/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The spell has a "shoot" symbol (DefineSprite_8_shoot,
 * 97 frames) whose frame_1 sets `_rotation = 0` — the canonical linear-projectile pattern.
 * There is no `move` symbol, no parabolic arc, no `duplicate`. The harness attaches `shoot`
 * at the target offset and rotates the container to face the target.
 *
 * Library symbols (from manifest.json librarySymbols[]):
 *   - lib_plumes — 20-frame feather/plume particle. onLoad seeds scale, drift velocities,
 *                  wobble params. onEnterFrame: drift upward, fade after duree frames.
 *   - lib_feux   — 1-frame spark particle. onLoad seeds rotation, velocity, drift params.
 *                  onEnterFrame: jitter rotation/scale, drift toward target distance, fade out.
 *
 * Additional container-only symbols referenced by AS but NOT in librarySymbols[]
 * (they appear only in the scripts as attachMovie targets):
 *   - shoot  (DefineSprite_8_shoot, 97 frames): frame_1 resets rotation; frame_97 removes
 *             parent and signals complete.
 *   - plumes2 (DefineSprite_6_plumes2 / DefineSprite_11_plumes2): feather2 particles with
 *              clip events. Registered with onLoad/onEnterFrame from the two plumes2 variants.
 *
 * Main timeline (frame_388 / frame_130): both fire `this.removeMovieClip()` — the outer mc
 * removal. We rely on shoot's frame_97 for canonical completion signal.
 *
 * The manifest `animations[]` entry "shoot" (97 frames) supplies the visual frames for the
 * shoot symbol — use `textures.getFrames("shoot")` (no lib_ prefix, it's in animations[]).
 *
 * Sound schedule (from manifest.json sounds[]):
 *   frame 0  → "tofu_fire"
 *   frame 19 → "explo_fireworks"
 *   frame 57 → "explo_fireworks"
 * These map to the DefineSprite_32 inner timeline sounds; in onSpellStart we play
 * "tofu_fire" for the main-timeline equivalent (frame_1 of the outer shoot wrapper).
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

// ---- Manifest bounds for library symbols ----
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

// shoot animation bounds from animations[] entry
const SHOOT_BOUNDS = {
  width: 92.9,
  height: 92.9,
  offsetX: -43.5,
  offsetY: -74.2,
};

export class Spell2905 extends RuntimeSpell {
  readonly spellId = 2905;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  // Hold refs so onSpellStart can use them
  private plumesSym!: SymbolDefinition;
  private feuxSym!: SymbolDefinition;
  private plumes2Sym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  // Sound callback captured for use inside frame scripts
  private playSoundFn?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const plumesAnchor = calculateAnchor(PLUMES_BOUNDS);
    const feuxAnchor = calculateAnchor(FEUX_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ----------------------------------------------------------------
    // lib_plumes — 20-frame feather drift particle
    // Used by DefineSprite_7 (inner of shoot) and DefineSprite_2 (same
    // structure). Both share identical plumes semantics.
    //
    // onLoad: AS DefineSprite_12_plumes/frame_1/PlaceObject2_10_1/CLIPACTIONRECORD onClipEvent(load).as
    //   t = 30 + random(30); _xscale = t; duree = 20 + random(30); _yscale = t;
    //   vy = 2 + 2*Math.random(); vx = -10 + 20*Math.random();
    //   vch = 0.3 + 0.3*Math.random(); vr = 0.1 + 0.3*Math.random();
    //   amp = 30 + random(50); a = 1.15; time = 0;
    //
    // onEnterFrame: AS DefineSprite_12_plumes/frame_1/PlaceObject2_10_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   if(time++ > duree) _alpha -= 10;
    //   if(_Y < 0) { _Y += (vy += vch); _X += vx; vy *= 0.9; vx *= 0.9; amp *= 0.98; _rotation = amp*sin(a+=vr) }
    // ----------------------------------------------------------------
    this.plumesSym = {
      name: "plumes",
      totalFrames: 20,
      frames: textures.getFrames("lib_plumes"),
      anchorX: plumesAnchor.x,
      anchorY: plumesAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_12_plumes/frame_1/PlaceObject2_10_1/CLIPACTIONRECORD onClipEvent(load).as
        const t = 30 + Math.floor(Math.random() * 30);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.duree = 20 + Math.floor(Math.random() * 30);
        clip.vars.vy = 2 + 2 * Math.random();
        clip.vars.vx = -10 + 20 * Math.random();
        clip.vars.vch = 0.3 + 0.3 * Math.random();
        clip.vars.vr = 0.1 + 0.3 * Math.random();
        clip.vars.amp = 30 + Math.floor(Math.random() * 50);
        clip.vars.a = 1.15;
        clip.vars.time = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_12_plumes/frame_1/PlaceObject2_10_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let time = clip.vars.time as number;
        const duree = clip.vars.duree as number;
        if (time++ > duree) {
          clip.alpha = clip.alpha - 10 / 100;
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
          clip.rotation = (amp * Math.sin(a) * Math.PI) / 180;
          clip.vars.vy = vy;
          clip.vars.vx = vx;
          clip.vars.amp = amp;
          clip.vars.a = a;
        }
      },
    };

    // ----------------------------------------------------------------
    // lib_feux — 1-frame spark/fire particle
    // onLoad: AS DefineSprite_5_feux/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
    //   _parent._rotation = random(360); vg=-3*Math.random(); g=2*Math.random();
    //   va=0; t=50+random(50); _xscale=t; _yscale=t; dmax=100;
    //   _X=10+random(20); d=dmax-random(70); acc=5+Math.random()*5; vacc=3+3*Math.random();
    //
    // onEnterFrame: AS DefineSprite_5_feux/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation=random(360); t=20+random(80); _xscale=t; _yscale=t;
    //   _parent._y += g; _alpha=150-(va+=vacc); _X=_X-(_X-d)/acc;
    //   if(_alpha<0) _parent.removeMovieClip();
    //
    // NOTE: This feux variant is from DefineSprite_5 (used inside DefineSprite_32).
    // DefineSprite_12_feux has different parameters but AS attaches under name "feux"
    // in both DefineSprite_32/frame_22 and frame_64. We register the primary variant
    // (DefineSprite_5_feux params) since that is what is named "feux" in the library
    // (characterId 5 → name "feux" in librarySymbols).
    // ----------------------------------------------------------------
    this.feuxSym = {
      name: "feux",
      totalFrames: 1,
      frames: textures.getFrames("lib_feux"),
      anchorX: feuxAnchor.x,
      anchorY: feuxAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_5_feux/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
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
        // AS DefineSprite_5_feux/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        const t = 20 + Math.floor(Math.random() * 80);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        const g = clip.vars.g as number;
        let va = clip.vars.va as number;
        const vacc = clip.vars.vacc as number;
        const d = clip.vars.d as number;
        const acc = clip.vars.acc as number;
        if (clip.parent) {
          clip.parent.y += g;
        }
        va += vacc;
        clip.vars.va = va;
        clip.alpha = (150 - va) / 100;
        clip.x = clip.x - (clip.x - d) / acc;
        if (clip.alpha < 0) {
          if (clip.parent) {
            clip.parent.remove();
          }
        }
      },
    };

    // ----------------------------------------------------------------
    // plumes2 — container-only feather2 particle (NOT in librarySymbols[])
    // Attached by DefineSprite_32 frame_22 and frame_64 as "plumes2"+i
    // onto _parent. The inner "plume" child clip is positioned.
    //
    // The AS for plumes2 exists in two variants:
    //   DefineSprite_6_plumes2  (used in the main spell structure)
    //   DefineSprite_11_plumes2 (alternate variant)
    //
    // We use DefineSprite_6_plumes2 parameters (duree=60+random(30), vy=-10+20*random)
    // as they represent the longer-lived variant attached at the target.
    //
    // onLoad: AS DefineSprite_6_plumes2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    // onEnterFrame: AS DefineSprite_6_plumes2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // ----------------------------------------------------------------
    this.plumes2Sym = {
      name: "plumes2",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_6_plumes2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
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
        // AS DefineSprite_6_plumes2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
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
          clip.rotation = (amp * Math.sin(a) * Math.PI) / 180;
          clip.vars.vy = vy;
          clip.vars.vx = vx;
          clip.vars.amp = amp;
          clip.vars.a = a;
        }
      },
    };

    // ----------------------------------------------------------------
    // shoot — 97-frame visual animation (container that plays shoot frames)
    // This is DefineSprite_8_shoot, which uses the animations["shoot"] frames.
    //
    // frame_1 / DoAction.as: _rotation = 0;
    // frame_1 / PlaceObject2_7_1 / onClipEvent(load): t=70; _xscale=t; _yscale=t;
    // frame_97 / DoAction.as: _parent.removeMovieClip(); stop();
    //
    // The inner child (PlaceObject2_7_1) uses lib_plumes (characterId 7 → "plumes").
    // We model the overall container using the shoot animation frames directly.
    // The inner plumes child within shoot is handled by the lib_plumes symbol
    // with the onLoad scaling (t=70 → scale 0.7).
    // ----------------------------------------------------------------
    this.shootSym = {
      name: "shoot",
      totalFrames: 97,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_8_shoot/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(load).as
        // The inner PlaceObject2_7_1 child scales to 70%. We apply this to the
        // shoot clip's own scale since it carries the frames directly.
        const t = 70;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_8_shoot/frame_1/DoAction.as
            // _rotation = 0;  — override any harness rotation
            clip.rotation = 0;
          },
        ],
        [
          96,
          (clip) => {
            // AS DefineSprite_8_shoot/frame_97/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.plumesSym);
    this.registry.register(this.feuxSym);
    this.registry.register(this.plumes2Sym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS frame_1 of the outer timeline / DefineSprite_32/frame_1/DoAction.as:
    // SOMA.playSound("tofu_fire");
    // Manifest sounds[] also schedules tofu_fire at frame 0.
    callbacks.playSound("tofu_fire");
    this.playSoundFn = callbacks.playSound;
  }
}
