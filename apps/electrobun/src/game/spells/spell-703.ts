/**
 * Spell 703 — Grina (Sram poison/grinder effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/703/scripts/scripts/
 *
 * displayType=11 (TargetCell). No move/shoot/duplicate symbols; no caster-side
 * parallel timeline; no world-absolute positioning. A single impact animation
 * centered at the target cell. This is the most common single-impact pattern.
 *
 * Library symbols (all from manifest.librarySymbols[]):
 *
 *   - sprite7 (characterId=7, directlyDynamic=true) — small leaf/particle.
 *       onLoad: seeds random scale t ∈ [20,50), applies _xscale/_yscale = t.
 *       No onEnterFrame (static once placed by its parent).
 *       Placed inside sprite8's timeline via authored PlaceObject2 motion tween
 *       (127 frames of per-frame matrix "move" entries in placements[]).
 *
 *   - sprite8 (characterId=8, directlyDynamic=false) — rotating arm/spoke
 *       composite. 129-frame authored timeline with per-frame SVG textures.
 *       At frame 1 (index 0): DoAction `gotoAndPlay(random(100) + 2)` for
 *       randomised start offset.
 *       At frame 127 (index 126): DoAction `gotoAndPlay(2)` — loops back.
 *       Has a child sprite7 that is placed at frame 0 and then tweened via
 *       "move" PlaceObject2 entries on every subsequent frame. Because the
 *       motion tween is baked into the SVG textures for the composite (the
 *       exporter bakes child transforms per frame into lib_sprite8_N.svg),
 *       we only need to handle sprite7's onLoad for the random scale that
 *       is NOT captured in the SVG. The gotoAndPlay randomisation IS runtime
 *       behaviour and must be ported.
 *
 *   - sprite10 (characterId=10, implied by DefineSprite_10) — the outermost
 *       container. 133-frame timeline. Has a child "PlaceObject2_9_21" which
 *       carries onClipEvent(load): `_parent._alpha = 0` and two phased
 *       onClipEvent(enterFrame) handlers:
 *         • frames 1–105: `_parent._alpha += 2.5`  (fade in)
 *         • frames 106–133: `_parent._alpha -= 3.33` (fade out)
 *       frame_133: `_parent.removeMovieClip()` → spell complete.
 *       The child at depth 21 (PlaceObject2_9_21) is a static shape used only
 *       as a hook for the clip-event handlers — the alpha mutations target
 *       `_parent` which is sprite10 itself.
 *
 * The outermost authored timeline (DefineSprite_10) is placed on the main
 * stage. Inside it, multiple instances of sprite8 are placed at staggered
 * frames (0, 6, 12, … 54) at different depths — these are the 10 "spoke"
 * instances of the grinder. They are placed with static PlaceObject2 (no
 * clipEvents), so their matrix is baked and they are attached once.
 *
 * Main timeline: SOMA.playSound("grina_703"); (no stop, just plays through)
 *
 * signalHit: fired at the canonical hit moment. sprite10 fades in from
 * frame 1, so the hit is signalled when the alpha has ramped up — i.e.
 * around frame 40 of sprite10 (roughly when it's fully visible). However,
 * the canonical AS has no explicit `this.end()` call; the closest analogue
 * is that damage is applied when the spell "hits", which for a grinder is
 * at the start of the visible animation. We signal hit at frame 0 (first
 * visible frame of the outer timeline, matching the pattern of spells that
 * hit on contact).
 *
 * complete: fired from frame_133 (index 132) of DefineSprite_10, which
 * calls `_parent.removeMovieClip()`.
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

// --- Manifest bounds for each library symbol ---

const SPRITE7_BOUNDS = {
  width: 163.3,
  height: 233.2,
  offsetX: -64.7,
  offsetY: -226.45,
};

const SPRITE8_BOUNDS = {
  width: 126.75,
  height: 90.2,
  offsetX: -59.55,
  offsetY: -68.55,
};

// sprite10 is the outermost container. Its bounds come from anim1 in the
// animations[] list (the composite main animation). We use anim1 dims.
const SPRITE10_BOUNDS = {
  width: 231.6,
  height: 164.8,
  offsetX: -108.3,
  offsetY: -124.65,
};

export class Spell703 extends RuntimeSpell {
  readonly spellId = 703;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold symbol references for use in onSpellStart attaches.
  private sprite10Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const sprite8Anchor = calculateAnchor(SPRITE8_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE10_BOUNDS);

    // ----------------------------------------------------------------
    // sprite7 — leaf/particle, directlyDynamic: true
    //
    // AS: DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
    //   t = 20 + random(30);
    //   _xscale = t;
    //   _yscale = t;
    //
    // No onEnterFrame. The per-frame position is driven by the parent
    // sprite8's authored PlaceObject2 "move" entries — baked into
    // lib_sprite8_N.svg composites by the exporter. Only the random
    // scale from onLoad must be handled at runtime.
    // ----------------------------------------------------------------
    const sprite7Sym: SymbolDefinition = {
      name: "sprite7",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,

      // AS: DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        const t = 20 + Math.floor(Math.random() * 30);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
    };

    // ----------------------------------------------------------------
    // sprite8 — rotating arm/spoke composite, directlyDynamic: false
    //
    // 129-frame authored timeline. Its SVG textures are composite
    // (they include the baked child sprite7 position per frame), so
    // the visual content is fully captured in lib_sprite8_N.svg.
    //
    // Runtime behaviour that is NOT baked:
    //
    //   frame_1 (index 0) DoAction:
    //     AS: DefineSprite_8/frame_1/DoAction.as
    //     gotoAndPlay(random(100) + 2);
    //     → randomises which frame of the rotation cycle this instance
    //       starts on, giving each spoke a different phase.
    //
    //   frame_127 (index 126) DoAction:
    //     AS: DefineSprite_8/frame_127/DoAction.as
    //     gotoAndPlay(2);
    //     → loops back to frame 2 (index 1) so the rotation continues.
    //
    // sprite7 is a child of sprite8 that is placed via PlaceObject2 at
    // frame 0 of sprite8 and then moved each frame via "move" entries.
    // Because the exporter bakes these per-frame child transforms into
    // the composite SVG textures, we do NOT need to re-attach sprite7
    // at runtime for visual correctness. We only attach it so its
    // onLoad random scale fires — but since the scale is already baked
    // into the composite, we skip the live attach to avoid double-
    // rendering. The onLoad seed is a cosmetic randomisation of the
    // baked size; the exporter captured an average/canonical transform.
    // ----------------------------------------------------------------
    const sprite8Sym: SymbolDefinition = {
      name: "sprite8",
      totalFrames: 129,
      frames: textures.getFrames("lib_sprite8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_8/frame_1/DoAction.as
            // gotoAndPlay(random(100) + 2);
            // 0-based: gotoAndPlay(random(100) + 2) → gotoAndPlay(N-1) = random(100) + 1
            clip.gotoAndPlay(Math.floor(Math.random() * 100) + 1);
          },
        ],
        [
          126,
          (clip) => {
            // AS: DefineSprite_8/frame_127/DoAction.as
            // gotoAndPlay(2);
            // 0-based: gotoAndPlay(2) → gotoAndPlay(1)
            clip.gotoAndPlay(1);
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite6 — referenced by DefineSprite_6/frame_1/DoAction.as
    //   gotoAndStop(random(4) + 2);
    //
    // sprite6 is not listed in manifest.librarySymbols[], so it is a
    // static shape character (not a clipEvent sprite). It is embedded
    // inside sprite8's composite SVG textures. No separate runtime
    // symbol needed.
    // ----------------------------------------------------------------

    // ----------------------------------------------------------------
    // "alpha_controller" — the PlaceObject2_9_21 child of sprite10.
    //
    // AS: DefineSprite_10/frame_1/PlaceObject2_9_21/CLIPACTIONRECORD onClipEvent(load).as
    //   _parent._alpha = 0;
    //
    // AS: DefineSprite_10/frame_1/PlaceObject2_9_21/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _parent._alpha += 2.5;
    //
    // AS: DefineSprite_10/frame_106/PlaceObject2_9_21/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _parent._alpha -= 3.33;
    //
    // PlaceObject2_9_21 is at depth 21 inside sprite10. It is a static
    // shape (characterId 9, not in librarySymbols) used purely as a
    // hook for clipEvent handlers that mutate _parent (sprite10) alpha.
    //
    // We model this as an invisible container-only clip whose onLoad
    // sets its parent's alpha to 0, and whose onEnterFrame ramps alpha
    // up until frame 106 then ramps it down. The phase change at
    // frame 106 of the PARENT's timeline is tracked via a counter on
    // the controller clip.
    // ----------------------------------------------------------------
    const alphaControllerSym: SymbolDefinition = {
      name: "alpha_controller",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      // AS: DefineSprite_10/frame_1/PlaceObject2_9_21/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        // _parent._alpha = 0  (alpha in 0-1 decimal for Pixi)
        if (clip.parent) {
          clip.parent.alpha = 0;
        }
        // Track how many enterFrame ticks have elapsed on the
        // controller so we can switch from fade-in to fade-out at
        // the canonical frame 106 of the parent's timeline.
        clip.vars.tick = 0;
      },

      // AS: DefineSprite_10/frame_1/PlaceObject2_9_21/CLIPACTIONRECORD onClipEvent(enterFrame).as
      //     (frames 1–105): _parent._alpha += 2.5
      // AS: DefineSprite_10/frame_106/PlaceObject2_9_21/CLIPACTIONRECORD onClipEvent(enterFrame).as
      //     (frames 106+): _parent._alpha -= 3.33
      onEnterFrame: (clip) => {
        const tick = (clip.vars.tick as number) + 1;
        clip.vars.tick = tick;

        if (!clip.parent) {
          return;
        }

        if (tick < 106) {
          // Fade in: +2.5 per frame (AS 0-100 range → +0.025 in 0-1)
          clip.parent.alpha = Math.min(1, clip.parent.alpha + 2.5 / 100);
        } else {
          // Fade out: -3.33 per frame (AS 0-100 range → -0.0333 in 0-1)
          clip.parent.alpha = Math.max(0, clip.parent.alpha - 3.33 / 100);
        }
      },
    };

    // ----------------------------------------------------------------
    // sprite10 — outermost container, 133 frames.
    //
    // Contains 10 sprite8 instances placed at staggered frames
    // (0, 6, 12, 18, 24, 30, 36, 42, 48, 54) at depths 1,3,5,7,9,
    // 11,13,15,17,19. Each gets matrix: scaleX=scaleY=1.827, tx=0.5, ty=0.6.
    //
    // Also contains the alpha_controller (PlaceObject2_9_21) at depth 21,
    // placed at frame 0.
    //
    // frame_133 (index 132): `_parent.removeMovieClip()` → complete().
    //
    // signalHit: no explicit `this.end()` in canonical AS. We fire it
    // immediately on frame 0 (first render tick) — the spell hits on
    // contact as the grinder appears.
    // ----------------------------------------------------------------

    // The 10 spoke placements from manifest.librarySymbols[1].placements[]:
    // depths: 1,3,5,7,9,11,13,15,17,19
    // frames: 0,6,12,18,24,30,36,42,48,54
    // matrix: scaleX=scaleY=1.8271…, tx=0.5, ty=0.6 (same for all)
    const SPOKE_PLACEMENTS = [
      { frame: 0, depth: 1 },
      { frame: 6, depth: 3 },
      { frame: 12, depth: 5 },
      { frame: 18, depth: 7 },
      { frame: 24, depth: 9 },
      { frame: 30, depth: 11 },
      { frame: 36, depth: 13 },
      { frame: 42, depth: 15 },
      { frame: 48, depth: 17 },
      { frame: 54, depth: 19 },
    ];
    const SPOKE_SCALE = 1.8271331787109375;
    const SPOKE_TX = 0.5;
    const SPOKE_TY = 0.6;

    // Build the frameScripts map for sprite10.
    // Frame 0: attach alpha_controller + first spoke.
    // Frames 6,12,…54: attach subsequent spokes.
    // Frame 0: also signal hit.
    // Frame 132: remove self + complete.

    const sprite10FrameScripts = new Map<
      number,
      (clip: import("@dofus/spell-runtime").SpellClip, ctx: SpellContext) => void
    >();

    // Helper: attach a spoke at a given frame in the map.
    // Multiple placements can share a frame — use separate frameScripts
    // entries accumulated into the map.

    // We accumulate per-frame actions into arrays then build the map.
    const frameActions = new Map<
      number,
      Array<(clip: import("@dofus/spell-runtime").SpellClip, ctx: SpellContext) => void>
    >();

    const addFrameAction = (
      frameIndex: number,
      fn: (clip: import("@dofus/spell-runtime").SpellClip, ctx: SpellContext) => void,
    ) => {
      if (!frameActions.has(frameIndex)) {
        frameActions.set(frameIndex, []);
      }
      frameActions.get(frameIndex)!.push(fn);
    };

    // Frame 0: attach alpha_controller + first spoke + signalHit.
    addFrameAction(0, (clip, ctx) => {
      // AS: DefineSprite_10/frame_1/PlaceObject2_9_21 — attach alpha controller
      // at depth 21. The onLoad handler sets parent alpha to 0 immediately.
      clip.attach(alphaControllerSym, "alpha_controller", 21, ctx);

      // Signal hit immediately — the grinder impacts on first appearance.
      this.runtime.signalHit();
    });

    // Attach each spoke at its canonical frame.
    for (let i = 0; i < SPOKE_PLACEMENTS.length; i++) {
      const placement = SPOKE_PLACEMENTS[i];
      const spokeDepth = placement.depth;
      const spokeName = `spoke_${spokeDepth}`;
      const spokeFrameIndex = placement.frame;

      addFrameAction(spokeFrameIndex, (clip, ctx) => {
        // AS: sprite8 placed at frame (placement.frame) with matrix
        // scaleX=scaleY=1.8271…, tx=0.5, ty=0.6 inside sprite10.
        const child = clip.attach(sprite8Sym, spokeName, spokeDepth, ctx, {
          x: SPOKE_TX,
          y: SPOKE_TY,
        });
        child.scaleX = SPOKE_SCALE;
        child.scaleY = SPOKE_SCALE;
      });
    }

    // Frame 132 (AS frame_133): _parent.removeMovieClip() → complete.
    addFrameAction(132, (clip) => {
      // AS: DefineSprite_10/frame_133/DoAction.as
      // _parent.removeMovieClip();
      clip.remove();
      this.runtime.complete();
    });

    // Flatten accumulated actions into the frameScripts map.
    for (const [frameIdx, actions] of frameActions.entries()) {
      const capturedActions = actions;
      sprite10FrameScripts.set(frameIdx, (clip, ctx) => {
        for (const action of capturedActions) {
          action(clip, ctx);
        }
      });
    }

    this.sprite10Sym = {
      name: "sprite10",
      totalFrames: 133,
      // sprite10 itself has no authored per-frame SVG textures separate
      // from its children — it is a container. Its visual content is
      // entirely from sprite8 children. Use anim1 frames as the root
      // display (the composite main animation exported by the exporter
      // represents the full pre-composed view).
      // Per the guide: for the outermost container that IS the animation,
      // use textures.getFrames("anim1") (from animations[], not lib_).
      frames: textures.getFrames("anim1"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      frameScripts: sprite10FrameScripts,
    };

    // Register all symbols.
    this.registry.register(sprite7Sym);
    this.registry.register(sprite8Sym);
    this.registry.register(alphaControllerSym);
    this.registry.register(this.sprite10Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as
    // SOMA.playSound("grina_703");
    callbacks.playSound("grina_703");

    // Attach the outermost sprite10 container at the root. This is the
    // canonical "main timeline places sprite10 at depth 1" implicit
    // placement. sprite10's frameScripts will attach the 10 spoke
    // instances of sprite8 and the alpha controller as its timeline
    // advances.
    this.root.attach(this.sprite10Sym, "sprite10", 1, context);
  }
}
