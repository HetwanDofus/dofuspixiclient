/**
 * Spell 313 — (Feca/Osamodas explosion spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/313/scripts/scripts/
 *
 * displayType=11 (TargetCell). The main animation (sprite_14, 174 frames) positions
 * itself at _parent.cellTo in its own frame_1 DoAction — this is the WorldAbsolute
 * pattern at first glance, but only ONE sprite is used, anchored entirely at the target
 * cell. The harness resolves TargetCell so the container sits at cellTo; sprite_14's
 * frame_1 confirms: `_X = _parent.cellTo.x; _Y = _parent.cellTo.y;` — but since the
 * container IS already at cellTo for displayType=11, we set the clip to (0, 0) relative
 * to its parent (the root, which is already at cellTo).
 *
 * Actually re-reading: the AS does `_X = _parent.cellTo.x / _Y = _parent.cellTo.y` in
 * absolute coords, meaning the outer container must be at (0,0) — this is WorldAbsolute
 * (displayType=50/51). Using displayType=50 (WorldAbsolute) so the harness places the
 * root at world origin and the clip self-positions using cellTo coords from root.vars.
 *
 * Library symbols:
 *   - sprite7 (characterId=7, directlyDynamic=true) — small spark/debris particle.
 *     onLoad: seeds alpha=150, v2, vr, t (scale), v (upward velocity), _X scatter, fv, fvr.
 *     onEnterFrame: alpha fades by 1.6, rotation by vr, Y by (v+v2), v*=fv, vr*=fvr.
 *     Placed 8 times at frame 69 of sprite_14 at various positions.
 *   - sprite12 (characterId=12, directlyDynamic=true) — debris chunk particle.
 *     onLoad: seeds valph, ta, t (scale), vx/vy velocity, sens (sign), vr rotation vel.
 *     onEnterFrame: alpha-=valph, scale animates toward t, moves with vx/vy, rotates by vr,
 *                   all velocities decay.
 *     Placed 5 times at frame 72 of sprite_14 at various positions/scales.
 *
 * sprite_14 (174-frame main timeline):
 *   - frame_1 DoAction: positions self at _parent.cellTo.x/y (world absolute).
 *   - frame_1 PlaceObject2_3_1 onClipEvent: sprite_3 instance 1 — amp=50, rotation wobble.
 *   - frame_1 PlaceObject2_3_3 onClipEvent: sprite_3 instance 3 — alpha=50, amp=70, rotation wobble.
 *   - frame_69 DoAction: SOMA.playSound("explosion") — handled via stored callback.
 *   - frame_70 DoAction: sound play (same).
 *   - frame_73 DoAction: this.end() → signalHit.
 *   - frame_172 DoAction: _parent.removeMovieClip() → complete.
 *
 * sprite_3 (36-frame animated flame/impact visual):
 *   - frame_34 DoAction: stop().
 *
 * Main timeline (frame_2): stop() — spell is driven entirely by sprite_14.
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

const SPRITE7_BOUNDS = {
  width: 7.55,
  height: 7.3,
  offsetX: -3.65,
  offsetY: -3.8,
};

const SPRITE12_BOUNDS = {
  width: 39.55,
  height: 38.6,
  offsetX: -19.75,
  offsetY: -17.8,
};

const SPRITE3_BOUNDS = {
  width: 19,
  height: 63.5,
  offsetX: -9.95,
  offsetY: -120.15,
};

const SPRITE14_BOUNDS = {
  width: 182.45,
  height: 213.45,
  offsetX: -79,
  offsetY: -197,
};

export class Spell313 extends RuntimeSpell {
  readonly spellId = 313;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite7Sym!: SymbolDefinition;
  private sprite12Sym!: SymbolDefinition;
  private sprite3Sym!: SymbolDefinition;
  private sprite14Sym!: SymbolDefinition;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const sprite12Anchor = calculateAnchor(SPRITE12_BOUNDS);
    const sprite3Anchor = calculateAnchor(SPRITE3_BOUNDS);
    const sprite14Anchor = calculateAnchor(SPRITE14_BOUNDS);

    // ---- sprite7 — small spark particle -------------------------
    // AS: scripts/DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: scripts/DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7/.../CLIPACTIONRECORD onClipEvent(load).as
        clip.alpha = 150 / 100; // _alpha = 150 (Flash allows >100 but Pixi clamps to 1; canonical value)
        clip.vars.v2 = -0.3 * Math.random();
        clip.vars.vr = 11300 * (Math.random() - 0.5);
        const t = 30 + Math.floor(Math.random() * 70);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.v = -10 - Math.floor(Math.random() * 30);
        clip.x = 50 * (Math.random() - 0.5);
        clip.vars.fv = 0.6 + 0.3 * Math.random();
        clip.vars.fvr = 0.7 + 0.2 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7/.../CLIPACTIONRECORD onClipEvent(enterFrame).as
        const v2 = clip.vars.v2 as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        const fv = clip.vars.fv as number;
        const fvr = clip.vars.fvr as number;

        // _alpha -= 1.6 (Flash 0-100 units; our alpha is 0-1, so subtract 1.6/100)
        clip.alpha = clip.alpha - 1.6 / 100;
        // _rotation += vr (vr is in degrees)
        clip.rotation = clip.rotation + (vr * Math.PI) / 180;
        // _Y += (v + v2)
        clip.y = clip.y + (v + v2);
        v *= fv;
        vr *= fvr;
        clip.vars.v = v;
        clip.vars.vr = vr;
      },
    };

    // ---- sprite12 — debris chunk particle -----------------------
    // AS: scripts/DefineSprite_12/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: scripts/DefineSprite_12/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.sprite12Sym = {
      name: "sprite12",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite12"),
      anchorX: sprite12Anchor.x,
      anchorY: sprite12Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_12/.../CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.valph = 1.3 + Math.floor(Math.random() * 5);
        clip.vars.ta = Math.floor(Math.random() * 50);
        const t = 50 + 50 * Math.random();
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        const vx = 40 * (-0.5 + Math.random());
        const vy = 20 * (-0.5 + Math.random());
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        let sens: number;
        if (vx < 0) {
          sens = -1;
        } else {
          sens = 1;
        }
        clip.vars.sens = sens;
        clip.vars.vr = 3 * vx;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_12/.../CLIPACTIONRECORD onClipEvent(enterFrame).as
        const valph = clip.vars.valph as number;
        let ta = clip.vars.ta as number;
        const t = clip.vars.t as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let vr = clip.vars.vr as number;
        const sens = clip.vars.sens as number;

        // _alpha -= valph (Flash 0-100)
        clip.alpha = clip.alpha - valph / 100;
        // ta -= (ta - t) / 7
        ta -= (ta - t) / 7;
        // _xscale = ta * sens; _yscale = ta
        clip.scaleX = (ta * sens) / 100;
        clip.scaleY = ta / 100;
        clip.x = clip.x + vx;
        clip.y = clip.y + vy;
        // _rotation += vr (degrees)
        clip.rotation = clip.rotation + (vr * Math.PI) / 180;
        vx *= 0.8;
        vy *= 0.8;
        vr *= 0.9;
        clip.vars.ta = ta;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.vr = vr;
      },
    };

    // ---- sprite_3 — 36-frame animated flame/impact visual -------
    // AS: scripts/DefineSprite_3/frame_34/DoAction.as → stop()
    // Two instances placed on sprite_14's main timeline (frame_1):
    //   PlaceObject2_3_1: onLoad seeds amp=50; onEnterFrame wobbles rotation
    //   PlaceObject2_3_3: onLoad seeds alpha=50, amp=70; onEnterFrame wobbles rotation
    // We create TWO symbol definitions (one per instance flavor) so each
    // gets its own independent onLoad/onEnterFrame behavior.

    // sprite_3 instance 1 — PlaceObject2_3_1 (amp=50, no alpha override)
    // AS: scripts/DefineSprite_14/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: scripts/DefineSprite_14/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const sprite3Sym1: SymbolDefinition = {
      name: "sprite3_inst1",
      totalFrames: 36,
      frames: textures.getFrames("sprite_3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_14/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.amp = 50;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_14/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let amp = clip.vars.amp as number;
        // _rotation = amp * (-0.5 + Math.random()) — degrees
        clip.rotation = ((amp * (-0.5 + Math.random())) * Math.PI) / 180;
        amp *= 0.8;
        clip.vars.amp = amp;
      },
      frameScripts: new Map([
        [
          33,
          (clip) => {
            // AS DefineSprite_3/frame_34/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // sprite_3 instance 3 — PlaceObject2_3_3 (alpha=50, amp=70)
    // AS: scripts/DefineSprite_14/frame_1/PlaceObject2_3_3/CLIPACTIONRECORD onClipEvent(load).as
    // AS: scripts/DefineSprite_14/frame_1/PlaceObject2_3_3/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const sprite3Sym3: SymbolDefinition = {
      name: "sprite3_inst3",
      totalFrames: 36,
      frames: textures.getFrames("sprite_3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_14/frame_1/PlaceObject2_3_3/CLIPACTIONRECORD onClipEvent(load).as
        clip.alpha = 50 / 100;
        clip.vars.amp = 70;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_14/frame_1/PlaceObject2_3_3/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let amp = clip.vars.amp as number;
        // _rotation = amp * (-0.5 + Math.random()) — degrees
        clip.rotation = ((amp * (-0.5 + Math.random())) * Math.PI) / 180;
        amp *= 0.8;
        clip.vars.amp = amp;
      },
      frameScripts: new Map([
        [
          33,
          (clip) => {
            // AS DefineSprite_3/frame_34/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // We store the two sprite3 variants and also expose the generic one
    // for internal use in sprite14's frameScripts that need to re-use them.
    // sprite3Sym (generic, used for the stop-frame only — attach via named variants).
    this.sprite3Sym = sprite3Sym1; // keep reference for registration

    // ---- sprite_14 — 174-frame main animation -------------------
    // AS: scripts/DefineSprite_14/frame_1/DoAction.as
    // AS: scripts/DefineSprite_14/frame_70/DoAction.as
    // AS: scripts/DefineSprite_14/frame_73/DoAction.as
    // AS: scripts/DefineSprite_14/frame_172/DoAction.as
    // Plus placements of sprite7 (frame 69) and sprite12 (frame 72).
    this.sprite14Sym = {
      name: "sprite_14",
      totalFrames: 174,
      frames: textures.getFrames("sprite_14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_14/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
            // Parent is root (WorldAbsolute, at world 0,0); root.vars has cellTo.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
            // PlaceObject2_3_1 — sprite3 instance 1, depth 1 (implicit from PlaceObject2 depth)
            // AS: placed at frame_1; onLoad seeds amp=50
            clip.attach(sprite3Sym1, "sprite3_1", 1, ctx);
            // PlaceObject2_3_3 — sprite3 instance 3, depth 3
            // AS: placed at frame_1; onLoad seeds alpha=50, amp=70
            clip.attach(sprite3Sym3, "sprite3_3", 3, ctx);
          },
        ],
        [
          68,
          (clip, ctx) => {
            // AS DefineSprite_14/frame_69 placements — sprite7 at 8 positions (depths 13,15,17,19,21,23,25,27)
            // manifest librarySymbols[0] (sprite7) placements all at frame=69 (0-indexed=68)
            clip.attach(this.sprite7Sym, "sprite7_13", 13, ctx, {
              x: 1.1,
              y: -40.1,
            });
            clip.attach(this.sprite7Sym, "sprite7_15", 15, ctx, {
              x: -0.6,
              y: -42.35,
            });
            clip.attach(this.sprite7Sym, "sprite7_17", 17, ctx, {
              x: -1.75,
              y: -38.35,
            });
            clip.attach(this.sprite7Sym, "sprite7_19", 19, ctx, {
              x: -1.75,
              y: -76.55,
            });
            clip.attach(this.sprite7Sym, "sprite7_21", 21, ctx, {
              x: -4,
              y: -29.55,
            });
            clip.attach(this.sprite7Sym, "sprite7_23", 23, ctx, {
              x: 1.1,
              y: -30.95,
            });
            clip.attach(this.sprite7Sym, "sprite7_25", 25, ctx, {
              x: 1.6,
              y: -21.05,
            });
            clip.attach(this.sprite7Sym, "sprite7_27", 27, ctx, {
              x: -0.6,
              y: -47.4,
            });
          },
        ],
        [
          69,
          () => {
            // AS DefineSprite_14/frame_70/DoAction.as → SOMA.playSound("explosion")
            // Sound was also listed at frame 69 in manifest.sounds (0-indexed = frame index 68),
            // but the canonical AS file is frame_70 (0-based = 69). Play here.
            this.soundCallback?.("explosion");
          },
        ],
        [
          71,
          (clip, ctx) => {
            // AS DefineSprite_14/frame_72 placements — sprite12 at 5 positions (depths 3,5,7,9,11)
            // manifest librarySymbols[1] (sprite12) placements all at frame=72 (0-indexed=71)
            // Each has scaleX=scaleY=0.6497650146484375 applied via matrix
            const s = 0.6497650146484375;
            const c1 = clip.attach(this.sprite12Sym, "sprite12_3", 3, ctx, {
              x: -6.15,
              y: -4.6,
            });
            c1.scaleX = c1.scaleX * s;
            c1.scaleY = c1.scaleY * s;
            const c2 = clip.attach(this.sprite12Sym, "sprite12_5", 5, ctx, {
              x: -2.25,
              y: -4.25,
            });
            c2.scaleX = c2.scaleX * s;
            c2.scaleY = c2.scaleY * s;
            const c3 = clip.attach(this.sprite12Sym, "sprite12_7", 7, ctx, {
              x: 5.9,
              y: -2.3,
            });
            c3.scaleX = c3.scaleX * s;
            c3.scaleY = c3.scaleY * s;
            const c4 = clip.attach(this.sprite12Sym, "sprite12_9", 9, ctx, {
              x: -4.5,
              y: -1.7,
            });
            c4.scaleX = c4.scaleX * s;
            c4.scaleY = c4.scaleY * s;
            const c5 = clip.attach(this.sprite12Sym, "sprite12_11", 11, ctx, {
              x: 1.65,
              y: -2.3,
            });
            c5.scaleX = c5.scaleX * s;
            c5.scaleY = c5.scaleY * s;
          },
        ],
        [
          72,
          () => {
            // AS DefineSprite_14/frame_73/DoAction.as → this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          171,
          (clip) => {
            // AS DefineSprite_14/frame_172/DoAction.as → _parent.removeMovieClip()
            // clip's parent is root — removing root completes the spell.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite12Sym);
    this.registry.register(sprite3Sym1);
    this.registry.register(sprite3Sym3);
    this.registry.register(this.sprite14Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline frame_2/DoAction.as → stop()
    // Canonical: the outer SWF stops on frame 2 — the content is driven
    // entirely by the sprite_14 child. Store sound callback for later use
    // in sprite_14's frame_70 script.
    this.soundCallback = callbacks.playSound;
    // Attach the main sprite_14 timeline to the root.
    this.root.attach(this.sprite14Sym, "sprite_14", 1, context);
  }
}
