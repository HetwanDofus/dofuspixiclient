/**
 * Spell 1101 — (Unknown name, likely a Feca/caster shield or aura effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1101/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile motion, no caster
 * reference, no `move`/`shoot`/`duplicate` symbols, and no `_parent.cellFrom`
 * usage. It is a pure impact-at-target animation with two authored timelines
 * placed on the main timeline (sprite_2 and sprite_4). Both are rendered in
 * animations[] (not librarySymbols[]) so they are bare-name textures with no
 * `lib_` prefix. The container is anchored at the target cell.
 *
 * Main timeline layout (486 frames for sprite_2, 144 frames for sprite_4):
 *   frame_1/DoAction.as:   SOMA.playSound("autre_1101")
 *   frame_137/DoAction.as: this.end()  → signalHit
 *   frame_159/DoAction.as: this.removeMovieClip() → complete
 *
 * Library symbols: none (librarySymbols[] is absent/empty in manifest).
 *
 * sprite_2 is the long 486-frame looping aura (DefineSprite_2 in the SWF),
 * placed on the main timeline at depth 1.
 *
 * sprite_4 is a 144-frame animated element (DefineSprite_4) placed at depth 2.
 * Its authored frame scripts:
 *   DefineSprite_4/frame_1/DoAction.as:   gotoAndPlay(random(60))
 *   DefineSprite_4/frame_142/DoAction.as: gotoAndPlay(6)
 *
 * The main timeline drives the spell lifetime. At frame 137 the hit is
 * signalled; at frame 159 the spell removes itself and signals completion.
 * sprite_2 continues playing its own long timeline independently — it is
 * owned by the main timeline container and gets destroyed when it does.
 *
 * Because the two sprites are placed as direct children of the main timeline
 * (root), we register them as SymbolDefinitions and attach them from
 * onSpellStart, matching the canonical implicit PlaceObject2 behaviour on
 * the SWF main timeline frame_1. The root clip itself carries the frame-137
 * and frame-159 scripts via a "main-timeline" symbol registered on the root.
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

// Bounds from manifest animations[] entries (no librarySymbols[] present).
const SPRITE_2_BOUNDS = {
  width: 149.8,
  height: 149.85,
  offsetX: -84.2,
  offsetY: -78.15,
};

const SPRITE_4_BOUNDS = {
  width: 127.05,
  height: 506.7,
  offsetX: -108.95,
  offsetY: -493.5,
};

export class Spell1101 extends RuntimeSpell {
  readonly spellId = 1101;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite2Sym!: SymbolDefinition;
  private sprite4Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite2Anchor = calculateAnchor(SPRITE_2_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE_4_BOUNDS);

    // ---- sprite_2 — long 486-frame looping aura -----------------
    // Placed on the main timeline at depth 1 (implicit PlaceObject2 on frame_1).
    // No authored frame scripts inside DefineSprite_2 in the manifest scripts[].
    // Plays through all 486 frames and loops — the main timeline lifetime
    // (159 frames) is shorter, so sprite_2 is killed when the root is removed.
    this.sprite2Sym = {
      name: "sprite_2",
      totalFrames: 486,
      frames: textures.getFrames("sprite_2"),
      anchorX: sprite2Anchor.x,
      anchorY: sprite2Anchor.y,
    };

    // ---- sprite_4 — 144-frame animated element ------------------
    // Placed on the main timeline at depth 2.
    // AS DefineSprite_4/frame_1/DoAction.as:
    //   gotoAndPlay(random(60));
    //     → randomise start phase so multiple instances stagger.
    // AS DefineSprite_4/frame_142/DoAction.as:
    //   gotoAndPlay(6);
    //     → loop back to frame 6 (skipping the phase-randomising frame_1)
    //       after reaching the near-end of the authored timeline.
    this.sprite4Sym = {
      name: "sprite_4",
      totalFrames: 144,
      frames: textures.getFrames("sprite_4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_4/frame_1/DoAction.as: gotoAndPlay(random(60))
            // Randomise start frame so concurrent instances are staggered.
            clip.gotoAndPlay(Math.floor(Math.random() * 60));
          },
        ],
        [
          141,
          (clip) => {
            // AS DefineSprite_4/frame_142/DoAction.as: gotoAndPlay(6)
            // Loop back to frame 6 (0-based: 5) after the near-end frame.
            clip.gotoAndPlay(5);
          },
        ],
      ]),
    };

    // ---- root / main-timeline symbol ----------------------------
    // The SWF main timeline carries frame scripts at frame_137 and frame_159.
    // We model it as a "root timeline" symbol registered here; the root clip
    // itself is given these frame scripts by attaching a synthetic container
    // whose lifetime equals the main-timeline length (159 frames).
    // We use a dedicated SymbolDefinition attached to root so that the
    // frame scripts fire at the correct main-timeline frames.
    const mainTimelineSym: SymbolDefinition = {
      name: "main_timeline",
      totalFrames: 159,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          136,
          () => {
            // AS scripts/frame_137/DoAction.as: this.end()
            // Signals that the spell has hit the target (damage popup).
            this.runtime.signalHit();
          },
        ],
        [
          158,
          (clip) => {
            // AS scripts/frame_159/DoAction.as: this.removeMovieClip()
            // The outer mc removes itself — spell animation is complete.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite2Sym);
    this.registry.register(this.sprite4Sym);
    this.registry.register(mainTimelineSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("autre_1101")
    callbacks.playSound("autre_1101");

    // Implicit main-timeline PlaceObject2 frame_1 placements.
    // Attach sprite_2 (depth 1) and sprite_4 (depth 2) at the root.
    this.root.attach(this.sprite2Sym, "sprite2", 1, context);
    this.root.attach(this.sprite4Sym, "sprite4", 2, context);

    // Attach the main-timeline driver at depth 3. It carries no visual
    // content (frames: []) but drives the frame_137 (signalHit) and
    // frame_159 (complete) scripts.
    const mainTimelineSym = this.registry.resolve("main_timeline");
    if (mainTimelineSym) {
      this.root.attach(mainTimelineSym, "main_timeline", 3, context);
    }
  }
}
