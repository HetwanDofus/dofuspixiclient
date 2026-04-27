/**
 * Spell 2111 — Wab (Sadida swirl / water vortex).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2111/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Two parallel authored timelines:
 *   - sprite_16 (= DefineSprite_16): caster-side "swirl" beam. Positions
 *     itself at cellFrom, rotates to face cellTo, drives an elliptical
 *     orbit path via the PlaceObject2_14_1 clip (DefineSprite_14) whose
 *     onEnterFrame attaches "cercle" trail particles. At frame 28 removes
 *     itself via _parent.removeMovieClip() and triggers complete().
 *   - sprite_23 (= DefineSprite_23): target-side impact. Positions itself
 *     at cellTo on load. At frame 55 calls this.end() → signalHit.
 *     At frame 82 stops.
 *
 * The main timeline (frame_2) places sprite_23 at cellTo via onClipEvent(load).
 * sprite_16 positions itself in its own frame_1/DoAction_2.
 *
 * Library symbols:
 *   - cercle (lib_cercle) — single-frame swirl particle. onLoad seeds
 *     scale, alpha, vr rotation-speed, r damping factor. onEnterFrame
 *     moves along parent.vx/vy, rotates with vr (damped by parent.r),
 *     removes when alpha < 10. Spawned by DefineSprite_14's onEnterFrame
 *     at the trail-follower's current position.
 *
 * DefineSprite_16 also contains an inner sprite (PlaceObject2_14_1,
 * = DefineSprite_14) whose frame_1/DoAction.as sets up an onEnterFrame
 * that tracks position deltas and spawns cercle particles on sprite_16.
 * We model this as sprite_16's "trailFollower" child symbol (container-only,
 * name "trailFollower") with the DefineSprite_14 logic.
 *
 * Main timeline: frame_2 → stop(); sprite_23 placed at cellTo.
 * No top-level SOMA.playSound on the main timeline — the sound fires from
 * DefineSprite_16/frame_1/DoAction.as (inside sprite_16's frame_1 script).
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

const CERCLE_BOUNDS = {
  width: 24.75,
  height: 10.45,
  offsetX: -11.15,
  offsetY: -9.5,
};

export class Spell2111 extends RuntimeSpell {
  readonly spellId = 2111;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private cercleSym!: SymbolDefinition;
  private sprite16Sym!: SymbolDefinition;
  private sprite23Sym!: SymbolDefinition;
  private soundCb?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);

    // ---- lib_cercle — swirl trail particle ----------------------
    // Spawned by the trailFollower (DefineSprite_14) onEnterFrame onto
    // sprite_16. Has its own inner sprite (PlaceObject2_5_1 = DefineSprite_6)
    // whose onClipEvent(load/enterFrame) drives rotation; we bake that
    // behaviour into cercle's own onLoad/onEnterFrame since the inner
    // sprite is not separately attachMovie'd — it's an authored child of
    // DefineSprite_7_cercle. We fold DefineSprite_6's rotation logic into
    // the cercle clip's vars.
    //
    // AS: DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/onClipEvent(load):
    //   va = 8 - random(3);
    //   t = 60 + random(70);
    //   _xscale = _yscale = t;
    //   _alpha = 90 + random(30);
    //   r = 1.3 + 0.5 * Math.random();
    //
    // AS: DefineSprite_6/frame_1/PlaceObject2_5_1/onClipEvent(load):
    //   vr = random(100) + 50;
    //   _rotation = random(360);
    //   gotoAndStop(random(_totalframes) + 1);
    //
    // AS: DefineSprite_6/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame):
    //   _rotation = _rotation + (vr /= _parent.r);
    //   (here _parent.r is the cercle clip's r)
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/onClipEvent(load)
        const va = 8 - Math.floor(Math.random() * 3);
        const t = 60 + Math.floor(Math.random() * 70);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (90 + Math.floor(Math.random() * 30)) / 100;
        clip.vars.va = va;
        clip.vars.r = 1.3 + 0.5 * Math.random();

        // AS DefineSprite_6/frame_1/PlaceObject2_5_1/onClipEvent(load)
        clip.vars.vr = Math.floor(Math.random() * 100) + 50;
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        // gotoAndStop(random(_totalframes) + 1) — only 1 frame, no-op effectively
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/onClipEvent(enterFrame)
        const va = clip.vars.va as number;
        const r = clip.vars.r as number;

        if (clip.alpha < 0.1) {
          clip.remove();
          return;
        }

        clip.alpha -= va / 100;
        clip.x += (clip.parent?.vars.vx as number) ?? 0;
        clip.y += (clip.parent?.vars.vy as number) ?? 0;
        if (clip.parent) {
          const pvx = (clip.parent.vars.vx as number) ?? 0;
          const pvy = (clip.parent.vars.vy as number) ?? 0;
          clip.parent.vars.vx = pvx / r;
          clip.parent.vars.vy = pvy / r;
        }

        // AS DefineSprite_6/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame):
        //   _rotation = _rotation + (vr /= _parent.r)
        let vr = clip.vars.vr as number;
        vr /= r;
        clip.vars.vr = vr;
        clip.rotation += (vr * Math.PI) / 180;
      },
    };

    // ---- trailFollower — container symbol mirroring DefineSprite_14 ----
    // AS DefineSprite_14/frame_1/DoAction.as:
    //   c = 100;
    //   xi = _X; yi = _Y;
    //   this.onEnterFrame = function() {
    //     vx = _X - xi; vy = _Y - yi;
    //     _parent.attachMovie("cercle","cercle" + c, c);
    //     eval("_parent.cercle" + c)._x = _X;
    //     eval("_parent.cercle" + c)._y = _Y;
    //     eval("_parent.cercle" + c).vx = vx;
    //     eval("_parent.cercle" + c).vy = vy;
    //     c++; xi = _X; yi = _Y;
    //   };
    // This is an authored child of DefineSprite_16 placed at PlaceObject2_14_1.
    // Its position is updated each frame by the outer PlaceObject2_14_1
    // onClipEvent(enterFrame) which drives the ellipse. We model this
    // as a container child of sprite_16 named "trailFollower".
    const trailFollowerSym: SymbolDefinition = {
      name: "trailFollower",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_16/frame_1/PlaceObject2_14_1/onClipEvent(load)
        clip.vars.pi = 3.1415;
        clip.vars.v = 0.3;
        clip.vars.size = 0.8 + 3 * Math.random();
        clip.vars.a = 0;
        clip.vars.b = 0;
        clip.vars.t = 0;
        clip.vars.nFramesToIgnore = 2;
        clip.vars.nCurrentFrameState = 0;
        clip.vars.c = 100;
        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_16/frame_1/PlaceObject2_14_1/onClipEvent(enterFrame)
        const pi = clip.vars.pi as number;
        let v = clip.vars.v as number;
        const size = clip.vars.size as number;
        let a = clip.vars.a as number;
        let b = clip.vars.b as number;
        let t = clip.vars.t as number;
        const nFramesToIgnore = clip.vars.nFramesToIgnore as number;
        let nCurrentFrameState = clip.vars.nCurrentFrameState as number;

        const parent = clip.parent;
        if (!parent) {
          return;
        }
        const d = parent.vars.d as number;

        if (t > 28) {
          // trigger parent to gotoAndPlay(2) → frame_28 fires _parent.removeMovieClip()
          parent.gotoAndPlay(1);
        } else if (nCurrentFrameState > 0) {
          b = a;
          b += v / 3;
          clip.x = d + d * Math.cos(pi + b);
          clip.y = (d * Math.sin(b)) / size;
          nCurrentFrameState--;
        } else {
          clip.x = d + d * Math.cos(pi + a);
          clip.y = (d * Math.sin(a)) / size;
          a += v;
          t++;
          if (t <= 14) {
            v -= 0.015;
          } else {
            v += 0.03;
          }
          nCurrentFrameState = nFramesToIgnore;
        }

        clip.vars.v = v;
        clip.vars.a = a;
        clip.vars.b = b;
        clip.vars.t = t;
        clip.vars.nCurrentFrameState = nCurrentFrameState;

        // AS DefineSprite_14/frame_1/DoAction.as onEnterFrame:
        //   vx = _X - xi; vy = _Y - yi;
        //   _parent.attachMovie("cercle","cercle"+c, c);
        //   cercle._x = _X; cercle._y = _Y; cercle.vx = vx; cercle.vy = vy;
        //   c++; xi = _X; yi = _Y;
        let c = clip.vars.c as number;
        const xi = clip.vars.xi as number;
        const yi = clip.vars.yi as number;

        const vx = clip.x - xi;
        const vy = clip.y - yi;

        const cercleChild = parent.attach(
          this.cercleSym,
          `cercle${c}`,
          c,
          ctx,
          { x: clip.x, y: clip.y },
        );
        cercleChild.vars.vx = vx;
        cercleChild.vars.vy = vy;

        c++;
        clip.vars.c = c;
        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
      },
    };

    // ---- sprite_16 — caster-side swirl beam (30 frames) ---------
    // AS DefineSprite_16/frame_1/DoAction.as:  SOMA.playSound("wab_swirl")
    // AS DefineSprite_16/frame_1/DoAction_2.as: position self at cellFrom,
    //   compute d = dist/2, _rotation to face cellTo, stop().
    // AS DefineSprite_16/frame_28/DoAction.as: _parent.removeMovieClip(); stop();
    // Contains PlaceObject2_14_1 (trailFollower) as an authored child.
    this.sprite16Sym = {
      name: "sprite_16",
      totalFrames: 30,
      frames: textures.getFrames("sprite_16"),
      anchorX: calculateAnchor({
        width: 32.75,
        height: 27.25,
        offsetX: -16.35,
        offsetY: -17.65,
      }).x,
      anchorY: calculateAnchor({
        width: 32.75,
        height: 27.25,
        offsetX: -16.35,
        offsetY: -17.65,
      }).y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_16/frame_1/DoAction.as
            this.soundCb?.("wab_swirl");

            // AS DefineSprite_16/frame_1/DoAction_2.as
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;

            const x = cellFrom?.x ?? 0;
            const y = cellFrom?.y ?? 0;
            clip.x = x;
            clip.y = y;

            const dx = (cellTo?.x ?? 0) - x;
            const dy = (cellTo?.y ?? 0) - y;
            const d = Math.sqrt(dx * dx + dy * dy) / 2;
            clip.vars.d = d;
            clip.rotation = Math.atan2(dy, dx);

            clip.stop();

            // Attach the trailFollower (DefineSprite_14) as authored child
            clip.attach(trailFollowerSym, "trailFollower", 14, ctx);
          },
        ],
        [
          27,
          (clip) => {
            // AS DefineSprite_16/frame_28/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            // sprite_16 IS the outer mc controlling spell completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- sprite_23 — target-side impact (84 frames) -------------
    // AS frame_2/PlaceObject2_23_3/onClipEvent(load):
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    // AS DefineSprite_23/frame_55/DoAction_2.as: this.end() → signalHit
    // AS DefineSprite_23/frame_82/DoAction.as: stop()
    this.sprite23Sym = {
      name: "sprite_23",
      totalFrames: 84,
      frames: textures.getFrames("sprite_23"),
      anchorX: calculateAnchor({
        width: 62.55,
        height: 69,
        offsetX: -27.2,
        offsetY: -46.95,
      }).x,
      anchorY: calculateAnchor({
        width: 62.55,
        height: 69,
        offsetX: -27.2,
        offsetY: -46.95,
      }).y,
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_23_3/onClipEvent(load):
        //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
        const root = clip.parent;
        const cellTo = root?.vars.cellTo as
          | { x: number; y: number }
          | undefined;
        if (cellTo) {
          clip.x = cellTo.x;
          clip.y = cellTo.y;
        }
      },
      frameScripts: new Map([
        [
          54,
          () => {
            // AS DefineSprite_23/frame_55/DoAction_2.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          81,
          (clip) => {
            // AS DefineSprite_23/frame_82/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(this.cercleSym);
    this.registry.register(trailFollowerSym);
    this.registry.register(this.sprite16Sym);
    this.registry.register(this.sprite23Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use from within frame scripts
    this.soundCb = callbacks.playSound;

    // Main timeline frame_2: stop(); sprite_23 placed at cellTo (via onLoad).
    // sprite_16 and sprite_23 are the two authored timeline children.
    // sprite_16 positions itself in its own frame_1 script.
    this.root.attach(this.sprite16Sym, "sprite16", 1, context);
    this.root.attach(this.sprite23Sym, "sprite23", 3, context);
  }
}
