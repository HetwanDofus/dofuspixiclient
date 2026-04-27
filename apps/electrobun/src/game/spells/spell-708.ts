/**
 * Spell 708 — Grina (Sram poison/trap spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/708/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile, no caster reference,
 * and no `move`/`shoot`/`duplicate` symbols. It is a single impact animation
 * anchored at the target cell. The manifest has no `librarySymbols[]` array —
 * all content is driven by a single `animations: ["anim1"]` entry (105 frames),
 * which is the main authored timeline.
 *
 * However, the scripts reference several DefineSprite symbols:
 *   - DefineSprite_22 (105-frame outer container, = "anim1"): frame_103 removes
 *     its parent (_parent.removeMovieClip()), triggering spell completion.
 *   - DefineSprite_13 (looping sub-animation, staggered start): frame_1 jumps
 *     to a random frame in [2..32]; frame_52 loops back to frame 2.
 *   - DefineSprite_21 (3 placed children of type DefineSprite_20, staggered):
 *     each child onLoad does gotoAndPlay(random(_totalframes + 1)) — they start
 *     at a random frame of their own timeline.
 *   - DefineSprite_20 (rotating element): frame_1 sets _rotation = -random(180).
 *   - DefineSprite_15 (continuously rotating child): its placed child (PlaceObject2_14_1)
 *     has onClipEvent(enterFrame) that does _rotation += 1.6 degrees per frame.
 *
 * Since the manifest has no librarySymbols[], the texture key for the main
 * animation is bare "anim1" (no lib_ prefix). The sub-sprites referenced in
 * DefineSprite_* scripts are embedded inside the composite anim1 frames and
 * do not have separate texture atlases — they are scripted placeholders.
 *
 * The main "anim1" symbol IS DefineSprite_22 (the outer container, 105 frames).
 * frame_103 (0-based: 102) of that symbol does _parent.removeMovieClip(), which
 * in our runtime means the root's child "anim1" removes itself and we call
 * this.runtime.complete().
 *
 * signalHit: fired at the impact moment. The animation is an impact at target —
 * there is no explicit "hit" frame labelled in the AS, so we fire signalHit at
 * frame_1 (the first frame the animation plays, i.e. at attach/start), which is
 * the canonical convention for instant-impact spells with no projectile.
 *
 * Main timeline: SOMA.playSound("grina_701") — ported in onSpellStart.
 *
 * Library symbols (all container-only, no separate texture atlases):
 *   - "anim1"       — 105-frame outer shell. frame_103 removes parent + completes.
 *                     This is the main animation clip attached at root.
 *   - "sprite_13"   — Looping sub-anim (52 frames). frame_1 staggered start;
 *                     frame_52 loops to frame_2.
 *   - "sprite_21"   — Container with 3 placed children of type sprite_20.
 *                     Each child onLoad: gotoAndPlay(random(_totalframes + 1)).
 *   - "sprite_20"   — Rotating element: frame_1 sets rotation = -random(180) deg.
 *   - "sprite_15"   — Container whose placed child onEnterFrame rotates +1.6 deg/frame.
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

const ANIM1_BOUNDS = {
  width: 138.75,
  height: 68.1,
  offsetX: -64.35,
  offsetY: -34.05,
};

export class Spell708 extends RuntimeSpell {
  readonly spellId = 708;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite_20 — rotating element ---------------------------
    // AS: DefineSprite_20/frame_1/DoAction.as
    //   _rotation = -random(180);
    const sprite20Sym: SymbolDefinition = {
      name: "sprite_20",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_20/frame_1/DoAction.as: _rotation = -random(180)
            const deg = -Math.floor(Math.random() * 180);
            clip.rotation = (deg * Math.PI) / 180;
          },
        ],
      ]),
    };

    // ---- sprite_15 — continuously rotating container -------------
    // AS: DefineSprite_15/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + 1.6;
    // The placed child (PlaceObject2_14_1) has this enterFrame handler.
    // We model it as a child symbol attached inside sprite_15's frame_1,
    // with the enterFrame directly on that child.
    const sprite15ChildSym: SymbolDefinition = {
      name: "sprite_15_child",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS DefineSprite_15/frame_1/PlaceObject2_14_1/onClipEvent(enterFrame):
        //   _rotation = _rotation + 1.6
        clip.rotation += (1.6 * Math.PI) / 180;
      },
    };

    const sprite15Sym: SymbolDefinition = {
      name: "sprite_15",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_15/frame_1: places PlaceObject2_14_1 with onClipEvent(enterFrame)
            clip.attach(sprite15ChildSym, "child14_1", 1, ctx);
          },
        ],
      ]),
    };

    // ---- sprite_21 — container with 3 placed sprite_20 children --
    // AS: DefineSprite_21/frame_1/PlaceObject2_20_3,7,11/onClipEvent(load):
    //   gotoAndPlay(random(_totalframes + 1));
    // Each of the 3 placed children is a sprite_20 instance. Their onLoad
    // jumps to a random frame. Since sprite_20 has totalFrames=1, random of
    // (1+1)=2 means frame 0 or 1 (both map to frame 0 in a 1-frame clip).
    // We model this by having sprite_21's frame_1 attach 3 sprite_20 instances,
    // and give each its own staggered-start onLoad.
    const sprite21ChildSym: SymbolDefinition = {
      name: "sprite_21_child",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_21/frame_1/PlaceObject2_20_X/onClipEvent(load):
        //   gotoAndPlay(random(_totalframes + 1))
        // _totalframes for sprite_20 is 1, so random(1+1) = random(2) ∈ {0,1}
        // Both values map to frame 0 (1-based frame 1) in a 1-frame symbol.
        // We call gotoAndPlay(0) regardless, preserving the stagger intent.
        const randomFrame = Math.floor(Math.random() * (clip.totalFrames + 1));
        const targetFrame = Math.max(0, randomFrame - 1);
        clip.gotoAndPlay(targetFrame);
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_20/frame_1/DoAction.as: _rotation = -random(180)
            const deg = -Math.floor(Math.random() * 180);
            clip.rotation = (deg * Math.PI) / 180;
          },
        ],
      ]),
    };

    const sprite21Sym: SymbolDefinition = {
      name: "sprite_21",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_21/frame_1: places 3 children (depths 3, 7, 11)
            clip.attach(sprite21ChildSym, "child_3", 3, ctx);
            clip.attach(sprite21ChildSym, "child_7", 7, ctx);
            clip.attach(sprite21ChildSym, "child_11", 11, ctx);
          },
        ],
      ]),
    };

    // ---- sprite_13 — looping sub-animation (52 frames) -----------
    // AS: DefineSprite_13/frame_1/DoAction.as:
    //   gotoAndPlay(random(31) + 2)  → random start in [2..32] (1-based) = [1..31] (0-based)
    // AS: DefineSprite_13/frame_52/DoAction.as:
    //   gotoAndPlay(2)  → 0-based frame 1
    const sprite13Sym: SymbolDefinition = {
      name: "sprite_13",
      totalFrames: 52,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_13/frame_1/DoAction.as: gotoAndPlay(random(31) + 2)
            // AS gotoAndPlay(N) → clip.gotoAndPlay(N - 1)
            // random(31) ∈ [0..30], so target = [2..32] (1-based) = [1..31] (0-based)
            const target = Math.floor(Math.random() * 31) + 1;
            clip.gotoAndPlay(target);
          },
        ],
        [
          51,
          (clip) => {
            // AS DefineSprite_13/frame_52/DoAction.as: gotoAndPlay(2) → frame index 1
            clip.gotoAndPlay(1);
          },
        ],
      ]),
    };

    // ---- anim1 — 105-frame outer container (= DefineSprite_22) ---
    // The main animation. Uses actual texture frames from "anim1".
    // frame_103 (0-based: 102) → _parent.removeMovieClip() → complete().
    // We also attach sprite_13, sprite_15, sprite_21 as sub-children here
    // to mirror the authored composite structure, even though their visual
    // content is baked into the composite anim1 frames.
    //
    // signalHit is fired at frame 0 (instant impact, no projectile).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 105,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach sub-sprites that are part of the composite authored timeline.
            // These mirror the DefineSprite children embedded in anim1/DefineSprite_22.
            clip.attach(sprite13Sym, "sprite13", 1, ctx);
            clip.attach(sprite15Sym, "sprite15", 2, ctx);
            clip.attach(sprite21Sym, "sprite21", 3, ctx);
            // Signal hit immediately (instant impact spell, no projectile).
            this.runtime.signalHit();
          },
        ],
        [
          102,
          (clip) => {
            // AS DefineSprite_22/frame_103/DoAction.as: _parent.removeMovieClip()
            // clip's parent is root; removing root's child and completing the spell.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite20Sym);
    this.registry.register(sprite15ChildSym);
    this.registry.register(sprite15Sym);
    this.registry.register(sprite21ChildSym);
    this.registry.register(sprite21Sym);
    this.registry.register(sprite13Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("grina_701");
    callbacks.playSound("grina_701");
    // Attach the main animation clip at the root.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
