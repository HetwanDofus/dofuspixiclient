/**
 * Spell 2014 — (Unknown spell name, likely a Cra/archer spell with feather particles).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2014/scripts/scripts/
 *
 * displayType=51 (WorldAbsoluteAlt). Two parallel authored timelines:
 *   - DefineSprite_7 (caster-side, 7 frames): positions itself at cellFrom,
 *     rotates to angle, stops at frame 7.
 *   - DefineSprite_5_shoot (target-side, 288 frames): positions at cellTo,
 *     rotates to 0, calls signalHit on frame_1, removes parent on frame_286.
 *     Contains a child DefineSprite_4 (49 frames) which at frame_7 spawns
 *     10 `plumes` particles and stops at frame_49.
 *
 * Library symbols:
 *   - lib_plumes — feather/plume particle. onLoad seeds physics vars (vx, vy,
 *     angle, t, duree, vch, vr, amp, fr). onEnterFrame applies alpha fade after
 *     duree frames, gravity/friction physics when _Y < 0, and rotates with
 *     oscillating amplitude.
 *
 * Main timeline (frame_2/DoAction.as): stop(). Spell attaches sprite_7 and
 * sprite_5_shoot in onSpellStart.
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
  readonly displayType = SpellDisplayType.WorldAbsoluteAlt;

  private plumesSym!: SymbolDefinition;
  private sprite4Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private sprite5ShootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const plumesAnchor = calculateAnchor(PLUMES_BOUNDS);

    // ---- lib_plumes — feather particle with physics ----------------
    // onLoad: AS DefineSprite_3_plumes/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    // onEnterFrame: AS DefineSprite_3_plumes/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.plumesSym = {
      name: "plumes",
      totalFrames: 1,
      frames: textures.getFrames("lib_plumes"),
      anchorX: plumesAnchor.x,
      anchorY: plumesAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_3_plumes/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        // Walk up: plumes._parent = DefineSprite_4, DefineSprite_4._parent = shoot (DefineSprite_5),
        // shoot._parent = root. Then root has .angle on vars.
        // Canonical: _parent._parent._parent._parent.angle
        // clip → (instance inside DefineSprite_4) → DefineSprite_4 → DefineSprite_5_shoot → root
        const shootClip = clip.parent?.parent;
        const rootClip = shootClip?.parent;
        const angleDeg = (rootClip?.vars.angle as number) ?? 0;
        const angle = (angleDeg * Math.PI) / 180;

        clip.vars.a = 0;
        clip.vars.time = 0;
        clip.vars.angle = angle;
        const t = 30 + Math.floor(Math.random() * 30);
        clip.scaleX = t / 100;
        clip.vars.duree = 60 + Math.floor(Math.random() * 90);
        clip.scaleY = t / 100;
        clip.vars.vy = -10 * Math.random() + 10 * Math.sin(angle);
        clip.vars.vx = -20 + 40 * Math.random() + 10 * Math.cos(angle);
        clip.vars.vch = 0.1 + 0.1 * Math.random();
        clip.vars.vr = 0.03 + 0.1 * Math.random();
        clip.vars.amp = 30 + Math.floor(Math.random() * 23);
        clip.vars.fr = 0.8 + 0.15 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3_plumes/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let time = clip.vars.time as number;
        const duree = clip.vars.duree as number;
        let vy = clip.vars.vy as number;
        let vx = clip.vars.vx as number;
        const vch = clip.vars.vch as number;
        const fr = clip.vars.fr as number;
        let amp = clip.vars.amp as number;
        let a = clip.vars.a as number;
        const vr = clip.vars.vr as number;

        time++;
        clip.vars.time = time;

        if (time > duree) {
          clip.alpha = clip.alpha - 3.3 / 100;
        }

        if (clip.y < 0) {
          vy += vch;
          clip.y = clip.y + vy;
          clip.x = clip.x + vx;
          vy *= fr;
          vx *= fr;
          amp *= 0.98;
          a += vr;
          // AS: _rotation = amp * Math.cos(a) — degrees → radians
          clip.rotation = (amp * Math.cos(a) * Math.PI) / 180;

          clip.vars.vy = vy;
          clip.vars.vx = vx;
          clip.vars.amp = amp;
          clip.vars.a = a;
        }
      },
    };

    // ---- DefineSprite_4 — container inside shoot that spawns plumes ----
    // AS DefineSprite_4/frame_7/DoAction.as: spawn 10 plumes particles
    // AS DefineSprite_4/frame_49/DoAction.as: stop()
    this.sprite4Sym = {
      name: "sprite4",
      totalFrames: 49,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          6,
          (clip, ctx) => {
            // AS DefineSprite_4/frame_7/DoAction.as
            // c = 0; p = 0; while(p < 10) { attachMovie("plumes", "plumes"+c, c); ... p++; c++ }
            for (let c = 0; c < 10; c++) {
              const plumesClip = clip.attach(
                this.plumesSym,
                `plumes${c}`,
                c,
                ctx,
              );
              // AS: eval("this.plumes"+c).vx = 40 * (Math.random() - 0.5)
              // AS: eval("this.plumes"+c).vy = 40 * (Math.random() - 0.5)
              // Note: these override vx/vy set in onLoad above (canonical order:
              // onLoad fires first from attach(), then frame_7 overrides here)
              plumesClip.vars.vx = 40 * (Math.random() - 0.5);
              plumesClip.vars.vy = 40 * (Math.random() - 0.5);
            }
          },
        ],
        [
          48,
          (clip) => {
            // AS DefineSprite_4/frame_49/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_5_shoot — target-side timeline (288 frames) ----
    // AS DefineSprite_5_shoot/frame_1/DoAction.as:
    //   _rotation = 0; _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 20; this.end();
    // AS DefineSprite_5_shoot/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   t = 70; _xscale = t; _yscale = t;   (this is for the child DefineSprite_4 placed at frame_1)
    // AS DefineSprite_5_shoot/frame_286/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    //
    // DefineSprite_4 is placed at depth 1 on frame_1 of shoot via PlaceObject2_4_1.
    // Its onClipEvent(load) seeds t=70, _xscale=_yscale=70.
    this.sprite5ShootSym = {
      name: "shoot",
      totalFrames: 288,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_5_shoot/frame_1/DoAction.as
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;

            // _rotation = 0
            clip.rotation = 0;

            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y - 20;
            }

            // this.end() → signalHit (canonical impact signal at target)
            this.runtime.signalHit();

            // PlaceObject2_4_1 places DefineSprite_4 at depth 1, frame_1 of shoot.
            // Its onClipEvent(load): t=70; _xscale=t; _yscale=t
            // We attach sprite4 here and apply the onLoad transform.
            const s4 = clip.attach(this.sprite4Sym, "sprite4_1", 1, ctx);
            // AS DefineSprite_5_shoot/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
            // t = 70; _xscale = t; _yscale = t
            s4.scaleX = 70 / 100;
            s4.scaleY = 70 / 100;
          },
        ],
        [
          285,
          (clip) => {
            // AS DefineSprite_5_shoot/frame_286/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_7 — caster-side timeline (7 frames) -----------
    // AS DefineSprite_7/frame_1/DoAction.as:
    //   _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 20; _rotation = _parent.angle;
    // AS DefineSprite_7/frame_7/DoAction.as: stop();
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
            // AS DefineSprite_7/frame_7/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(this.plumesSym);
    this.registry.register(this.sprite4Sym);
    this.registry.register(this.sprite5ShootSym);
    this.registry.register(this.sprite7Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_2/DoAction.as: stop();
    // No sound on the main timeline for this spell.
    // Attach the two parallel authored timelines.
    this.root.attach(this.sprite7Sym, "sprite7", 1, context);
    this.root.attach(this.sprite5ShootSym, "shoot", 2, context);
  }
}
