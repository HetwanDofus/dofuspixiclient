/**
 * Spell 2051 — (Water/Air swirl spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2051/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The spell has two authored timelines anchored
 * to different world positions: sprite_14 anchors itself at cellFrom and orbits
 * toward cellTo, while sprite_21 is placed at cellTo. Main-timeline frame_2 does
 * `stop()` and places sprite_21 at cellTo. This dual-anchored pattern requires
 * WorldAbsolute so scripts can read _parent.cellFrom / _parent.cellTo freely.
 *
 * Library symbols:
 *   - cercle (lib_cercle) — single-frame wake particle. onLoad seeds va (fade
 *     speed), t (scale 60-130), alpha (90-120), r (decay 1.3-1.8). onEnterFrame
 *     fades by va; drifts by _parent.vx/_parent.vy (the orbiting sprite_12 child
 *     injects these via cercle.vx / cercle.vy); divides parent vx/vy by r each
 *     frame; removes self when alpha < 10.
 *
 * Container symbols (no frame textures):
 *   - sprite_14 — 30-frame orbiting ball composite. frame_1 plays "wab_swirl",
 *     positions itself at cellFrom, computes d (half distance to cellTo), sets
 *     rotation to face target, stops. An inner orbit driver (DefineSprite_12/
 *     frame_1) runs an onEnterFrame that tracks position changes and spawns
 *     cercle particles at the current location. A second inner clip (frame_1
 *     enterFrame on PlaceObject2_12_1) performs the elliptical orbit math.
 *     frame_28: _parent.removeMovieClip(); stop() → kills sprite_14.
 *   - sprite_21 — 84-frame impact composite at cellTo. frame_55 fires
 *     this.end() → signalHit. frame_82: stop(). The manifest indicates
 *     stopFrame=81 (0-based: 81), so we stop at frame 81 (AS frame_82).
 *     frame_84 (index 83) is not explicitly scripted; completion is signalled
 *     elsewhere. We complete() at frame_83 (last frame).
 *
 * Main timeline:
 *   - frame_2/DoAction.as: stop()
 *   - frame_2/PlaceObject2_21_3/onClipEvent(load): _X = _parent.cellTo.x;
 *     _Y = _parent.cellTo.y; — sprite_21 places itself at target on load.
 *   - frame_1 sound: none at top level; sound is in DefineSprite_14/frame_1.
 *   - onSpellStart attaches sprite_14 and sprite_21 to root.
 *
 * Hit signal: frame_55 of sprite_21 (AS frame_55 = index 54, but DoAction_2.as
 * says `this.end()` which is the hit signal).
 * Completion: after sprite_21 reaches its stop frame (frame_82 = index 81, stop).
 * We fire complete() at frame 83 (index 83, last frame) of sprite_21 since sprite_21
 * runs 84 frames and stop() is at frame_82; to properly complete we hook the
 * stopFrame boundary. Actually canonical: frame_82/DoAction.as is stop() on sprite_21,
 * and there is no removeMovieClip in sight for sprite_21 itself. The outer completion
 * should be fired when sprite_21 stops — we complete() from frame 81 (AS frame_82 stop).
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

export class Spell2051 extends RuntimeSpell {
  readonly spellId = 2051;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private cercleSym!: SymbolDefinition;
  private sprite14Sym!: SymbolDefinition;
  private sprite21Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);

    // ---- lib_cercle — wake/trail particle spawned by the orbiting ball ----
    // AS: DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   va = 8 - random(3);
        //   t = 60 + random(70);
        //   _xscale = t; _yscale = t;
        //   _alpha = 90 + random(30);
        //   r = 1.3 + 0.5 * Math.random();
        const va = 8 - Math.floor(Math.random() * 3);
        const t = 60 + Math.floor(Math.random() * 70);
        clip.vars.va = va;
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (90 + Math.floor(Math.random() * 30)) / 100;
        clip.vars.r = 1.3 + 0.5 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   if(_alpha < 10) { _parent.removeMovieClip(); }
        //   _alpha = _alpha - va;
        //   _X = _X + _parent.vx;
        //   _Y = _Y + _parent.vy;
        //   _parent.vx /= r;
        //   _parent.vy /= r;
        const currentAlpha = clip.alpha * 100;
        if (currentAlpha < 10) {
          clip.remove();
          return;
        }
        const va = clip.vars.va as number;
        const r = clip.vars.r as number;
        // Read vx/vy from _parent (the cercle's parent is sprite_14)
        const parent = clip.parent;
        if (parent) {
          const vx = (parent.vars.vx as number) ?? 0;
          const vy = (parent.vars.vy as number) ?? 0;
          clip.x += vx;
          clip.y += vy;
          parent.vars.vx = vx / r;
          parent.vars.vy = vy / r;
        }
        clip.alpha = (currentAlpha - va) / 100;
      },
    };

    // ---- sprite_14 — orbiting ball that travels from cellFrom toward cellTo ----
    // Container symbol: all frame content is driven by inner clip onEnterFrames.
    // DefineSprite_14/frame_1/DoAction.as: SOMA.playSound("wab_swirl")
    // DefineSprite_14/frame_1/DoAction_2.as: position at cellFrom, compute d, rotation, stop.
    // DefineSprite_14/frame_1/PlaceObject2_12_1 (the inner orbit driver clip):
    //   onLoad: seeds pi, v, size, a, b, t, nFramesToIgnore, nCurrentFrameState
    //   onEnterFrame: elliptical orbit math; if t > 28 → gotoAndPlay(2) (the ball escapes)
    // DefineSprite_12/frame_1/DoAction.as: the "tracer" clip's onEnterFrame spawns cercle particles
    // DefineSprite_14/frame_28/DoAction.as: _parent.removeMovieClip(); stop();
    //
    // We model this as a single SymbolDefinition with:
    //   - onLoad: set up orbit state vars
    //   - onEnterFrame: run the orbit math and spawn cercle particles
    //   - frameScripts[27]: _parent.removeMovieClip() (AS frame_28)
    //
    // The DefineSprite_6 (inner spinner sub-clip placed inside sprite_14) provides
    // the visual rotation. Since it's a sub-symbol placed inside sprite_14's authored
    // timeline (not an attachMovie), we model its behavior through sprite_14's
    // onEnterFrame using a "spinner" vars bundle on the sprite_14 clip itself.
    // DefineSprite_6/frame_1/PlaceObject2_5_1:
    //   onLoad: vr = random(100)+50; _rotation = random(360); gotoAndStop(random(_totalframes)+1)
    //   onEnterFrame: _rotation = _rotation + (vr /= _parent.r)
    // The "r" in DefineSprite_6's enterFrame refers to sprite_14's vars.r (the parent of sprite_6).
    // We fold this spinner into sprite_14's own onEnterFrame as a "spinner" sub-state.
    this.sprite14Sym = {
      name: "sprite_14",
      totalFrames: 30,
      frames: textures.getFrames("sprite_14"),
      anchorX: calculateAnchor({ width: 32.75, height: 27.25, offsetX: -16.35, offsetY: -17.65 }).x,
      anchorY: calculateAnchor({ width: 32.75, height: 27.25, offsetX: -16.35, offsetY: -17.65 }).y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_14/frame_1/DoAction_2.as (runs on the first frame after attach):
        // Positioned at cellFrom with rotation toward cellTo, stop().
        const cellFrom = ctx.cellFrom;
        const cellTo = ctx.cellTo;
        const x = cellFrom.x;
        const y = cellFrom.y;
        clip.x = x;
        clip.y = y;
        const dx = cellTo.x - x;
        const dy = cellTo.y - y;
        const d = Math.sqrt(dx * dx + dy * dy) / 2;
        clip.vars.d = d;
        clip.rotation = Math.atan2(dy, dx);
        clip.stop();

        // AS DefineSprite_14/frame_1/PlaceObject2_12_1/onClipEvent(load):
        //   pi = 3.1415; v = 0.3; size = 0.8 + 3*Math.random();
        //   a = 0; b = 0; t = 0; nFramesToIgnore = 2; nCurrentFrameState = 0;
        clip.vars.pi = 3.1415;
        clip.vars.v = 0.3;
        clip.vars.size = 0.8 + 3 * Math.random();
        clip.vars.a = 0;
        clip.vars.b = 0;
        clip.vars.orbitT = 0;
        clip.vars.nFramesToIgnore = 2;
        clip.vars.nCurrentFrameState = 0;

        // AS DefineSprite_12/frame_1/DoAction.as — tracer state:
        //   c = 100; xi = _X; yi = _Y;
        clip.vars.c = 100;
        // The "tracer" tracks absolute world position of the orbiting point.
        // We store the orbit world position in orbitWorldX / orbitWorldY.
        clip.vars.orbitWorldX = x;
        clip.vars.orbitWorldY = y;
        clip.vars.xi = x;
        clip.vars.yi = y;

        // AS DefineSprite_6/frame_1/PlaceObject2_5_1/onClipEvent(load):
        //   vr = random(100)+50; _rotation = random(360)
        //   gotoAndStop(random(_totalframes)+1) — not modelled (inner sub-anim)
        clip.vars.spinnerVr = Math.floor(Math.random() * 100) + 50;
        clip.vars.spinnerRotation = Math.floor(Math.random() * 360);
        // r for the spinner's vr decay — this is sprite_14's own r.
        // The orbit clip (inner PlaceObject2_12_1) doesn't set r on parent,
        // but DefineSprite_6's onEnterFrame reads _parent.r. We set a safe default.
        clip.vars.r = 1.05;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_14/frame_1/PlaceObject2_12_1/onClipEvent(enterFrame):
        // Elliptical orbit math driving the ball's local offset within sprite_14.
        const d = clip.vars.d as number;
        const pi = clip.vars.pi as number;
        let v = clip.vars.v as number;
        let a = clip.vars.a as number;
        let b = clip.vars.b as number;
        let orbitT = clip.vars.orbitT as number;
        let nCurrentFrameState = clip.vars.nCurrentFrameState as number;
        const nFramesToIgnore = clip.vars.nFramesToIgnore as number;
        const size = clip.vars.size as number;

        let localX: number;
        let localY: number;

        if (orbitT > 28) {
          // Escaped: trigger gotoAndPlay(2) on sprite_14 itself.
          // AS: _parent.gotoAndPlay(2) from inside the orbit clip.
          clip.gotoAndPlay(1); // AS gotoAndPlay(2) → index 1
          // Don't update orbit vars further.
          clip.vars.orbitT = orbitT;
          clip.vars.v = v;
          clip.vars.a = a;
          clip.vars.b = b;
          clip.vars.nCurrentFrameState = nCurrentFrameState;
          return;
        } else if (nCurrentFrameState > 0) {
          // Interpolated sub-frame state (nFramesToIgnore smoothing).
          b = a;
          b += v / 3;
          localX = d + d * Math.cos(pi + b);
          localY = (d * Math.sin(b)) / size;
          nCurrentFrameState--;
          clip.vars.b = b;
          clip.vars.nCurrentFrameState = nCurrentFrameState;
        } else {
          localX = d + d * Math.cos(pi + a);
          localY = (d * Math.sin(a)) / size;
          a += v;
          orbitT++;
          if (orbitT <= 14) {
            v -= 0.015;
          } else {
            v += 0.03;
          }
          nCurrentFrameState = nFramesToIgnore;
          clip.vars.a = a;
          clip.vars.orbitT = orbitT;
          clip.vars.v = v;
          clip.vars.nCurrentFrameState = nCurrentFrameState;
        }

        // The orbit localX/localY are in sprite_14's LOCAL coords (rotated/scaled).
        // sprite_14 is positioned at cellFrom in world space and rotated to face cellTo.
        // We compute the world coords of the orbit point to spawn cercle particles.
        // The orbit clip's _X/_Y are relative to sprite_14's local frame.
        // We store the current orbit local position for the tracer.
        const prevWorldX = clip.vars.orbitWorldX as number;
        const prevWorldY = clip.vars.orbitWorldY as number;

        // Transform localX/localY through sprite_14's rotation to world coords.
        const cosR = Math.cos(clip.rotation);
        const sinR = Math.sin(clip.rotation);
        const worldX = clip.x + localX * cosR - localY * sinR;
        const worldY = clip.y + localX * sinR + localY * cosR;

        clip.vars.orbitWorldX = worldX;
        clip.vars.orbitWorldY = worldY;

        // AS DefineSprite_12/frame_1/DoAction.as — tracer onEnterFrame:
        //   vx = _X - xi; vy = _Y - yi;
        //   _parent.attachMovie("cercle","cercle"+c, c);
        //   eval("_parent.cercle"+c)._x = _X; .._y = _Y; .vx = vx; .vy = vy;
        //   c++; xi = _X; yi = _Y;
        const xi = clip.vars.xi as number;
        const yi = clip.vars.yi as number;
        const vx = worldX - xi;
        const vy = worldY - yi;
        let c = clip.vars.c as number;

        // Spawn cercle at the orbit world position.
        const cercleChild = clip.attach(this.cercleSym, `cercle${c}`, c, ctx);
        // Place cercle at world coords. Since cercle is a child of sprite_14,
        // which is positioned at clip.x/clip.y in world space and rotated,
        // we need to express the world position in sprite_14's local frame.
        // Inverse transform: subtract clip position, then rotate by -clip.rotation.
        const dx = worldX - clip.x;
        const dy = worldY - clip.y;
        const invCosR = Math.cos(-clip.rotation);
        const invSinR = Math.sin(-clip.rotation);
        cercleChild.x = dx * invCosR - dy * invSinR;
        cercleChild.y = dx * invSinR + dy * invCosR;
        // Inject velocity into cercle (cercle's enterFrame reads _parent.vx/_parent.vy,
        // but cercle IS the _parent here in the AS sense — actually cercle's parent is
        // sprite_14, and the cercle clip event reads _parent.vx where _parent = sprite_14).
        // We store vx/vy on sprite_14 (clip) so cercle's onEnterFrame can read them.
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        c++;
        clip.vars.c = c;
        clip.vars.xi = worldX;
        clip.vars.yi = worldY;

        // AS DefineSprite_6/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame):
        //   _rotation = _rotation + (vr /= _parent.r)
        // We fold the spinner visual into sprite_14's own rotation update.
        let spinnerVr = clip.vars.spinnerVr as number;
        const r = clip.vars.r as number;
        spinnerVr = spinnerVr / r;
        clip.vars.spinnerVr = spinnerVr;
        // (Spinner rotation is a visual-only sub-element; we don't need to
        // apply it to the sprite_14 clip itself since it's an inner sub-clip.)
      },
      frameScripts: new Map([
        [
          27,
          (clip) => {
            // AS DefineSprite_14/frame_28/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_21 — impact animation at cellTo (84 frames) ----
    // Main-timeline frame_2/PlaceObject2_21_3/onClipEvent(load):
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    // DefineSprite_21/frame_55/DoAction_2.as: this.end() → signalHit
    // DefineSprite_21/frame_82/DoAction.as: stop()
    this.sprite21Sym = {
      name: "sprite_21",
      totalFrames: 84,
      frames: textures.getFrames("sprite_21"),
      anchorX: calculateAnchor({ width: 62.55, height: 69, offsetX: -27.2, offsetY: -46.95 }).x,
      anchorY: calculateAnchor({ width: 62.55, height: 69, offsetX: -27.2, offsetY: -46.95 }).y,
      onLoad: (clip, ctx) => {
        // AS frame_2/PlaceObject2_21_3/CLIPACTIONRECORD onClipEvent(load).as:
        //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
        clip.x = ctx.cellTo.x;
        clip.y = ctx.cellTo.y;
      },
      frameScripts: new Map([
        [
          54,
          () => {
            // AS DefineSprite_21/frame_55/DoAction_2.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          81,
          (clip) => {
            // AS DefineSprite_21/frame_82/DoAction.as: stop()
            clip.stop();
            // Spell is complete when sprite_21 stops at its final frame.
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.cercleSym);
    this.registry.register(this.sprite14Sym);
    this.registry.register(this.sprite21Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS DefineSprite_14/frame_1/DoAction.as: SOMA.playSound("wab_swirl")
    // (sound is inside sprite_14's frame_1, played on attach)
    callbacks.playSound("wab_swirl");

    // Main-timeline frame_2/DoAction.as: stop()
    // We attach the two authored timelines at root. Harness has already
    // configured root.vars with cellFrom/cellTo/angle for WorldAbsolute.
    this.root.attach(this.sprite14Sym, "sprite14", 1, context);
    this.root.attach(this.sprite21Sym, "sprite21", 3, context);
  }
}
