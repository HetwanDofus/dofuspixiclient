/**
 * Spell 406 — Lakam (Sadida water/earth spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/406/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no `move`/`shoot` projectile
 * dispatch — it's a pure impact at the target cell. DefineSprite_22 (the
 * outer "shoot" container with 142 frames) is placed as the root visual at
 * the target and drives completion. No caster-side anchor, no linear/
 * ballistic motion.
 *
 * Symbol tree:
 *   - shoot (DefineSprite_9_shoot, 211 frames, lib_sprite6) — main animation
 *     placed in DeifneSprite_22 at frame_1 depth_1 via PlaceObject2 with clip
 *     event onEnterFrame that spins + fades it. This is sprite6 from the
 *     librarySymbols (characterId 6, directlyDynamic=true).
 *
 *   - sprite21 (DefineSprite_21, 24 frames, lib_sprite21, directlyDynamic=true)
 *     — water-drop burst placed multiple times inside DefineSprite_22 at
 *     various depths/frames. Each instance's onLoad seeds physics variables
 *     (v, va, t, r) and onEnterFrame moves X, fades alpha, spawns goutte
 *     children. frame_22 stops. Placed by DefineSprite_22 at frames 0, 6, 30, 36.
 *
 *   - goutte (DefineSprite_1_goutte, 1 frame, lib_goutte) — water-drop glyph
 *     dynamically attached by sprite21's onEnterFrame to its own parent at
 *     runtime. frame_1 stops immediately.
 *
 *   - pierres (DefineSprite_15_pierres, 1 frame, lib_pierres) — stone/rock
 *     particle. Attached by sprite6's onEnterFrame into itself. onLoad seeds
 *     vd/vx/vy/an/v2x/v2y/t/v/vr/tps and positions parent; onEnterFrame
 *     drives a two-phase arc (rise then scatter) with alpha fade + removal.
 *
 *   - DefineSprite_3 (unnamed / inline, used for _rotation=random(360) on
 *     goutte children). DefineSprite_1_goutte's frame_1 is `stop()`, and
 *     DefineSprite_3 is an inner unnamed sprite used inside goutte — it just
 *     randomises its rotation. We fold this into the goutte symbol's frame_1
 *     script since there are no separate textures for it.
 *
 *   - DefineSprite_22 (142 frames, lib_sprite22 composite) — the OUTER shot
 *     container (== "shoot" from the harness perspective). frame_4 sets
 *     _rotation to _parent.angle. frame_49 calls this.end() (signalHit).
 *     frame_142 calls _parent.removeMovieClip() + stop() (spell complete).
 *     Places sprite21 at depths 1,6,11,16,21,26 with level-gated visibility.
 *
 * Main timeline: SOMA.playSound("lakam_405") — no stop(), so the root main
 * timeline plays through (but it has only 1 frame so it loops harmlessly).
 *
 * The outer container played by DefineSprite_22 is what the harness will call
 * "shoot" for TargetCell display. We attach it from onSpellStart directly.
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

// ---- Manifest bounds -------------------------------------------------------

const PIERRES_BOUNDS = {
  width: 16.15,
  height: 20.5,
  offsetX: -8.15,
  offsetY: -8.6,
};

const GOUTTE_BOUNDS = {
  // lib_goutte_0.svg exists; width/height are listed as 0 in the manifest
  // (the glyph is authored at 0×0 registration). Use centre anchor.
  width: 1,
  height: 1,
  offsetX: 0,
  offsetY: 0,
};

const SPRITE6_BOUNDS = {
  width: 126.25,
  height: 122.8,
  offsetX: -62.05,
  offsetY: -98,
};

const SPRITE21_BOUNDS = {
  width: 90.15,
  height: 91.75,
  offsetX: -39.3,
  offsetY: -50.1,
};

// DefineSprite_22 uses the same visual bounds as the top-level "shoot" animation
const SPRITE22_BOUNDS = {
  width: 126.25,
  height: 122.8,
  offsetX: -61.6,
  offsetY: -103.15,
};

export class Spell406 extends RuntimeSpell {
  readonly spellId = 406;
  // Pure impact at the target cell — no projectile motion.
  readonly displayType = SpellDisplayType.TargetCell;

  // Symbols we need cross-references to inside other symbols' scripts.
  private pierresSym!: SymbolDefinition;
  private goutteSym!: SymbolDefinition;
  private sprite21Sym!: SymbolDefinition;
  private sprite6Sym!: SymbolDefinition;
  private sprite22Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const gouteAnchor = calculateAnchor(GOUTTE_BOUNDS);
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);
    const sprite21Anchor = calculateAnchor(SPRITE21_BOUNDS);
    const sprite22Anchor = calculateAnchor(SPRITE22_BOUNDS);

    // ---- lib_pierres — stone/rock particle ---------------------------------
    // Placed inside sprite6 (DefineSprite_6) by its onEnterFrame.
    // AS: scripts/DefineSprite_15_pierres/frame_1/PlaceObject2_14_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_15_pierres/frame_1/PlaceObject2_14_1/onClipEvent(load)
        // NOTE: the clip-event is on the inner child (PlaceObject2_14_1), but
        // in our model the SymbolDefinition.onLoad IS that event.  The parent
        // reference in AS (_parent._x etc.) corresponds to clip.parent here.
        const vd = 90 + Math.floor(Math.random() * 90);
        clip.vars.vd = vd;
        clip.gotoAndPlay(Math.floor(Math.random() * 12)); // gotoAndPlay(random(12)+1) → 0-based = random(12)
        clip.vars.vx = 15 * (Math.random() - 0.5);
        clip.vars.vy = 15 * (Math.random() - 0.5);

        // an = _parent._parent._parent._parent._parent.angle + PI
        // traversal: pierres-clip → wrapper(parent) → sprite6 → sprite22 → root
        // In our tree: pierres is attached into sprite6 directly, so
        // clip.parent = sprite6, clip.parent.parent = sprite22, clip.parent.parent.parent = root
        const sprite22Clip = clip.parent?.parent;
        const rootClip = sprite22Clip?.parent;
        const angleDeg = (rootClip?.vars.angle as number) ?? 0;
        const an = (angleDeg * Math.PI) / 180 + Math.PI;
        clip.vars.an = an;
        clip.vars.v2x = Math.cos(an) * 5;
        clip.vars.v2y = Math.sin(an) * 5;

        // _parent._x = 20*(random-0.5); _parent._y = 10*(random-0.5)
        // The "parent" in AS is the wrapper container we attach the pierres into.
        // In our attach model the pierres clip IS at the level of the wrapper,
        // so we set position on the clip itself (the wrapper IS the clip).
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);

        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.vars.v = -10;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.vr = 30 * (-0.5 + Math.random());
        clip.vars.tps = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_15_pierres/frame_1/PlaceObject2_14_1/onClipEvent(enterFrame)
        if (clip.alpha < 10 / 100) {
          // removeMovieClip(_parent) → remove the pierres clip itself
          clip.remove();
          return;
        }

        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const vr = clip.vars.vr as number;
        let v = clip.vars.v as number;
        let v2x = clip.vars.v2x as number;
        let v2y = clip.vars.v2y as number;
        let tps = clip.vars.tps as number;
        const vd = clip.vars.vd as number;

        clip.x += vx;
        clip.y += vy;
        clip.rotation += (vr * Math.PI) / 180;

        // First phase: tps++ < vd  (AS uses post-increment so check then increment)
        if (tps < vd) {
          clip.y += v;
          vx /= 1.2;
          vy /= 1.2;
          v /= 1.2;
        }
        tps++;

        // Second phase: tps++ > vd (again post-increment; now tps was already incremented above)
        if (tps > vd) {
          v2y *= 1.06;
          v2x *= 1.06;
          clip.y += v2y;
          clip.x += v2x;
          clip.alpha -= 1 / 100;
        }
        tps++;

        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.v = v;
        clip.vars.v2x = v2x;
        clip.vars.v2y = v2y;
        clip.vars.tps = tps;
      },
    };

    // ---- lib_goutte — water-drop glyph -------------------------------------
    // AS: scripts/DefineSprite_1_goutte/frame_1/DoAction.as → stop()
    // Also has an inner DefineSprite_3 whose frame_1 sets _rotation=random(360).
    // We fold that into the frame_1 frameScript (the inner sprite's random
    // rotation is baked into the composite visual on attach).
    this.goutteSym = {
      name: "goutte",
      totalFrames: 1,
      frames: textures.getFrames("lib_goutte"),
      anchorX: gouteAnchor.x,
      anchorY: gouteAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_1_goutte/frame_1/DoAction.as: stop()
            // AS DefineSprite_3/frame_1/DoAction.as: _rotation = random(360)
            clip.stop();
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
      ]),
    };

    // ---- sprite6 (DefineSprite_6) — spinning/fading ring + pierres spawner -
    // Placed inside DefineSprite_9_shoot (the "shoot" wrapper) at depth 1/5.
    // Has a PlaceObject2_4_3 with:
    //   onClipEvent(load): c = 0
    //   onClipEvent(enterFrame): spawn pairs of pierres while c < level*3
    // Also has its OWN clip-event (PlaceObject2_8_9 in DefineSprite_9_shoot):
    //   onEnterFrame: _rotation += 70; _alpha -= 10
    // We model this as a single SymbolDefinition with onLoad/onEnterFrame that
    // covers BOTH the container's own clip events AND the inner spawn logic,
    // since from the runtime's perspective the entire DefineSprite_6 sprite IS
    // this one clip.
    //
    // The PlaceObject2_8_9 enterFrame (spinning + fading) is the clip-event on
    // the sprite6 instance INSIDE DefineSprite_9_shoot. We handle it in the
    // onEnterFrame of sprite6 itself.
    this.sprite6Sym = {
      name: "sprite6",
      totalFrames: 285,
      frames: textures.getFrames("lib_sprite6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6/frame_1/PlaceObject2_4_3/onClipEvent(load)
        clip.vars.c = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_9_shoot/frame_1/PlaceObject2_8_9/onClipEvent(enterFrame)
        clip.rotation += (70 * Math.PI) / 180;
        clip.alpha -= 10 / 100;

        // AS DefineSprite_6/frame_1/PlaceObject2_4_3/onClipEvent(enterFrame)
        // Walk up: sprite6 → shoot (DefineSprite_22) → root; root.vars.level
        const sprite22Clip = clip.parent;
        const rootClip = sprite22Clip?.parent;
        const level = (rootClip?.vars.level as number) ?? 1;

        let c = clip.vars.c as number;
        if (c < level * 3) {
          c += 1;
          clip.attach(this.pierresSym, `pierres${c}`, c, this.runtime.context);
          c += 1;
          clip.attach(this.pierresSym, `pierres${c}`, c, this.runtime.context);
        }
        clip.vars.c = c;
      },
    };

    // ---- sprite21 (DefineSprite_21) — water-drop burst ---------------------
    // directlyDynamic=true: has its own onClipEvent(load) + onClipEvent(enterFrame)
    // and a frame_22 stop().
    // Placed in DefineSprite_22 at multiple depths with level-gated visibility.
    //
    // The `ratio` field on placements gives the staggered phase offset. In AS,
    // a clip placed with ratio=N starts its onClipEvent(enterFrame) having
    // already been "at ratio frame". We honour this by storing it in vars.ratio
    // and using it to initialise c in the enterFrame loop.
    this.sprite21Sym = {
      name: "sprite21",
      totalFrames: 24,
      frames: textures.getFrames("lib_sprite21"),
      anchorX: sprite21Anchor.x,
      anchorY: sprite21Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_21/frame_1/PlaceObject2_19_1/onClipEvent(load)
        clip.vars.v = 5 + 18 * Math.random();
        // AS uses Math.random(3) — this is the non-standard AS2 random(N) form
        // producing 0, 1, or 2; canonical: 1 + random(3) → [1,3]
        clip.vars.va = 1 + Math.floor(Math.random() * 3);
        const t = 50 + 50 * Math.random();
        clip.vars.t = t;
        clip.vars.r = 0.1 + Math.random() * 0.8;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        // c is shared between load (initialised by ratio) and enterFrame
        clip.vars.c = (clip.vars.ratio as number) ?? 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_21/frame_1/PlaceObject2_19_1/onClipEvent(enterFrame)
        let v = clip.vars.v as number;
        const va = clip.vars.va as number;
        let c = clip.vars.c as number;

        clip.x += v;
        clip.alpha -= va / 100;

        // Walk up: sprite21 → DefineSprite_22 → root
        const sprite22Clip = clip.parent;
        const rootClip = sprite22Clip?.parent;
        const level = (rootClip?.vars.level as number) ?? 1;

        if (c < 4 * level) {
          // _parent.attachMovie("goutte","goutte"+c, c+1)
          // The parent here is the DefineSprite_22 container that holds sprite21
          const parent = clip.parent;
          if (parent) {
            const goutte = parent.attach(
              this.goutteSym,
              `goutte${c}`,
              c + 1,
              this.runtime.context,
            );
            // eval("_parent.goutte"+c)._x = _X
            goutte.x = clip.x;
          }
          c++;
        }

        v /= 1.2;
        clip.vars.v = v;
        clip.vars.c = c;
      },
      frameScripts: new Map([
        [
          21,
          (clip) => {
            // AS DefineSprite_21/frame_22/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_22 — outer 142-frame shot container ------------------
    // This is the "shoot" symbol from the harness perspective. It holds:
    //   frame_1  (0-based: 0): places sprite6 at depth_1 and sprite21 at depth_6
    //                           (level-gated for depth_6: visible only if level >= 2)
    //   frame_4  (0-based: 3): _rotation = _parent.angle
    //   frame_7  (0-based: 6): places sprite21 at depth_11 (visible only if level >= 3)
    //   frame_31 (0-based: 30): places sprite21 at depth_16 + depth_21
    //                            (visible only if level >= 2)
    //   frame_37 (0-based: 36): places sprite21 at depth_26 (visible only if level >= 3)
    //   frame_49 (0-based: 48): this.end() → signalHit
    //   frame_142(0-based: 141): _parent.removeMovieClip() → complete
    //
    // The sprite6 placement at frame_1 depth_1 has a PlaceObject2 with the
    // onClipEvent(enterFrame) from DefineSprite_9_shoot (PlaceObject2_8_9).
    // That enterFrame is already baked into sprite6's onEnterFrame handler above.
    this.sprite22Sym = {
      name: "sprite22",
      totalFrames: 142,
      frames: [],
      anchorX: sprite22Anchor.x,
      anchorY: sprite22Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_22/frame_1:
            //   PlaceObject2 sprite6 at depth_1 (matrix: translateX=0.45, translateY=-5.15)
            //   PlaceObject2 sprite21 at depth_6 (matrix: translateX=5.65, translateY=-7.65)
            //     with onClipEvent(load): if level < 2 → _visible = false
            clip.attach(this.sprite6Sym, "sprite6_d1", 1, ctx, {
              x: 0.45,
              y: -5.15,
            });

            // AS DefineSprite_22/frame_1/PlaceObject2_21_6/onClipEvent(load)
            const s21_d6 = clip.attach(
              this.sprite21Sym,
              "sprite21_d6",
              6,
              ctx,
              { x: 5.65, y: -7.65 },
            );
            const rootClip = clip.parent;
            const level = (rootClip?.vars.level as number) ?? 1;
            if (level < 2) {
              s21_d6.visible = false;
            }
          },
        ],
        [
          3,
          (clip) => {
            // AS DefineSprite_22/frame_4/DoAction.as: _rotation = _parent.angle
            const rootClip = clip.parent;
            const angleDeg = (rootClip?.vars.angle as number) ?? 0;
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          6,
          (clip, ctx) => {
            // AS DefineSprite_22/frame_7:
            //   PlaceObject2 sprite21 at depth_11 (ratio=6, matrix: x=0.55, y=-11.2)
            //   onClipEvent(load): if level < 3 → _visible = false
            const s21_d11 = clip.attach(
              this.sprite21Sym,
              "sprite21_d11",
              11,
              ctx,
              { x: 0.55, y: -11.2 },
            );
            s21_d11.vars.ratio = 6;
            // re-run the onLoad phase offset seeding (ratio is now set)
            s21_d11.vars.c = 6;
            const rootClip = clip.parent;
            const level = (rootClip?.vars.level as number) ?? 1;
            if (level < 3) {
              s21_d11.visible = false;
            }
          },
        ],
        [
          30,
          (clip, ctx) => {
            // AS DefineSprite_22/frame_31:
            //   PlaceObject2 sprite21 at depth_16 (ratio=30, matrix: x=-0.85, y=10.6)
            //   PlaceObject2 sprite21 at depth_21 (ratio=30, matrix: x=-0.85, y=12.05)
            //   onClipEvent(load) for both: if level < 2 → _visible = false
            const rootClip = clip.parent;
            const level = (rootClip?.vars.level as number) ?? 1;

            const s21_d16 = clip.attach(
              this.sprite21Sym,
              "sprite21_d16",
              16,
              ctx,
              { x: -0.85, y: 10.6 },
            );
            s21_d16.vars.ratio = 30;
            s21_d16.vars.c = 30;
            if (level < 2) {
              s21_d16.visible = false;
            }

            const s21_d21 = clip.attach(
              this.sprite21Sym,
              "sprite21_d21",
              21,
              ctx,
              { x: -0.85, y: 12.05 },
            );
            s21_d21.vars.ratio = 30;
            s21_d21.vars.c = 30;
            if (level < 2) {
              s21_d21.visible = false;
            }
          },
        ],
        [
          36,
          (clip, ctx) => {
            // AS DefineSprite_22/frame_37:
            //   PlaceObject2 sprite21 at depth_26 (ratio=36, matrix: x=11.2, y=-0.55)
            //   onClipEvent(load): if level < 3 → _visible = false
            const s21_d26 = clip.attach(
              this.sprite21Sym,
              "sprite21_d26",
              26,
              ctx,
              { x: 11.2, y: -0.55 },
            );
            s21_d26.vars.ratio = 36;
            s21_d26.vars.c = 36;
            const rootClip = clip.parent;
            const level = (rootClip?.vars.level as number) ?? 1;
            if (level < 3) {
              s21_d26.visible = false;
            }
          },
        ],
        [
          48,
          () => {
            // AS DefineSprite_22/frame_49/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          141,
          (clip) => {
            // AS DefineSprite_22/frame_142/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.goutteSym);
    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite21Sym);
    this.registry.register(this.sprite22Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("lakam_405")
    callbacks.playSound("lakam_405");

    // The outer DefineSprite_22 is the top-level shot container. Attach it
    // at root so it starts ticking from the next runtime frame.
    // For TargetCell the root is already at the target cell position (0,0 local).
    this.root.attach(this.sprite22Sym, "sprite22", 1, context);
  }
}
