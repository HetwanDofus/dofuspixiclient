/**
 * Spell 510 — Lance (linear projectile spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/510/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The spell fires a lance from caster to
 * target along a straight rotated line. The main timeline's outer sprite
 * (DefineSprite_9, 75 frames) plays the anim1 composite and removes itself
 * at frame 73. The harness attaches no "move" — this is a linear projectile
 * with authored animation, not a physics-driven ballistic.
 *
 * However, looking more carefully: there is no "move" or "shoot" library
 * symbol. The spell has a single anim1 (75 frames, isComposite=true) that
 * IS the main visual. The library symbols are:
 *   - sprite6 (characterId 6, directlyDynamic: true, 54 frames) — a glow
 *     trail particle. PlaceObject2_5_3 has onClipEvent(load) that sets
 *     _visible=false, and onClipEvent(enterFrame) that randomly flickers
 *     _visible. Placed inside sprite7 (its parent) at depth 3 frame 0.
 *     Has frame_52 DoAction: stop().
 *   - sprite7 (characterId 7, directlyDynamic: false, 21 frames) — wrapper
 *     that contains 4 placements of sprite6 at different depths/offsets.
 *     parentSpriteId=8 means it is placed inside sprite8.
 *   - sprite8 (characterId 8, directlyDynamic: true, 1 frame) — the lance
 *     head/body composite. Has 4 placements of sprite7 (at depths 1,3,5,7
 *     with offsets) in sprite8's own frame 0. Also has 4 onClipEvent(load)
 *     scripts on the placed sprite7 instances (PlaceObject2_7_1,3,5,7) that
 *     call gotoAndPlay(random(...)+N) to stagger the animation phase.
 *     parentSpriteId=9 means it is placed inside DefineSprite_9.
 *
 * DefineSprite_9 (characterId 9) — the outer main timeline container:
 *   - frame_1/DoAction.as: SOMA.playSound("lance") — but this is inside
 *     DefineSprite_9, NOT the root main timeline. We port it from
 *     onSpellStart since the root main timeline immediately plays sprite9.
 *   - frame_73/DoAction.as: this._parent.removeMovieClip() → complete().
 *
 * The anim1 animation IS the pre-rendered main timeline visual. Since there
 * is no "move"/"shoot" pattern, and the spell is a linear lance fired toward
 * the target, displayType=20 (ProjectileLinear) is correct — the container
 * is anchored at caster, rotated toward target, and the authored anim1
 * composite plays along the rotation axis.
 *
 * Library symbols:
 *   - sprite6 — glow flicker particle (54 frames). onLoad: _visible=false.
 *     onEnterFrame: randomly toggles visible. frame_51: stop().
 *   - sprite7 — wrapper (21 frames). Attaches 4 sprite6 instances at
 *     different offsets/depths on frame 0.
 *   - sprite8 — lance head (1 frame). Attaches 4 sprite7 instances at
 *     depths 1,3,5,7 on frame 0; each sprite7 gets an onLoad-driven
 *     gotoAndPlay with a staggered random phase.
 *
 * Main timeline (DefineSprite_9): plays anim1, frame_1 fires sound, frame_73
 * removes outer mc → complete().
 *
 * Since anim1 is the pre-rendered composite visual and sprite8 is the dynamic
 * overlay (lance glow flicker), we register anim1 as the main visual symbol
 * and attach sprite8 as an overlay. The anim1 drives the authoritative
 * 75-frame timeline through DefineSprite_9.
 *
 * For displayType=20 (ProjectileLinear): container at caster, rotated to face
 * target. The anim1 composite extends rightward from origin (matching a
 * horizontal lance that the container rotation then tilts toward the target).
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

// --- Manifest bounds for library symbols ---

const SPRITE6_BOUNDS = {
  width: 90.85,
  height: 14.25,
  offsetX: -55.45,
  offsetY: -7.9,
};

const SPRITE7_BOUNDS = {
  width: 159.4,
  height: 14.25,
  offsetX: -22.6,
  offsetY: -7.9,
};

const SPRITE8_BOUNDS = {
  width: 178.05,
  height: 22.9,
  offsetX: -16.1,
  offsetY: -14.15,
};

// anim1 bounds (from animations[0])
const ANIM1_BOUNDS = {
  width: 421.35,
  height: 23.15,
  offsetX: -20.9,
  offsetY: -14.3,
};

export class Spell510 extends RuntimeSpell {
  readonly spellId = 510;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  private sprite6Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private sprite8Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const sprite8Anchor = calculateAnchor(SPRITE8_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite6 — glow flicker particle (directlyDynamic: true) -----------
    // AS: scripts/DefineSprite_6/frame_1/PlaceObject2_5_3/CLIPACTIONRECORD onClipEvent(load).as
    //   _visible = false;
    // AS: scripts/DefineSprite_6/frame_1/PlaceObject2_5_3/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _visible = false;
    //   if (random(20) == 1) { _visible = true; }
    // AS: scripts/DefineSprite_6/frame_52/DoAction.as
    //   stop();
    this.sprite6Sym = {
      name: "sprite6",
      totalFrames: 54,
      frames: textures.getFrames("lib_sprite6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6/frame_1/PlaceObject2_5_3/CLIPACTIONRECORD onClipEvent(load).as
        clip.visible = false;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6/frame_1/PlaceObject2_5_3/CLIPACTIONRECORD onClipEvent(enterFrame).as
        clip.visible = false;
        if (Math.floor(Math.random() * 20) === 1) {
          clip.visible = true;
        }
      },
      frameScripts: new Map([
        [
          51,
          (clip) => {
            // AS DefineSprite_6/frame_52/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite7 — wrapper for 4 sprite6 instances (directlyDynamic: false) ---
    // AS: no clip-event scripts on sprite7 itself.
    // Its job is to place 4 sprite6 instances at different depths/offsets.
    // Placements (all frame=0, parentSpriteId=8, so attached inside sprite8):
    //   depth 1: translateX=6.5,   translateY=-0.6
    //   depth 3: translateX=12.15, translateY=-6.25
    //   depth 5: translateX=25.15, translateY=-6.25
    //   depth 7: translateX=19.9,  translateY=2.4
    //
    // However, the placements array says parentSpriteId=8 for all sprite7
    // placements — meaning sprite7 is PLACED BY sprite8. Inside sprite7,
    // sprite6 is placed at frame 0 depth 3 (PlaceObject2_5_3) with
    // clipEvents. Since sprite7 is directlyDynamic: false, we just attach
    // one sprite6 instance (depth 3) inside sprite7's frame 0.
    // The 4 instances of sprite6 within sprite7 correspond to the 4
    // onClipEvent(load) scripts on PlaceObject2_7_1, _3, _5, _7 inside
    // sprite8. Each placed instance of sprite7 in sprite8 contributes one
    // sprite6 child.
    //
    // Per the manifest placements for sprite6: parentSpriteId=7 at depth=1,
    // so sprite6 is placed at depth 1 inside sprite7 at frame 0.
    // (The clip-event handlers on PlaceObject2_5_3 = depth 3 in sprite6's
    // own scripts directory — this refers to sprite6's placement depth
    // within sprite7 being depth 3... wait, re-reading the scripts path:
    // DefineSprite_6/frame_1/PlaceObject2_5_3 means: inside DefineSprite_6's
    // frame 1, a PlaceObject2 that places characterId 5 at depth 3.
    // But characterId 5 is not listed in librarySymbols — it is a shape/
    // static graphic embedded in sprite6. The clipEvents are ON the placed
    // object inside sprite6. So the onLoad/onEnterFrame belong to sprite6
    // itself (the outermost clip that has these handlers).
    //
    // Final interpretation: sprite6 IS the clip with clipEvents. Its
    // onLoad/onEnterFrame are what we port. sprite7 is a container that
    // places sprite6 at depth 1 (per placements[0]: parentSpriteId=7,
    // depth=1, frame=0). sprite8 places 4 instances of sprite7 at
    // depths 1,3,5,7 (per sprite7's placements: parentSpriteId=8).
    // Each of those 4 sprite7 instances triggers its sprite6 child to
    // gotoAndPlay at a random staggered frame (per the 4 onClipEvent(load)
    // scripts on PlaceObject2_7_1,3,5,7 inside sprite8).
    //
    // The gotoAndPlay stagger is applied to the sprite7 children of sprite8:
    //   PlaceObject2_7_1 (depth 1): gotoAndPlay(random(6) + 2)  → [2..7]
    //   PlaceObject2_7_3 (depth 3): gotoAndPlay(random(9) + 3)  → [3..11]
    //   PlaceObject2_7_5 (depth 5): gotoAndPlay(random(6) + 5)  → [5..10]
    //   PlaceObject2_7_7 (depth 7): gotoAndPlay(random(9) + 2)  → [2..10]
    // These apply to sprite7 instances, staggering their internal timeline.
    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 21,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: sprite6 placed at depth 1 inside sprite7 at frame 0
            // (placements[0]: parentSpriteId=7, frame=0, depth=1,
            //  translateX=0, translateY=0, scaleX=1, scaleY=1)
            clip.attach(this.sprite6Sym, "sprite6_d1", 1, ctx, {
              x: 0,
              y: 0,
            });
          },
        ],
      ]),
    };

    // ---- sprite8 — lance head composite (directlyDynamic: true) -------------
    // AS: scripts/DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(6) + 2);   → depth 1 sprite7 → [2..7]
    // AS: scripts/DefineSprite_8/frame_1/PlaceObject2_7_3/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(9) + 3);   → depth 3 sprite7 → [3..11]
    // AS: scripts/DefineSprite_8/frame_1/PlaceObject2_7_5/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(6) + 5);   → depth 5 sprite7 → [5..10]
    // AS: scripts/DefineSprite_8/frame_1/PlaceObject2_7_7/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(9) + 2);   → depth 7 sprite7 → [2..10]
    //
    // sprite8 placements (parentSpriteId=9, frame=0):
    //   depth 1: translateX=6.5,   translateY=-0.6  (PlaceObject2_7_1)
    //   depth 3: translateX=12.15, translateY=-6.25 (PlaceObject2_7_3)
    //   depth 5: translateX=25.15, translateY=-6.25 (PlaceObject2_7_5)
    //   depth 7: translateX=19.9,  translateY=2.4   (PlaceObject2_7_7)
    // scaleX=1, scaleY=1 for all.
    //
    // The onLoad stagger-gotoAndPlay fires on the placed sprite7 instance,
    // NOT on sprite8 itself. We model this by, after attaching each sprite7
    // instance, calling gotoAndPlay on that child clip in the attach step.
    // Since the SymbolDefinition onLoad fires immediately after attach, we
    // encode the stagger in per-instance onLoad via closure — but that would
    // require 4 separate SymbolDefinitions. Instead we use frameScripts on
    // sprite8's frame 0 to attach 4 sprite7 instances and stagger them
    // immediately after attach.
    //
    // Note: sprite7 totalFrames=21. gotoAndPlay is 1-based in AS → 0-based
    // in runtime. random(6)+2 AS → Math.floor(Math.random()*6)+2 → subtract
    // 1 for 0-based → Math.floor(Math.random()*6)+1.
    this.sprite8Sym = {
      name: "sprite8",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_8/frame_1: place 4 sprite7 instances with
            // per-instance gotoAndPlay stagger from onClipEvent(load).

            // PlaceObject2_7_1 (depth 1): translateX=6.5, translateY=-0.6
            // onClipEvent(load): gotoAndPlay(random(6) + 2)
            {
              const s7d1 = clip.attach(
                this.sprite7Sym,
                "sprite7_d1",
                1,
                ctx,
                { x: 6.5, y: -0.6 },
              );
              // AS DefineSprite_8/frame_1/PlaceObject2_7_1/onClipEvent(load):
              // gotoAndPlay(random(6) + 2) → 0-based: random(6)+1
              const phase1 = Math.floor(Math.random() * 6) + 1;
              s7d1.gotoAndPlay(phase1);
            }

            // PlaceObject2_7_3 (depth 3): translateX=12.15, translateY=-6.25
            // onClipEvent(load): gotoAndPlay(random(9) + 3)
            {
              const s7d3 = clip.attach(
                this.sprite7Sym,
                "sprite7_d3",
                3,
                ctx,
                { x: 12.15, y: -6.25 },
              );
              // AS DefineSprite_8/frame_1/PlaceObject2_7_3/onClipEvent(load):
              // gotoAndPlay(random(9) + 3) → 0-based: random(9)+2
              const phase3 = Math.floor(Math.random() * 9) + 2;
              s7d3.gotoAndPlay(phase3);
            }

            // PlaceObject2_7_5 (depth 5): translateX=25.15, translateY=-6.25
            // onClipEvent(load): gotoAndPlay(random(6) + 5)
            {
              const s7d5 = clip.attach(
                this.sprite7Sym,
                "sprite7_d5",
                5,
                ctx,
                { x: 25.15, y: -6.25 },
              );
              // AS DefineSprite_8/frame_1/PlaceObject2_7_5/onClipEvent(load):
              // gotoAndPlay(random(6) + 5) → 0-based: random(6)+4
              const phase5 = Math.floor(Math.random() * 6) + 4;
              s7d5.gotoAndPlay(phase5);
            }

            // PlaceObject2_7_7 (depth 7): translateX=19.9, translateY=2.4
            // onClipEvent(load): gotoAndPlay(random(9) + 2)
            {
              const s7d7 = clip.attach(
                this.sprite7Sym,
                "sprite7_d7",
                7,
                ctx,
                { x: 19.9, y: 2.4 },
              );
              // AS DefineSprite_8/frame_1/PlaceObject2_7_7/onClipEvent(load):
              // gotoAndPlay(random(9) + 2) → 0-based: random(9)+1
              const phase7 = Math.floor(Math.random() * 9) + 1;
              s7d7.gotoAndPlay(phase7);
            }
          },
        ],
      ]),
    };

    // ---- anim1 — main lance composite (75 frames, pre-rendered) -------------
    // DefineSprite_9 wraps anim1 and also places sprite8 as overlay.
    // frame_1/DoAction.as: SOMA.playSound("lance") — handled in onSpellStart.
    // frame_73/DoAction.as: this._parent.removeMovieClip() → complete().
    //
    // We model DefineSprite_9 as the "anim1" symbol: it plays the pre-rendered
    // anim1 frames, attaches sprite8 as a child overlay, and fires completion
    // at frame 73.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 75,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_9 places sprite8 at frame 0 (depth 1) with
            // matrix: scaleX=0.4682, translateX=4.85, translateY=0.1
            // (placements[0] of sprite8: parentSpriteId=9, frame=0, depth=1)
            clip.attach(this.sprite8Sym, "sprite8", 1, ctx, {
              x: 4.85,
              y: 0.1,
            });
          },
        ],
        [
          72,
          (clip) => {
            // AS DefineSprite_9/frame_73/DoAction.as:
            // this._parent.removeMovieClip() → spell complete
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite8Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS DefineSprite_9/frame_1/DoAction.as: SOMA.playSound("lance")
    callbacks.playSound("lance");

    // Attach the main anim1 symbol at the root. For displayType=20
    // (ProjectileLinear) the harness has already rotated root toward target
    // and attached "shoot" if registered. Since there is no separate "shoot"
    // symbol here (the anim1 IS the full projectile visual including impact),
    // we attach anim1 directly at root depth 1.
    // signalHit: there is no explicit hit frame in the canonical AS.
    // We fire it at an approximate mid-point (frame 0 of anim1 = projectile
    // launch; target is hit when the lance visual reaches the end).
    // The canonical AS has no explicit end.this() or hit signal — use the
    // completion frame (72) as the signal. We fire signalHit just before
    // complete at frame 72 from inside the anim1 frameScript (below).
    // Actually we need to fire signalHit at the canonical hit moment.
    // Looking at DefineSprite_9: there is no explicit hit callback in the
    // canonical AS. For a linear lance that plays through and then removes,
    // the hit is conventionally at the first frame (instant impact visual).
    // We signal hit now (frame 0 / launch moment matches the display at
    // target since it's a linear projectile centered at caster-to-target).
    this.runtime.signalHit();

    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
