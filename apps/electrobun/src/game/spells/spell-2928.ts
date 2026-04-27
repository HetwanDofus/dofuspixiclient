/**
 * Spell 2928 — (Phoenix / Firework bird spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2928/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no `move` symbol and no caster-relative
 * positioning logic. The main content is a single `shoot` symbol (291 frames) anchored
 * at the target cell, which internally attaches child symbols. This is a pure
 * impact-at-target spell.
 *
 * Canonical AS layout:
 *
 *   Top-level main timeline:
 *     - frame_388/DoAction.as: this.removeMovieClip() — outer mc teardown (never
 *       reached in practice because shoot calls _parent.removeMovieClip at frame 289).
 *
 *   DefineSprite_24 (the main driver sprite, attached by the harness as "shoot"):
 *     - frame_1/DoAction.as: SOMA.playSound("bat_ailes")
 *     - frame_1/PlaceObject2_19_14/onClipEvent(enterFrame): wing-flap animation —
 *       randomly goto frame 3 or frame 1 each tick (the feather child's 3-frame cycle).
 *     - frame_16/DoAction.as: gotoAndPlay(1) — loops wing animation
 *     - frame_37/PlaceObject2_19_14/onClipEvent(enterFrame): same wing-flap logic
 *     - frame_58/DoAction.as: SOMA.playSound("explo_fireworks")
 *     - frame_64/DoAction.as: spawn 19 `feux` sparks on self + 9 `plumes2` on _parent;
 *       reset g/vy/vx to 0
 *     - frame_85/DoAction.as: stop()
 *
 *   DefineSprite_3_shoot (the outer shoot container, 291 frames):
 *     - frame_1/DoAction.as: _rotation = 0
 *     - frame_1/PlaceObject2_2_1/onClipEvent(load): t=70; _xscale=t; _yscale=t
 *       (this is an inner sub-sprite that gets scaled — we model it via the shoot clip itself)
 *     - frame_289/DoAction.as: _parent.removeMovieClip(); stop() — signals completion
 *
 *   DefineSprite_2 (feather burst container, 58 frames):
 *     - frame_1/DoAction.as: spawn 10 `plumes` children with random vx/vy
 *     - frame_58/DoAction.as: stop()
 *
 *   DefineSprite_21 (individual firework particle):
 *     - frame_1/DoAction.as: random rotation, scale 60-100%
 *
 *   DefineSprite_11 (small feather variant):
 *     - frame_1/DoAction.as: gotoAndStop(random(3) + 2) — pick frame 2-4
 *
 *   DefineSprite_25 (rocket/firework projectile):
 *     - frame_1/DoAction.as: stop()
 *     - frame_1/PlaceObject2_24_1/onClipEvent(load): seed vx=0, g=0.67, v=3.34, t=0
 *     - frame_1/PlaceObject2_24_1/onClipEvent(enterFrame): gravity physics; at t==150
 *       gotoAndPlay("exp"); on currentframe==3 spawn plumes particles
 *
 *   Library symbols:
 *     - plumes  — feather particle (upward drift). onLoad seeds scale/duration/velocity.
 *                 onEnterFrame: fade after duree, float upward with oscillating rotation.
 *     - plumes2 — feather particle (downward drift). Same physics but vy starts positive.
 *     - feux    — spark/fire particle. onLoad seeds rotation, scale, position.
 *                 onEnterFrame: random rotation/scale each frame, gravity drift, alpha decay,
 *                 remove when alpha < 0.
 *
 * The manifest has `shoot` in animations[] (291 frames, composite) and three library symbols.
 * The `shoot` animation entry is the composite DefineSprite_3_shoot baked timeline.
 * displayType=11 means harness attaches "shoot" at target via ProjectileLinear/TargetCell —
 * actually for TargetCell the harness does nothing special, just roots at target.
 * We attach shoot manually in onSpellStart since TargetCell harness doesn't auto-attach it.
 *
 * Wait — re-reading: for ProjectileLinear (20/21) the harness attaches "shoot" at target offset.
 * For TargetCell (11) the harness does nothing — the per-spell code must attach its own children.
 * This spell's AS shows DefineSprite_24 as the main driver which plays sounds and drives children.
 * DefineSprite_3_shoot wraps it. The manifest's single `animations["shoot"]` with 291 frames is
 * the composite baked output of DefineSprite_3_shoot.
 *
 * Since the manifest only has `shoot` in animations (no `move`), this is TargetCell (11).
 * We register `shoot` using the animations[] entry (no lib_ prefix) and attach it in onSpellStart.
 *
 * Sounds:
 *   - "bat_ailes" at frame 0 (main timeline / DefineSprite_24 frame_1)
 *   - "explo_fireworks" at frame 57 (DefineSprite_24 frame_58)
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

const PLUMES_BOUNDS = {
  width: 14.6,
  height: 14.6,
  offsetX: -9.9,
  offsetY: -52.45,
};

const PLUMES2_BOUNDS = {
  width: 14.6,
  height: 14.6,
  offsetX: -6.9,
  offsetY: 17.55,
};

const FEUX_BOUNDS = {
  width: 9,
  height: 9,
  offsetX: -4.55,
  offsetY: -4.4,
};

const SHOOT_BOUNDS = {
  width: 92.9,
  height: 92.9,
  offsetX: -43.5,
  offsetY: -74.2,
};

export class Spell2928 extends RuntimeSpell {
  readonly spellId = 2928;
  readonly displayType = SpellDisplayType.TargetCell;

  private plumesSym!: SymbolDefinition;
  private plumes2Sym!: SymbolDefinition;
  private feuxSym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const plumesAnchor = calculateAnchor(PLUMES_BOUNDS);
    const plumes2Anchor = calculateAnchor(PLUMES2_BOUNDS);
    const feuxAnchor = calculateAnchor(FEUX_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- lib_plumes — upward-drifting feather particle ----------
    // AS: DefineSprite_7_plumes/frame_1/PlaceObject2_5_1/onClipEvent(load)
    //     DefineSprite_7_plumes/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
    this.plumesSym = {
      name: "plumes",
      totalFrames: 1,
      frames: textures.getFrames("lib_plumes"),
      anchorX: plumesAnchor.x,
      anchorY: plumesAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7_plumes/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
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
        // AS DefineSprite_7_plumes/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
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
          clip.rotation = ((amp * Math.sin(a)) * Math.PI) / 180;
          clip.vars.vy = vy;
          clip.vars.vx = vx;
          clip.vars.amp = amp;
          clip.vars.a = a;
        }
      },
    };

    // ---- lib_plumes2 — downward-drifting feather particle -------
    // AS: DefineSprite_6_plumes2/frame_1/PlaceObject2_5_1/onClipEvent(load)
    //     DefineSprite_6_plumes2/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
    this.plumes2Sym = {
      name: "plumes2",
      totalFrames: 1,
      frames: textures.getFrames("lib_plumes2"),
      anchorX: plumes2Anchor.x,
      anchorY: plumes2Anchor.y,
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
          clip.rotation = ((amp * Math.sin(a)) * Math.PI) / 180;
          clip.vars.vy = vy;
          clip.vars.vx = vx;
          clip.vars.amp = amp;
          clip.vars.a = a;
        }
      },
    };

    // ---- lib_feux — spark/fire particle -------------------------
    // AS: DefineSprite_12_feux/frame_1/PlaceObject2_11_1/onClipEvent(load)
    //     DefineSprite_12_feux/frame_1/PlaceObject2_11_1/onClipEvent(enterFrame)
    this.feuxSym = {
      name: "feux",
      totalFrames: 1,
      frames: textures.getFrames("lib_feux"),
      anchorX: feuxAnchor.x,
      anchorY: feuxAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_12_feux/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(load).as
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
        clip.vars.dmax = 100;
        clip.x = 10 + Math.floor(Math.random() * 20);
        clip.vars.d = 100 - Math.floor(Math.random() * 70);
        clip.vars.acc = 5 + Math.random() * 5;
        clip.vars.vacc = 1.5 + 1.5 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_12_feux/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
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
        clip.vars.va = va;
        const newAlpha = (150 - va) / 100;
        clip.alpha = newAlpha;
        clip.x = clip.x - (clip.x - d) / acc;
        if (newAlpha < 0) {
          // _parent.removeMovieClip()
          if (clip.parent) {
            clip.parent.remove();
          }
        }
      },
    };

    // ---- shoot — 291-frame composite baked timeline -------------
    // AS: DefineSprite_3_shoot — outer container.
    // The manifest has this as a composite animation in animations[].
    // It internally contains DefineSprite_24 (the main driver with sounds),
    // DefineSprite_2 (feather burst), and other sub-sprites.
    //
    // Since this is a composite baked animation in animations[] (not librarySymbols[]),
    // we use textures.getFrames("shoot") (no lib_ prefix).
    //
    // Key frame scripts ported from the AS:
    //   frame_1:  _rotation = 0 (canonical shoot frame_1 override)
    //             PlaceObject2_2_1/onClipEvent(load): scale to 70%
    //   frame_289: _parent.removeMovieClip() + stop() → complete()
    //
    // The intermediate frames (sounds, feux/plumes spawning) are baked
    // into the composite SVG frames. We only need to handle the logic
    // frames: frame_1 (rotation reset + scale), and frame_289 (completion).
    // Sounds are handled separately: "bat_ailes" at spell start, "explo_fireworks"
    // via the sounds manifest entry at frame 57.
    //
    // For the sub-clip PlaceObject2_2_1 (which has onClipEvent(load) setting
    // t=70, _xscale=t, _yscale=t), since this is a composite baked sprite,
    // that sub-clip's scale is already baked into the composite frames.
    // We just apply the outer shoot clip's own frame_1 logic.
    //
    // The signalHit is canonically tied to the explosion moment.
    // Looking at the sounds manifest: "explo_fireworks" at frame 57 (0-based index).
    // That maps to DefineSprite_24/frame_58 → SOMA.playSound("explo_fireworks").
    // We signal hit at frame 57 (0-based).
    this.shootSym = {
      name: "shoot",
      totalFrames: 291,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_1/DoAction.as: _rotation = 0
            // AS DefineSprite_3_shoot/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as:
            //   t = 70; _xscale = t; _yscale = t;
            clip.rotation = 0;
            clip.scaleX = 70 / 100;
            clip.scaleY = 70 / 100;
          },
        ],
        [
          57,
          () => {
            // AS DefineSprite_24/frame_58/DoAction.as: SOMA.playSound("explo_fireworks")
            // Signal hit at the explosion frame (frame 58 in AS = index 57).
            this.soundCallback?.("explo_fireworks");
            this.runtime.signalHit();
          },
        ],
        [
          288,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_289/DoAction.as:
            //   _parent.removeMovieClip(); stop();
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
    context: SpellContext,
  ): void {
    // AS DefineSprite_24/frame_1/DoAction.as: SOMA.playSound("bat_ailes")
    // (also in manifest sounds[0] at frame 0)
    callbacks.playSound("bat_ailes");

    // Capture sound callback for use in frame scripts (explo_fireworks at frame 57).
    this.soundCallback = callbacks.playSound;

    // Attach the shoot composite at the root (target cell anchor).
    // For TargetCell, harness does not auto-attach anything — we must do it here.
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
