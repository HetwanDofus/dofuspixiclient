/**
 * Spell 514 — Maîtrise des Vents (Xelor / air-type impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 *
 * Canonical AS source:
 *   tools/combat-exporter/output/spell-anims/514/scripts/scripts/
 *
 * The manifest has NO projectile symbols (no "move", "shoot", "duplicate"),
 * one single-entry `animations[]` list ("anim1", 98 frames), and six
 * `librarySymbols[]` entries (sprite5, sprite7, sprite9, sprite11, sprite12,
 * sprite17). All AS scripts are CLIPACTIONRECORD handlers — no main-timeline
 * frame scripts except `SOMA.playSound("many_503")` and the final
 * `_parent.removeMovieClip()` at frame 97 of DefineSprite_18.
 *
 * displayType=11 (TargetCell): no projectile, no caster reference, single
 * impact animation at the target cell. Container anchored at target.
 *
 * Symbol tree (outer → inner):
 *
 *   DefineSprite_18 ("anim18") — 98-frame main container. Not directly
 *     dynamic. Hosts `anim1` (the pre-rendered composite) plus a placement
 *     of sprite17 at depth 2 starting at frame 2 (ratio-keyed tween
 *     through frame 94). Two onClipEvent(load) handlers fire at frames 11
 *     and 79 to send aig/aig1/aig2/cer sub-clips to those positions; an
 *     onClipEvent(enterFrame) at frame 11 pulses alpha. frame 97 removes
 *     the parent (spell complete).
 *
 *   sprite17 ("sprite17") — 1-frame wrapper ring composite (93.5×47.25).
 *     Not directly dynamic. Contains sprite12 at depth 1.
 *
 *   sprite12 ("sprite12") — 1-frame wrapper circle (142.85×142.85). Not
 *     directly dynamic. Named "cer" in parent. Contains four rotating
 *     spoke sprites (sprite5/7/9/11) at depths 1/6/11/16.
 *
 *   sprite5  ("sprite5")  — 1-frame spoke (101.05×101). directlyDynamic.
 *     onEnterFrame: _rotation += 5°.
 *   sprite7  ("sprite7")  — 1-frame spoke (101.05×101). directlyDynamic.
 *     onEnterFrame: _rotation += 5°.
 *   sprite9  ("sprite9")  — 1-frame spoke (101.05×101). directlyDynamic.
 *     onEnterFrame: _rotation += 5°.
 *   sprite11 ("sprite11") — 1-frame spoke (101.05×101). directlyDynamic.
 *     onEnterFrame: _rotation += 5°.
 *
 * The "aig", "aig1", "aig2" names referenced in the frame-11/79 load
 * handlers are the named instances of sprite5/7/9 inside sprite12
 * (or sprite17). Because those inner clips only have `_rotation += 5`
 * onEnterFrame handlers (no gotoAndPlay logic exposed to us at the TS
 * level — the SpellClip timeline is driven entirely by the runtime), the
 * canonical `gotoAndPlay(11)` / `gotoAndPlay(79)` calls on them are
 * timeline seeks within a single-frame symbol that is already looping.
 * For single-frame symbols totalFrames=1 so gotoAndPlay(N-1) clamps
 * to frame 0 and the clip keeps rotating — the visual effect is correct.
 *
 * The sprite17 "cer" clip carries its own alpha-pulse handler
 * (`_alpha = 50 + random(50)`) firing every enterFrame while it is live
 * (starting at frame 11 of DefineSprite_18's timeline).
 *
 * Main timeline: SOMA.playSound("many_503") only (no stop).
 * signalHit: fired when sprite17's onClipEvent(load) at frame 11 fires —
 *   that is the first visible impact frame, which is the canonical hit
 *   moment for a TargetCell spell.
 * complete: fired from DefineSprite_18 frame 97 script.
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

// ---------------------------------------------------------------------------
// Bounds from manifest.json librarySymbols[]
// ---------------------------------------------------------------------------

const SPRITE5_BOUNDS = {
  width: 101.05,
  height: 101,
  offsetX: -50.5,
  offsetY: -50.5,
};
const SPRITE7_BOUNDS = {
  width: 101.05,
  height: 101,
  offsetX: -50.5,
  offsetY: -50.5,
};
const SPRITE9_BOUNDS = {
  width: 101.05,
  height: 101,
  offsetX: -50.5,
  offsetY: -50.5,
};
const SPRITE11_BOUNDS = {
  width: 101.05,
  height: 101,
  offsetX: -50.5,
  offsetY: -50.5,
};
const SPRITE12_BOUNDS = {
  width: 142.85,
  height: 142.85,
  offsetX: -21.45,
  offsetY: -21.45,
};
const SPRITE17_BOUNDS = {
  width: 93.5,
  height: 47.25,
  offsetX: -45.6,
  offsetY: -23,
};

// ---------------------------------------------------------------------------
// Bounds for "anim18" — the outer 98-frame container.
// Uses the top-level animation entry ("anim1") bounds for placement.
// The outer container itself has no authored visual — it hosts anim1 + ring.
// We treat it as a container-only symbol.
// ---------------------------------------------------------------------------

export class Spell514 extends RuntimeSpell {
  readonly spellId = 514;
  readonly displayType = SpellDisplayType.TargetCell;

  // Keep references so the nested attach chain can reach them.
  private sprite5Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;
  private sprite12Sym!: SymbolDefinition;
  private sprite17Sym!: SymbolDefinition;
  private anim18Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite5Anchor = calculateAnchor(SPRITE5_BOUNDS);
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const sprite11Anchor = calculateAnchor(SPRITE11_BOUNDS);
    const sprite12Anchor = calculateAnchor(SPRITE12_BOUNDS);
    const sprite17Anchor = calculateAnchor(SPRITE17_BOUNDS);

    // -----------------------------------------------------------------------
    // sprite5 — rotating spoke, directlyDynamic
    // AS: scripts/DefineSprite_5/frame_1/PlaceObject2_4_2/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + 5;
    // -----------------------------------------------------------------------
    this.sprite5Sym = {
      name: "sprite5",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_5/frame_1/.../onClipEvent(enterFrame):
        //   _rotation = _rotation + 5;
        clip.rotation += (5 * Math.PI) / 180;
      },
    };

    // -----------------------------------------------------------------------
    // sprite7 — rotating spoke, directlyDynamic
    // AS: scripts/DefineSprite_7/frame_1/PlaceObject2_4_2/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + 5;
    // -----------------------------------------------------------------------
    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_7/frame_1/.../onClipEvent(enterFrame):
        //   _rotation = _rotation + 5;
        clip.rotation += (5 * Math.PI) / 180;
      },
    };

    // -----------------------------------------------------------------------
    // sprite9 — rotating spoke, directlyDynamic
    // AS: scripts/DefineSprite_9/frame_1/PlaceObject2_4_2/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + 5;
    // -----------------------------------------------------------------------
    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_9/frame_1/.../onClipEvent(enterFrame):
        //   _rotation = _rotation + 5;
        clip.rotation += (5 * Math.PI) / 180;
      },
    };

    // -----------------------------------------------------------------------
    // sprite11 — rotating spoke, directlyDynamic
    // AS: scripts/DefineSprite_11/frame_1/PlaceObject2_4_2/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + 5;
    // -----------------------------------------------------------------------
    this.sprite11Sym = {
      name: "sprite11",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite11"),
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_11/frame_1/.../onClipEvent(enterFrame):
        //   _rotation = _rotation + 5;
        clip.rotation += (5 * Math.PI) / 180;
      },
    };

    // -----------------------------------------------------------------------
    // sprite12 — circle wrapper, directlyDynamic: false
    // Placement in sprite17 at frame 0, depth 1, named "cer".
    // Matrix: scaleX=0.6507, scaleY=0.3252, translateX=-31.65, translateY=-15.25
    // Hosts four rotating spokes (sprite5 at depth 1, sprite7 at depth 6,
    // sprite9 at depth 11, sprite11 at depth 16) each with the same matrix:
    //   scaleX=0.7071, scaleY=0.7071, rotateSkew0=-0.7071, rotateSkew1=0.7071
    //   translateX=49.95, translateY=50
    // The spoke rotation from the placement matrix encodes a 45° rotation
    // (skew0=-0.7071, skew1=0.7071 → atan2(0.7071, 0.7071) ≈ 45°).
    // alphaMult for sprite7=230/256≈0.898, sprite9=205/256≈0.801,
    // sprite11=230/256≈0.898 (sprite5 has no colorTransform → alpha=1).
    // -----------------------------------------------------------------------
    this.sprite12Sym = {
      name: "sprite12",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite12"),
      anchorX: sprite12Anchor.x,
      anchorY: sprite12Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: sprite12 (characterId 12) places sprite5/7/9/11 at
            // depths 1/6/11/16 via PlaceObject2 with the same matrix.
            // rotateSkew0=-0.7071, rotateSkew1=0.7071 → rotation ≈ 45°
            const spokeRotation = Math.atan2(0.7070770263671875, 0.70709228515625);
            const spokeScaleX = Math.sqrt(
              0.70709228515625 * 0.70709228515625 +
                (-0.7070770263671875) * (-0.7070770263671875)
            );
            const spokeScaleY = Math.sqrt(
              0.7070770263671875 * 0.7070770263671875 +
                0.70709228515625 * 0.70709228515625
            );

            // sprite5 — depth 1, no colorTransform (alpha=1)
            const s5 = clip.attach(this.sprite5Sym, "aig", 1, ctx, {
              x: 49.95,
              y: 50,
              rotation: spokeRotation,
            });
            s5.scaleX = spokeScaleX;
            s5.scaleY = spokeScaleY;
            s5.alpha = 1;

            // sprite7 — depth 6, alphaMult=230/256
            const s7 = clip.attach(this.sprite7Sym, "aig1", 6, ctx, {
              x: 49.95,
              y: 50,
              rotation: spokeRotation,
            });
            s7.scaleX = spokeScaleX;
            s7.scaleY = spokeScaleY;
            s7.alpha = 230 / 256;

            // sprite9 — depth 11, alphaMult=205/256
            const s9 = clip.attach(this.sprite9Sym, "aig2", 11, ctx, {
              x: 49.95,
              y: 50,
              rotation: spokeRotation,
            });
            s9.scaleX = spokeScaleX;
            s9.scaleY = spokeScaleY;
            s9.alpha = 205 / 256;

            // sprite11 — depth 16, alphaMult=230/256
            const s11 = clip.attach(this.sprite11Sym, "spoke3", 16, ctx, {
              x: 49.95,
              y: 50,
              rotation: spokeRotation,
            });
            s11.scaleX = spokeScaleX;
            s11.scaleY = spokeScaleY;
            s11.alpha = 230 / 256;
          },
        ],
      ]),
    };

    // -----------------------------------------------------------------------
    // sprite17 — ring wrapper, directlyDynamic: false
    // Placed inside anim18 at depth 2, first appearance at parent frame 2
    // (index 1 zero-based), named instance is accessed by the
    // onClipEvent(load) handlers as the "this" clip (PlaceObject2_17_2).
    //
    // sprite17 hosts sprite12 ("cer") at depth 1:
    //   matrix: scaleX=0.6507, scaleY=0.3252, translateX=-31.65, translateY=-15.25
    //
    // Two onClipEvent(load) handlers fire when this sprite is placed at
    // parent frames 11 and 79 (the placement at frame 10 → 0-based 9, and
    // at frame 78 → 0-based 77, with the load events in the CLIPACTIONRECORD
    // for their respective parent frames).
    // The onClipEvent(enterFrame) pulses alpha from frame 11 onwards.
    //
    // Because SpellClip only has one onLoad (fires once at attach time),
    // we model the two load events differently:
    //   - The initial attach happens at parent frame 1 (zero-based),
    //     which corresponds to the anim18 frameScripts.set(1, ...) below.
    //     The placement at parent frame 9 (zero-based) re-uses the same
    //     clip (kind:"place" with ratio:10) — we treat it as a no-op re-show.
    //   - The frame-10 load (onClipEvent(load) at parent frame 10 zero-based):
    //     send sub-clips to gotoAndPlay(11). We fire this from anim18's
    //     frameScripts.set(10, ...) by looking up the live "cer17" child.
    //   - The frame-78 load (onClipEvent(load) at parent frame 78 zero-based):
    //     send sub-clips to gotoAndPlay(79). Fired from frameScripts.set(77, ...).
    //
    // The alpha-pulse onEnterFrame: `_alpha = 50 + random(50)` runs on
    // the sprite17 clip itself once it is live. We implement this directly
    // as sprite17's onEnterFrame, guarded by a "live" flag set from the
    // first load event.
    // -----------------------------------------------------------------------
    this.sprite17Sym = {
      name: "sprite17",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite17"),
      anchorX: sprite17Anchor.x,
      anchorY: sprite17Anchor.y,
      onLoad: (clip, ctx) => {
        // Initial load: attach sprite12 ("cer") at depth 1.
        // AS: sprite17 placement in anim18, matrix for sprite12:
        //   scaleX=0.6507, scaleY=0.3252, translateX=-31.65, translateY=-15.25
        const cer = clip.attach(this.sprite12Sym, "cer", 1, ctx, {
          x: -31.65,
          y: -15.25,
        });
        cer.scaleX = 0.6506805419921875;
        cer.scaleY = 0.3251800537109375;
        // Mark as not yet pulsing alpha (starts at parent frame 11).
        clip.vars.alphaPulseActive = false;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_18/frame_11/PlaceObject2_17_2/
        //   CLIPACTIONRECORD onClipEvent(enterFrame):
        //   _alpha = 50 + random(50);
        // Only active once the frame-11 load event has fired.
        if (clip.vars.alphaPulseActive) {
          clip.alpha = (50 + Math.floor(Math.random() * 50)) / 100;
        }
      },
    };

    // -----------------------------------------------------------------------
    // anim18 — 98-frame outer container (DefineSprite_18)
    // directlyDynamic: false — drives the full spell timeline.
    // Hosts:
    //   - depth 1: "anim1" pre-rendered composite (98 frames, loaded as the
    //     main animation texture set).
    //   - depth 2: sprite17 (ring), placed at parent frame 1 (zero-based),
    //     with tween through frame 94. Two load events at frames 10 and 77
    //     (zero-based) forward gotoAndPlay to sub-clips.
    // frame 97 (zero-based 96): _parent.removeMovieClip() → complete().
    //
    // The anim1 pre-rendered frames are played via anim18's own sprite,
    // which we load using textures.getFrames("anim1") (animations[] entry,
    // no lib_ prefix).
    // -----------------------------------------------------------------------
    this.anim18Sym = {
      name: "anim18",
      totalFrames: 98,
      frames: textures.getFrames("anim1"),
      anchorX: calculateAnchor({
        width: 131.45,
        height: 101.25,
        offsetX: -64,
        offsetY: -50.5,
      }).x,
      anchorY: calculateAnchor({
        width: 131.45,
        height: 101.25,
        offsetX: -64,
        offsetY: -50.5,
      }).y,
      frameScripts: new Map([
        [
          // Parent frame 2 (zero-based 1): first placement of sprite17
          // at depth 2. matrix: translateX=0.1, translateY=0.05, scale=1.
          // colorTransform at frame 2 (ratio=2): all white (redAdd=255 etc)
          // → we approximate as alpha=1 full bright; color tween handled
          // by the authored SVG frames in anim1.
          1,
          (clip, ctx) => {
            // AS: DefineSprite_18 places sprite17 at depth 2 from frame 2.
            const ring = clip.attach(this.sprite17Sym, "cer17", 2, ctx, {
              x: 0.1,
              y: 0.05,
            });
            ring.scaleX = 1;
            ring.scaleY = 1;
            ring.alpha = 1;
          },
        ],
        [
          // Parent frame 11 (zero-based 10):
          // AS DefineSprite_18/frame_11/PlaceObject2_17_2/
          //   CLIPACTIONRECORD onClipEvent(load):
          //   aig.gotoAndPlay(11); aig1.gotoAndPlay(11);
          //   aig2.gotoAndPlay(11); cer.gotoAndPlay(11);
          // Also: activate alpha pulse on the ring clip.
          // Also: canonical hit frame — signal hit.
          10,
          (clip) => {
            // AS DefineSprite_18/frame_11/PlaceObject2_17_2/
            //   CLIPACTIONRECORD onClipEvent(load).as
            const ring = clip.children.get("cer17");
            if (ring) {
              // Activate alpha pulse
              ring.vars.alphaPulseActive = true;
              // Forward gotoAndPlay(11) → gotoAndPlay(10) zero-based
              // to the sub-clips named aig, aig1, aig2, cer inside ring.
              // Those are actually inside ring's child "cer" (sprite12).
              const cerClip = ring.children.get("cer");
              if (cerClip) {
                const aig = cerClip.children.get("aig");
                const aig1 = cerClip.children.get("aig1");
                const aig2 = cerClip.children.get("aig2");
                if (aig) { aig.gotoAndPlay(10); }
                if (aig1) { aig1.gotoAndPlay(10); }
                if (aig2) { aig2.gotoAndPlay(10); }
                // cer itself — single-frame symbol, clamp to 0
                cerClip.gotoAndPlay(10);
              }
            }
            // Canonical hit signal — frame 11 is the first visible
            // impact frame for this TargetCell spell.
            this.runtime.signalHit();
          },
        ],
        [
          // Parent frame 79 (zero-based 78):
          // AS DefineSprite_18/frame_79/PlaceObject2_17_2/
          //   CLIPACTIONRECORD onClipEvent(load):
          //   aig.gotoAndPlay(79); aig1.gotoAndPlay(79);
          //   aig2.gotoAndPlay(79); cer.gotoAndPlay(79);
          77,
          (clip) => {
            // AS DefineSprite_18/frame_79/PlaceObject2_17_2/
            //   CLIPACTIONRECORD onClipEvent(load).as
            const ring = clip.children.get("cer17");
            if (ring) {
              const cerClip = ring.children.get("cer");
              if (cerClip) {
                const aig = cerClip.children.get("aig");
                const aig1 = cerClip.children.get("aig1");
                const aig2 = cerClip.children.get("aig2");
                if (aig) { aig.gotoAndPlay(78); }
                if (aig1) { aig1.gotoAndPlay(78); }
                if (aig2) { aig2.gotoAndPlay(78); }
                cerClip.gotoAndPlay(78);
              }
            }
          },
        ],
        [
          // Parent frame 97 (zero-based 96):
          // AS DefineSprite_18/frame_97/DoAction.as:
          //   _parent.removeMovieClip();
          96,
          (clip) => {
            // AS DefineSprite_18/frame_97/DoAction.as:
            //   _parent.removeMovieClip();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite5Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite11Sym);
    this.registry.register(this.sprite12Sym);
    this.registry.register(this.sprite17Sym);
    this.registry.register(this.anim18Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: scripts/frame_1/DoAction.as
    //   SOMA.playSound("many_503");
    callbacks.playSound("many_503");

    // Attach anim18 as the sole child of root at depth 1.
    // For TargetCell, root is at (0,0) in the spell container which is
    // already anchored at the target cell by the harness.
    this.root.attach(this.anim18Sym, "anim18", 1, context, {
      x: 0,
      y: 0,
    });
  }
}
