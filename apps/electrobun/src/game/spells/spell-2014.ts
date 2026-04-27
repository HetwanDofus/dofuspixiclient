/**
 * Spell 2014 — (Iop / fire arrow variant).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2014/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The AS scripts confirm this pattern:
 *   - DefineSprite_7 (the "move"/caster-side sprite) positions itself at
 *     _parent.cellFrom and rotates to _parent.angle — classic caster-anchored
 *     linear projectile behaviour.
 *   - DefineSprite_5_shoot positions itself at _parent.cellTo and resets
 *     _rotation = 0 (canonical shoot override), signals hit via this.end(),
 *     then removes _parent at frame_286.
 *   - The harness for displayType=20 attaches "shoot" at the target-local
 *     offset inside a rotated root container.
 *
 * Library symbols:
 *   - lib_plumes — feather/smoke particle. onLoad seeds physics (vx, vy,
 *     angle, scale, duree, vch, vr, amp, fr). onEnterFrame: fades after
 *     duree frames; while _Y < 0 applies gravity+friction+oscillation.
 *
 * Authored composite symbols (container-only):
 *   - shoot  (DefineSprite_5_shoot, 288 frames from animations[]):
 *       Has authored frame textures (288 SVG frames). frame_1: position at
 *       cellTo, reset rotation to 0, call signalHit. frame_286: remove parent
 *       and complete.
 *       Also has a PlaceObject2_4_1 sub-clip (DefineSprite_4) with onLoad that
 *       seeds scale=70. We model DefineSprite_4 as an inner sub-symbol.
 *   - DefineSprite_4 (inner container inside shoot, 49 frames):
 *       frame_7: spawn 10 "plumes" particles. frame_49: stop().
 *   - DefineSprite_7 (caster-side sprite, 7 frames):
 *       frame_1: position at cellFrom, rotate to angle.
 *       frame_7: stop().
 *
 * Main timeline (frame_2/DoAction.as): stop() — no sound.
 *
 * NOTE: The manifest animations[] list has a single "shoot" entry with 288
 * frames. DefineSprite_7 is a caster-side sprite with no authored textures
 * in the manifest (container-only). The harness for displayType=20 places
 * the root at the caster and rotates toward the target; "shoot" is placed
 * at the target-local offset.
 *
 * For displayType=20 the harness attaches "shoot" at the target-relative
 * position; we additionally need to attach the caster-side sprite_7 manually
 * from onSpellStart, since it is NOT one of the canonical harness symbols.
 * signalHit is called from shoot's frame_1 (this.end() in canonical AS).
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
  width: 21.75,
  height: 6.65,
  offsetX: -14,
  offsetY: -34.45,
};

export class Spell2014 extends RuntimeSpell {
  readonly spellId = 2014;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  private sprite7Sym!: SymbolDefinition;
  private sprite4Sym!: SymbolDefinition;
  private plumesSym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const plumesAnchor = calculateAnchor(PLUMES_BOUNDS);

    // ---- lib_plumes — feather/smoke particle --------------------
    // AS: DefineSprite_3_plumes/frame_1/PlaceObject2_2_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_3_plumes/frame_1/PlaceObject2_2_1/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.plumesSym = {
      name: "plumes",
      totalFrames: 1,
      frames: textures.getFrames("lib_plumes"),
      anchorX: plumesAnchor.x,
      anchorY: plumesAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_3_plumes/.../onClipEvent(load):
        //   angle = _parent._parent._parent._parent.angle * PI / 180
        //   t = 30 + random(30)
        //   _xscale = t; _yscale = t
        //   duree = 60 + random(90)
        //   vy = -10 * Math.random() + 10 * Math.sin(angle)
        //   vx = -20 + 40 * Math.random() + 10 * Math.cos(angle)
        //   vch = 0.1 + 0.1 * Math.random()
        //   vr  = 0.03 + 0.1 * Math.random()
        //   amp = 30 + random(23)
        //   fr  = 0.8 + 0.15 * Math.random()
        //
        // clip is the plumes particle.
        // _parent = DefineSprite_4 (the inner container that spawned it)
        // _parent._parent = shoot (DefineSprite_5_shoot)
        // _parent._parent._parent = root (outer mc)
        // _parent._parent._parent._parent.angle — one more hop up which
        // in the harness context would be the root's parent in AS. The
        // root.vars.angle is set by the harness for all displayTypes.
        // We walk up as far as the root and read angle from root.vars.
        const sprite4 = clip.parent;
        const shoot = sprite4?.parent;
        const root = shoot?.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        const angle = (angleDeg * Math.PI) / 180;

        clip.vars.a = 0;
        clip.vars.time = 0;
        clip.vars.angle = angle;
        const t = 30 + Math.floor(Math.random() * 30);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.t = t;
        const duree = 60 + Math.floor(Math.random() * 90);
        clip.vars.duree = duree;
        clip.vars.vy = -10 * Math.random() + 10 * Math.sin(angle);
        clip.vars.vx = -20 + 40 * Math.random() + 10 * Math.cos(angle);
        clip.vars.vch = 0.1 + 0.1 * Math.random();
        clip.vars.vr = 0.03 + 0.1 * Math.random();
        clip.vars.amp = 30 + Math.floor(Math.random() * 23);
        clip.vars.fr = 0.8 + 0.15 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3_plumes/.../onClipEvent(enterFrame):
        //   if(time++ > duree) { _alpha -= 3.3 }
        //   if(_Y < 0) {
        //     _Y += (vy += vch); _X += vx;
        //     vy *= fr; vx *= fr;
        //     amp *= 0.98;
        //     _rotation = amp * Math.cos(a += vr);
        //   }
        let time = clip.vars.time as number;
        const duree = clip.vars.duree as number;
        let vy = clip.vars.vy as number;
        let vx = clip.vars.vx as number;
        const vch = clip.vars.vch as number;
        const vr = clip.vars.vr as number;
        let amp = clip.vars.amp as number;
        const fr = clip.vars.fr as number;
        let a = clip.vars.a as number;

        if (time++ > duree) {
          clip.alpha = Math.max(0, clip.alpha - 3.3 / 100);
        }
        clip.vars.time = time;

        if (clip.y < 0) {
          vy += vch;
          clip.y += vy;
          clip.x += vx;
          vy *= fr;
          vx *= fr;
          amp *= 0.98;
          a += vr;
          // AS rotation in degrees → radians
          clip.rotation = (amp * Math.cos(a) * Math.PI) / 180;
          clip.vars.vy = vy;
          clip.vars.vx = vx;
          clip.vars.amp = amp;
          clip.vars.a = a;
        }
      },
    };

    // ---- DefineSprite_4 — inner container inside shoot -----------
    // AS: DefineSprite_4/frame_7/DoAction.as — spawns 10 plumes
    // AS: DefineSprite_4/frame_49/DoAction.as — stop()
    // onLoad from PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load):
    //   t = 70; _xscale = t; _yscale = t;
    this.sprite4Sym = {
      name: "sprite4",
      totalFrames: 49,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_5_shoot/frame_1/PlaceObject2_4_1/
        //    CLIPACTIONRECORD onClipEvent(load):
        //   t = 70; _xscale = t; _yscale = t;
        clip.scaleX = 70 / 100;
        clip.scaleY = 70 / 100;
      },
      frameScripts: new Map([
        [
          6,
          (clip, ctx) => {
            // AS DefineSprite_4/frame_7/DoAction.as:
            //   c = 0; p = 0;
            //   while(p < 10) {
            //     this.attachMovie("plumes","plumes" + c, c);
            //     eval("this.plumes" + c).vx = 40 * (Math.random() - 0.5);
            //     eval("this.plumes" + c).vy = 40 * (Math.random() - 0.5);
            //     c++; p++;
            //   }
            // NOTE: The AS sets vx/vy AFTER attachMovie (after onLoad has
            // already run). We override clip.vars after attach here.
            for (let p = 0; p < 10; p++) {
              const child = clip.attach(
                this.plumesSym,
                `plumes${p}`,
                p,
                ctx,
              );
              // Override the onLoad-seeded vx/vy with the outer values
              child.vars.vx = 40 * (Math.random() - 0.5);
              child.vars.vy = 40 * (Math.random() - 0.5);
            }
          },
        ],
        [
          48,
          (clip) => {
            // AS DefineSprite_4/frame_49/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_7 — caster-side sprite (7 frames) ----------
    // AS: DefineSprite_7/frame_1/DoAction.as:
    //   _X = _parent.cellFrom.x;
    //   _Y = _parent.cellFrom.y - 20;
    //   _rotation = _parent.angle;
    // AS: DefineSprite_7/frame_7/DoAction.as: stop()
    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 7,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_7/frame_1/DoAction.as
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 20;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          6,
          (clip) => {
            // AS DefineSprite_7/frame_7/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- shoot — 288-frame main impact timeline ------------------
    // AS: DefineSprite_5_shoot/frame_1/DoAction.as:
    //   _rotation = 0;
    //   _X = _parent.cellTo.x;
    //   _Y = _parent.cellTo.y - 20;
    //   this.end() → signalHit
    // AS: DefineSprite_5_shoot/frame_286/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    // Also places DefineSprite_4 (sprite4) at depth 1 with onLoad(load)
    // seeding scale=70 — we attach sprite4 from frame_1.
    this.shootSym = {
      name: "shoot",
      totalFrames: 288,
      frames: textures.getFrames("shoot"),
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_5_shoot/frame_1/DoAction.as:
            //   _rotation = 0;
            //   _X = _parent.cellTo.x;
            //   _Y = _parent.cellTo.y - 20;
            //   this.end();
            clip.rotation = 0;
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y - 20;
            }
            this.runtime.signalHit();
            // Attach the inner sprite4 sub-clip (PlaceObject2_4_1).
            // onLoad is fired by attach() before frameScripts[0] of
            // sprite4, matching canonical Flash evaluation order.
            clip.attach(this.sprite4Sym, "sprite4", 1, ctx);
          },
        ],
        [
          285,
          (clip) => {
            // AS DefineSprite_5_shoot/frame_286/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.plumesSym);
    this.registry.register(this.sprite4Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline frame_2/DoAction.as: stop() — no sound.
    // The harness (ProjectileLinear) attaches "shoot" at the target-local
    // offset automatically. We need to also attach the caster-side
    // sprite7 on the root since it is not managed by the harness.
    this.root.attach(this.sprite7Sym, "sprite7", 1, context);
  }
}
