/**
 * Spell 2111 — Wabbit Swirl (unknown class).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2111/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Two parallel authored timelines:
 *   - DefineSprite_16 (sprite_16, 30 frames): positioned at midpoint between
 *     caster and target (cellFrom), rotated to face target. Contains a
 *     spiraling tracer (PlaceObject2_14_1) that spawns cercle particles
 *     as it moves. Removes itself at frame 28.
 *   - DefineSprite_23 (sprite_23, 84 frames): positioned at cellTo.
 *     frame_55: signalHit. frame_82: stop(). The longest-lived clip —
 *     drives spell completion.
 *
 * Library symbols:
 *   - cercle (characterId=7): 1-frame glowing particle. onLoad seeds va
 *     (fade speed), t (scale), alpha, r (friction). onEnterFrame fades,
 *     drifts by vx/vy (stored on parent), then removes when alpha < 10.
 *   - sprite6 (characterId=6, directlyDynamic): 1-frame spinning sub-sprite
 *     used inside cercle. onLoad seeds vr (spin speed), random rotation,
 *     random frame. onEnterFrame spins rotation by vr/r (where r is on
 *     the parent cercle clip).
 *
 * The DefineSprite_16 contains a PlaceObject2_14_1 child (container-only)
 * whose frame_1 DoAction sets up a continuous attachMovie("cercle") tracer
 * loop — ported as onEnterFrame on that inner clip.
 *
 * Main timeline (frame_2): stop(); + sprite_23 positioned at cellTo via
 * onClipEvent(load). The sound "wab_swirl" is played inside DefineSprite_16
 * frame_1, but we surface it in onSpellStart for convenience.
 *
 * displayType=50 (WorldAbsolute): container at (0,0); per-spell scripts
 * position children using world coords from root.vars.cellFrom / cellTo.
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

// Bounds from manifest librarySymbols[]
const CERCLE_BOUNDS = {
  width: 24.75,
  height: 10.45,
  offsetX: -11.15,
  offsetY: -9.5,
};
const SPRITE6_BOUNDS = {
  width: 21.3,
  height: 12.1,
  offsetX: -10.8,
  offsetY: -10.95,
};

// Bounds from manifest animations[] for the container sprites
const SPRITE16_BOUNDS = {
  width: 32.75,
  height: 27.25,
  offsetX: -16.35,
  offsetY: -17.65,
};
const SPRITE23_BOUNDS = {
  width: 62.55,
  height: 69,
  offsetX: -27.2,
  offsetY: -46.95,
};

export class Spell2111 extends RuntimeSpell {
  readonly spellId = 2111;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  // Hold refs so onSpellStart can attach them
  private sprite16Sym!: SymbolDefinition;
  private sprite23Sym!: SymbolDefinition;
  private cercleSym!: SymbolDefinition;
  private sprite6Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);
    const sprite16Anchor = calculateAnchor(SPRITE16_BOUNDS);
    const sprite23Anchor = calculateAnchor(SPRITE23_BOUNDS);

    // ---- sprite6 (characterId=6, directlyDynamic) ----------------
    // A spinning sub-sprite placed inside each cercle instance.
    // AS: DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    //   vr = random(100) + 50;
    //   _rotation = random(360);
    //   gotoAndStop(random(_totalframes) + 1);
    // AS: DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + (vr /= _parent.r);
    //
    // The placement matrix (from librarySymbols[1].placements[0]) applies
    // a skew/scale — port as an initial transform on attach. The parent
    // for this placement is characterId=7 (cercle), frame=0, depth=1.
    this.sprite6Sym = {
      name: "sprite6",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.vr = Math.floor(Math.random() * 100) + 50;
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        // gotoAndStop(random(_totalframes) + 1) — 1 frame total, so always frame 0
        clip.gotoAndStop(0);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation + (vr /= _parent.r)
        let vr = clip.vars.vr as number;
        const parentR = (clip.parent?.vars.r as number) ?? 1;
        vr = vr / parentR;
        clip.vars.vr = vr;
        clip.rotation += (vr * Math.PI) / 180;
      },
    };

    // ---- cercle (characterId=7) ----------------------------------
    // Glowing particle. Spawns sprite6 at depth 1 on frame_0.
    // AS: DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
    //   va = 8 - random(3);
    //   t = 60 + random(70);
    //   _xscale = t; _yscale = t;
    //   _alpha = 90 + random(30);
    //   r = 1.3 + 0.5 * Math.random();
    // AS: DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   if (_alpha < 10) { _parent.removeMovieClip(); }
    //   _alpha = _alpha - va;
    //   _X = _X + _parent.vx;
    //   _Y = _Y + _parent.vy;
    //   _parent.vx /= r;
    //   _parent.vy /= r;
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.va = 8 - Math.floor(Math.random() * 3);
        const t = 60 + Math.floor(Math.random() * 70);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (90 + Math.floor(Math.random() * 30)) / 100;
        clip.vars.r = 1.3 + 0.5 * Math.random();
        // vx / vy are seeded by the tracer (DefineSprite_14) on the parent
        // before attach; default to 0 in case.
        if (clip.vars.vx === undefined) { clip.vars.vx = 0; }
        if (clip.vars.vy === undefined) { clip.vars.vy = 0; }
        // Place the inner sprite6 sub-sprite (placement matrix from
        // librarySymbols[1].placements[0]: parent=7, frame=0, depth=1)
        //   matrix: scaleX=1, scaleY=0.861, rotateSkew0=0, rotateSkew1=-0.283,
        //           translateX=0, translateY=-0.05
        // Decompose: rotation = atan2(rotateSkew1, scaleX) = atan2(-0.283, 1)
        const placementRotation = Math.atan2(-0.282684326171875, 1);
        clip.attach(this.sprite6Sym, "sprite6_sub", 1, ctx, {
          x: 0,
          y: -0.05,
          rotation: placementRotation,
        });
        // Apply scale from matrix after attach
        const innerClip = clip.children.get("sprite6_sub");
        if (innerClip) {
          innerClip.scaleX = 1;
          innerClip.scaleY = 0.861114501953125;
        }
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const va = clip.vars.va as number;
        const r = clip.vars.r as number;
        const currentAlpha = clip.alpha * 100; // work in Flash 0-100 space

        if (currentAlpha < 10) {
          clip.remove();
          return;
        }

        clip.alpha = (currentAlpha - va) / 100;

        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        clip.x += vx;
        clip.y += vy;
        // vx and vy are stored on THIS clip (the cercle) which acts as the
        // "_parent" for sprite6. The tracer sets them on the cercle before
        // placing it.
        clip.vars.vx = vx / r;
        clip.vars.vy = vy / r;
      },
    };

    // ---- DefineSprite_16 (sprite_16) — spiral tracer + orbit ----
    // 30-frame container positioned at midpoint between cellFrom and cellTo,
    // rotated to face target.
    //
    // Contains a PlaceObject2_14_1 child that:
    //   - frame_1 DoAction: sets up c=100, xi/yi, registers onEnterFrame
    //     that spawns cercle particles with velocity=delta.
    //   - onClipEvent(load): seeds physics vars (pi, v, size, a, b, t, etc.)
    //   - onClipEvent(enterFrame): orbital ellipse motion, triggers
    //     gotoAndPlay(2) on parent when t > 28.
    //
    // We model DefineSprite_14 (the inner tracer child) as an inline
    // container attached at frame_0 of sprite_16.
    //
    // AS DefineSprite_16/frame_1/DoAction_2.as:
    //   x = _parent.cellFrom.x; y = _parent.cellFrom.y;
    //   _X = x; _Y = y;
    //   dx = _parent.cellTo.x - x; dy = _parent.cellTo.y - y;
    //   d = sqrt(dx*dx + dy*dy) / 2;
    //   _rotation = atan2(dy,dx) * 180 / PI;
    //   stop();
    //
    // AS DefineSprite_16/frame_28/DoAction.as: _parent.removeMovieClip(); stop();
    //
    // The inner tracer (PlaceObject2_14_1) uses DefineSprite_14 which has
    // a frame_1 DoAction that registers an onEnterFrame on itself — we
    // port this as the innerTracer symbol's onEnterFrame.

    // Inner tracer symbol (DefineSprite_14) — container only, no textures.
    // onLoad: AS DefineSprite_16/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load).as
    // onEnterFrame: AS DefineSprite_16/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // Also ports AS DefineSprite_14/frame_1/DoAction.as as frameScripts[0]
    const innerTracerSym: SymbolDefinition = {
      name: "innerTracer",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_16/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.pi = 3.1415;
        clip.vars.v = 0.3;
        clip.vars.size = 0.8 + 3 * Math.random();
        clip.vars.a = 0;
        clip.vars.b = 0;
        clip.vars.t = 0;
        clip.vars.nFramesToIgnore = 2;
        clip.vars.nCurrentFrameState = 0;
        // AS DefineSprite_14/frame_1/DoAction.as — c, xi, yi for cercle spawning
        clip.vars.c = 100;
        clip.vars.xi = 0;
        clip.vars.yi = 0;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_16/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const pi = clip.vars.pi as number;
        let v = clip.vars.v as number;
        const size = clip.vars.size as number;
        let a = clip.vars.a as number;
        let b = clip.vars.b as number;
        let t = clip.vars.t as number;
        let nCurrentFrameState = clip.vars.nCurrentFrameState as number;
        const nFramesToIgnore = clip.vars.nFramesToIgnore as number;

        // The parent sprite_16 clip stores 'd' from its frame_1 DoAction_2
        const sprite16 = clip.parent;
        const d = (sprite16?.vars.d as number) ?? 0;

        if (t > 28) {
          // Trigger sprite_16 to play (which leads to frame 28 → removeMovieClip)
          if (sprite16) {
            sprite16.gotoAndPlay(1); // AS gotoAndPlay(2) → 0-based index 1
          }
        } else if (nCurrentFrameState > 0) {
          // Sub-frame interpolation step
          b = a;
          b += v / 3;
          clip.x = d + d * Math.cos(pi + b);
          clip.y = (d * Math.sin(b)) / size;
          nCurrentFrameState--;
          clip.vars.nCurrentFrameState = nCurrentFrameState;
          clip.vars.b = b;
        } else {
          // Main orbit step
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
          clip.vars.a = a;
          clip.vars.t = t;
          clip.vars.v = v;
          clip.vars.nCurrentFrameState = nCurrentFrameState;
        }

        // AS DefineSprite_14/frame_1/DoAction.as — spawning cercle tracer particles
        // this.onEnterFrame: vx = _X - xi; vy = _Y - yi;
        // attachMovie("cercle","cercle"+c, c); set _x/_y/vx/vy on new cercle
        const xi = clip.vars.xi as number;
        const yi = clip.vars.yi as number;
        let c = clip.vars.c as number;

        const vx = clip.x - xi;
        const vy = clip.y - yi;

        if (sprite16) {
          const instanceName = `cercle${c}`;
          const newCercle = sprite16.attach(
            this.cercleSym,
            instanceName,
            c,
            ctx
          );
          // AS: eval("_parent.cercle"+c)._x = _X; _y = _Y; vx = vx; vy = vy
          // Position is in sprite_16 local coords = tracer's current position
          newCercle.x = clip.x;
          newCercle.y = clip.y;
          newCercle.vars.vx = vx;
          newCercle.vars.vy = vy;
        }

        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
        clip.vars.c = c + 1;
      },
    };

    this.sprite16Sym = {
      name: "sprite_16",
      totalFrames: 30,
      frames: textures.getFrames("sprite_16"),
      anchorX: sprite16Anchor.x,
      anchorY: sprite16Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_16/frame_1/DoAction.as — SOMA.playSound("wab_swirl")
            // Sound is handled in onSpellStart instead.
            //
            // AS DefineSprite_16/frame_1/DoAction_2.as
            // x = _parent.cellFrom.x; y = _parent.cellFrom.y;
            // _X = x; _Y = y;
            // dx = cellTo.x - x; dy = cellTo.y - y;
            // d = sqrt(dx*dx + dy*dy) / 2;
            // _rotation = atan2(dy,dx) * 180 / PI;
            // stop();
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y;
            }
            let d = 0;
            if (cellFrom && cellTo) {
              const dx = cellTo.x - cellFrom.x;
              const dy = cellTo.y - cellFrom.y;
              d = Math.sqrt(dx * dx + dy * dy) / 2;
              clip.rotation = Math.atan2(dy, dx);
            }
            clip.vars.d = d;
            clip.stop();

            // Attach the inner tracer (PlaceObject2_14_1 at depth 1, frame_1)
            clip.attach(innerTracerSym, "innerTracer", 1, ctx);
          },
        ],
        [
          27,
          (clip) => {
            // AS DefineSprite_16/frame_28/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_23 (sprite_23) — target impact timeline ---
    // 84-frame composite positioned at cellTo (via onClipEvent(load)
    // from frame_2/PlaceObject2_23_3).
    //
    // frame_55: this.end() → signalHit
    // frame_82: stop()
    //
    // The completion is signalled at frame_55 (hit) and we call
    // runtime.complete() at frame_82 (stop — the outermost clip
    // effectively ends here; sprite_16 has already removed itself).
    this.sprite23Sym = {
      name: "sprite_23",
      totalFrames: 84,
      frames: textures.getFrames("sprite_23"),
      anchorX: sprite23Anchor.x,
      anchorY: sprite23Anchor.y,
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_23_3/CLIPACTIONRECORD onClipEvent(load).as
        // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
        const root = clip.parent;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
        if (cellTo) {
          clip.x = cellTo.x;
          clip.y = cellTo.y;
        }
      },
      frameScripts: new Map([
        [
          54,
          () => {
            // AS DefineSprite_23/frame_55/DoAction_2.as — this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          81,
          (clip) => {
            // AS DefineSprite_23/frame_82/DoAction.as — stop()
            // This is the end of the spell; signal completion.
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite6Sym);
    this.registry.register(this.cercleSym);
    this.registry.register(this.sprite16Sym);
    this.registry.register(this.sprite23Sym);
    // Register innerTracerSym too so any resolve calls find it
    this.registry.register(innerTracerSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS DefineSprite_16/frame_1/DoAction.as — SOMA.playSound("wab_swirl")
    // (Also listed in manifest sounds[0])
    callbacks.playSound("wab_swirl");

    // Main timeline frame_2 stop() — attach sprite_16 and sprite_23.
    // sprite_23 is positioned via its onLoad (PlaceObject2_23_3 at cellTo).
    // sprite_16 positions itself at cellFrom in its own frame_1 DoAction_2.
    this.root.attach(this.sprite16Sym, "sprite16", 1, context);
    this.root.attach(this.sprite23Sym, "sprite23", 3, context);
  }
}
