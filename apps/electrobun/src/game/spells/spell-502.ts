/**
 * Spell 502 — (Earth/Rock spell, likely Sacrier or Feca class).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/502/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion, no
 * caster-relative anchoring, and no dual-anchored timelines. It is a
 * single impact animation at the target cell. The outer DefineSprite_12
 * timeline plays through 73 frames and removes itself at frame 73.
 * signalHit fires at frame 49 (canonical `this.end()` call).
 *
 * Library symbols:
 *   - lib_pierres — small rock/pebble particle. onLoad seeds vx/vy
 *     (drift), t (lifetime 60-100), scale (t%), alpha (20-109),
 *     v (upward velocity -5 to -20), vr (rotation velocity ±20 deg).
 *     onEnterFrame: drifts parent, applies gravity (v += 1.5),
 *     bounces off y=0 (v = -v/4), settles when |v| < 1.
 *   - lib_sprite9 — 95-frame animated sprite that IS a clipEvent
 *     wrapper (directlyDynamic: true). Its onLoad attaches 20 "pierres"
 *     particles at depths 0-19. It has a 95-frame authored timeline.
 *     Its parent (DefineSprite_12) places it at frame 3, depth 2 with
 *     a small offset. The alpha fade from frames 49-66 is driven by
 *     the parent's PlaceObject2 colorTransform "move" placements.
 *
 * Main timeline (DefineSprite_12, 73 frames):
 *   - frame_1 (DoAction): SOMA.playSound("many_502")
 *   - frame_3: place sprite9 instance at depth 2, offset (0.45, -5.15)
 *   - frame_49: this.end() → signalHit
 *   - frames 49-66: stepwise alpha fade on sprite9 (from placements[])
 *   - frame_73: _parent.removeMovieClip() → runtime.complete()
 *
 * The outer composite animation (anim1, 74 frames) is rendered
 * alongside the live clip tree. The live clip tree handles the dynamic
 * pierres physics.
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

const PIERRES_BOUNDS = {
  width: 6.4,
  height: 3.85,
  offsetX: -3.2,
  offsetY: -2.2,
};

const SPRITE9_BOUNDS = {
  width: 39.55,
  height: 125.85,
  offsetX: -20.2,
  offsetY: -112.3,
};

export class Spell502 extends RuntimeSpell {
  readonly spellId = 502;
  readonly displayType = SpellDisplayType.TargetCell;

  private pierresSym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);

    // ---- lib_pierres — rock/pebble particle ----------------------
    // AS: scripts/DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //
    // Note: the onClipEvent handlers in the AS are on an INNER clip
    // (PlaceObject2_2_1) inside the "pierres" sprite. The inner clip
    // modifies _parent._x / _parent._y (the pierres clip itself) and
    // its own _Y, _rotation, _xscale, _yscale, _alpha.
    //
    // We port this by treating the SymbolDefinition for "pierres" as
    // having its own onLoad/onEnterFrame that operate on the clip
    // directly, folding the inner-clip indirection into a flat model.
    // The "vx/vy drift applied to _parent._x/_y" becomes drift applied
    // to clip.x/clip.y. The "_Y/_rotation" of the inner child become
    // clip.vars.innerY / clip.vars.innerRotation tracked separately.
    // In practice the inner clip's _Y is used for bounce physics while
    // the parent _x/_y drift. We model this with separate vars.
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,

      onLoad: (clip) => {
        // AS: scripts/DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
        //     CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        // _parent._x/_y of the inner clip = our clip.x/y
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -15 * Math.random() - 5;
        clip.vars.vr = 40 * (-0.5 + Math.random());
        // innerY tracks the inner clip's _Y (vertical bounce position)
        clip.vars.innerY = 0;
        // innerRotation tracks the inner clip's _rotation (degrees)
        clip.vars.innerRotation = 0;
      },

      onEnterFrame: (clip) => {
        // AS: scripts/DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
        //     CLIPACTIONRECORD onClipEvent(enterFrame).as
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        let innerY = clip.vars.innerY as number;
        let innerRotation = clip.vars.innerRotation as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        const t = clip.vars.t as number;

        // _parent._x += vx; _parent._y += vy
        clip.x += vx;
        clip.y += vy;

        if (t !== 1) {
          // _Y = _Y + v  (inner clip's vertical position)
          innerY = innerY + v;
          // _rotation = _rotation + vr
          innerRotation = innerRotation + vr;
          // v += 1.5  (gravity)
          v += 1.5;

          if (innerY > 0) {
            // Bounce: landed on ground
            clip.vars.vx = vx / 2;
            clip.vars.vy = vy / 2;
            innerRotation = 0;
            innerY = 0;
            v = (-v) / 4;
            if (Math.abs(v) < 1) {
              clip.vars.vx = 0;
              clip.vars.vy = 0;
              clip.vars.t = 1;
            }
          }
        }

        clip.vars.innerY = innerY;
        clip.vars.innerRotation = innerRotation;
        clip.vars.v = v;
        clip.vars.vr = vr;

        // Apply inner rotation to clip visual (degrees → radians)
        clip.rotation = (innerRotation * Math.PI) / 180;
        // Apply inner Y offset to clip's y position on top of drift
        // The inner clip's _Y is relative to the parent's position
        // We fold it in as an additional Y shift
        clip.y = clip.y - vx + vx; // no-op structural placeholder;
        // Actually fold innerY into visual Y:
        // clip.y was already updated by the drift above.
        // innerY acts as a vertical offset from the drift position.
        // We must store the "base" y separately to avoid accumulation.
        // Re-implement: track baseX/baseY for drift, innerY for bounce.
      },
    };

    // Rebuild pierresSym with corrected innerY model
    // The AS structure has two layers:
    //   - pierres clip (parent): drifts in x/y via vx/vy
    //   - inner child at PlaceObject2_2_1: bounces on _Y, rotates
    // We fold these into one clip using baseX/baseY + innerY.
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,

      onLoad: (clip) => {
        // AS: scripts/DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
        //     CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        // _parent._x/_y set to random scatter (the pierres parent clip)
        const baseX = 20 * (Math.random() - 0.5);
        const baseY = 10 * (Math.random() - 0.5);
        clip.vars.baseX = baseX;
        clip.vars.baseY = baseY;
        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        // v: upward velocity of inner clip (_Y direction, negative = up)
        clip.vars.v = -15 * Math.random() - 5;
        clip.vars.vr = 40 * (-0.5 + Math.random());
        // innerY: the inner child clip's _Y (starts at 0)
        clip.vars.innerY = 0;
        // innerRot: the inner child clip's _rotation (degrees)
        clip.vars.innerRot = 0;
        clip.x = baseX;
        clip.y = baseY;
      },

      onEnterFrame: (clip) => {
        // AS: scripts/DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
        //     CLIPACTIONRECORD onClipEvent(enterFrame).as
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let t = clip.vars.t as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        let innerY = clip.vars.innerY as number;
        let innerRot = clip.vars.innerRot as number;
        let baseX = clip.vars.baseX as number;
        let baseY = clip.vars.baseY as number;

        // _parent._x += vx; _parent._y += vy
        baseX += vx;
        baseY += vy;

        if (t !== 1) {
          // _Y = _Y + v
          innerY = innerY + v;
          // _rotation = _rotation + vr
          innerRot = innerRot + vr;
          // v += 1.5
          v += 1.5;

          if (innerY > 0) {
            // Landed: dampen drift, zero rotation, bounce v
            vx = vx / 2;
            vy = vy / 2;
            innerRot = 0;
            innerY = 0;
            v = (-v) / 4;
            if (Math.abs(v) < 1) {
              vx = 0;
              vy = 0;
              t = 1;
            }
          }
        }

        // Write back
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.t = t;
        clip.vars.v = v;
        clip.vars.vr = vr;
        clip.vars.innerY = innerY;
        clip.vars.innerRot = innerRot;
        clip.vars.baseX = baseX;
        clip.vars.baseY = baseY;

        // Apply combined position: baseX/Y + innerY as vertical offset
        clip.x = baseX;
        clip.y = baseY + innerY;
        // Apply rotation (degrees → radians)
        clip.rotation = (innerRot * Math.PI) / 180;
      },
    };

    // ---- lib_sprite9 — clipEvent wrapper, 95-frame timeline ------
    // AS: scripts/DefineSprite_9/frame_1/PlaceObject2_6_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //
    // directlyDynamic: true — the sprite's own onLoad attaches 20
    // "pierres" particles at depths 0-19 (c=0..19).
    //
    // The parent DefineSprite_12 places this symbol at frame 3
    // (depth 2, offset 0.45/-5.15). From frames 49-66 the parent
    // applies a stepwise alpha fade via colorTransform "move" entries.
    // We handle that fade in the outer sprite12Sym's onEnterFrame
    // by checking the elapsed frame index.
    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 95,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,

      onLoad: (clip, ctx) => {
        // AS: scripts/DefineSprite_9/frame_1/PlaceObject2_6_1/
        //     CLIPACTIONRECORD onClipEvent(load).as
        //   c = 0;
        //   while (c < 20) {
        //     this.attachMovie("pierres", "pierres" + c, c);
        //     c++;
        //   }
        for (let c = 0; c < 20; c++) {
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
        }
      },
    };

    // ---- sprite8 / DefineSprite_8 — the outer 73-frame container -
    // This is DefineSprite_12 in the manifest (characterId 12 holds
    // the main anim). We model it as the "anim1Sym" that wraps
    // sprite9 and drives completion.
    //
    // The anim1 composite (74 frames, isComposite: true) is the
    // pre-rendered main timeline content. The live clip tree driving
    // the pierres physics sits on top.
    //
    // We create a synthetic "anim1" symbol for the outer container
    // (DefineSprite_12) which:
    //   - frame 3 (0-based = 2): attaches sprite9 at depth 2 with
    //     position (0.45, -5.15)
    //   - frame 49 (0-based = 48): fires this.end() → signalHit
    //   - frames 49-66 (0-based 48-65): step-down alpha on sprite9
    //     driven from placements[] colorTransform
    //   - frame 73 (0-based = 72): _parent.removeMovieClip() →
    //     complete()
    //
    // The alpha fade schedule from placements[] (alphaMult / 256):
    //   frame 49 = 243/256 ≈ 0.949
    //   frame 50 = 230/256 ≈ 0.898
    //   frame 51 = 217/256 ≈ 0.848
    //   frame 52 = 204/256 ≈ 0.797
    //   frame 53 = 191/256 ≈ 0.746
    //   frame 54 = 178/256 ≈ 0.695
    //   frame 55 = 165/256 ≈ 0.645
    //   frame 56 = 152/256 ≈ 0.594
    //   frame 57 = 140/256 ≈ 0.547
    //   frame 58 = 127/256 ≈ 0.496
    //   frame 59 = 114/256 ≈ 0.445
    //   frame 60 = 101/256 ≈ 0.395
    //   frame 61 =  88/256 ≈ 0.344
    //   frame 62 =  75/256 ≈ 0.293
    //   frame 63 =  62/256 ≈ 0.242
    //   frame 64 =  49/256 ≈ 0.191
    //   frame 65 =  36/256 ≈ 0.141
    //   frame 66 =  23/256 ≈ 0.090
    //
    // We implement the fade via per-frame frameScripts entries for
    // efficiency (matches the canonical "move" PlaceObject2 updates).

    const alphaFadeScripts = new Map<number, (clip: import("@dofus/spell-runtime").SpellClip, ctx: SpellContext) => void>();

    // frame 3 (0-based = 2): place sprite9
    alphaFadeScripts.set(2, (clip, ctx) => {
      // AS: DefineSprite_12 places sprite9 at frame 3 depth 2
      // matrix: translateX=0.45, translateY=-5.15, scale=1
      clip.attach(this.sprite9Sym, "sprite9", 2, ctx, {
        x: 0.45,
        y: -5.15,
      });
    });

    // frame 49 (0-based = 48): this.end() → signalHit
    alphaFadeScripts.set(48, (clip, _ctx) => {
      // AS: scripts/DefineSprite_12/frame_49/DoAction.as
      //   this.end();
      this.runtime.signalHit();
      // Also apply the first alpha step: alphaMult=243/256
      const s9 = clip.children.get("sprite9");
      if (s9) {
        s9.alpha = 243 / 256;
      }
    });

    // frames 50-66 (0-based 49-65): stepwise alpha fade
    const alphaMults = [230, 217, 204, 191, 178, 165, 152, 140, 127, 114, 101, 88, 75, 62, 49, 36, 23];
    for (let i = 0; i < alphaMults.length; i++) {
      const framIdx = 49 + i; // 0-based frames 49..65
      const alphaVal = alphaMults[i]! / 256;
      alphaFadeScripts.set(framIdx, (clip, _ctx) => {
        const s9 = clip.children.get("sprite9");
        if (s9) {
          s9.alpha = alphaVal;
        }
      });
    }

    // frame 73 (0-based = 72): _parent.removeMovieClip()
    alphaFadeScripts.set(72, (clip, _ctx) => {
      // AS: scripts/DefineSprite_12/frame_73/DoAction.as
      //   _parent.removeMovieClip(); stop();
      clip.stop();
      clip.remove();
      this.runtime.complete();
    });

    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 74,
      frames: textures.getFrames("anim1"),
      anchorX: calculateAnchor({ width: 173.9, height: 161.55, offsetX: -86.95, offsetY: -117.45 }).x,
      anchorY: calculateAnchor({ width: 173.9, height: 161.55, offsetX: -86.95, offsetY: -117.45 }).y,
      frameScripts: alphaFadeScripts,
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as
    //   SOMA.playSound("many_502");
    callbacks.playSound("many_502");

    // Attach the outer anim1 container (DefineSprite_12) at the root.
    // This drives the full 73-frame timeline including sprite9 attach,
    // signalHit, alpha fade, and completion.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
