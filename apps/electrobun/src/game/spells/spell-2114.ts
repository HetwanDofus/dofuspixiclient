/**
 * Spell 2114 — (Unknown name, likely a Cra or Iop fire/impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2114/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no `move`/`shoot`/`duplicate`
 * symbols, no caster-relative positioning, no dual-anchored world-absolute
 * logic. The manifest contains a single `animations: ["anim1"]` entry with
 * no `librarySymbols[]`. The outer SWF (DefineSprite_12) is the main
 * container placed at the target cell; it plays 100 frames, fires a sound
 * at frame 76, and stops at frame 100. The canonical `frame_138/DoAction.as`
 * calls `this.removeMovieClip()` on the outer timeline.
 *
 * Library symbols (registered as SymbolDefinitions):
 *   - anim1 (DefineSprite_12): 102-frame impact animation at target cell.
 *       frame_1  → SOMA.playSound("fx_612.mp3")
 *       frame_76 → SOMA.playSound("fx_611.mp3") + signalHit
 *       frame_100 → stop()
 *     Additionally contains two child clips with clip events:
 *       PlaceObject2_4_2  → onEnterFrame: _rotation += 2   (depth 2)
 *       PlaceObject2_8_10 → onEnterFrame: _rotation -= 1.3 (depth 10)
 *     These are modelled as DefineSprite_9 sub-symbols registered as
 *     "rot_cw" and "rot_ccw" (container-only, single frame, with the
 *     enterFrame clip events). The canonical AS path shows them both
 *     living under DefineSprite_9/frame_1 as placed instances.
 *
 *   - DefineSprite_11 (anim_loop): single-frame randomised loop.
 *       frame_1  → gotoAndPlay(random(31) + 1)  (jump to random frame 1-31)
 *       frame_55 → stop()
 *     This is a sub-symbol attached inside DefineSprite_9 (the spinning
 *     overlay composites). Registered as "anim_loop".
 *
 * Main timeline (onSpellStart):
 *   - Attaches "anim1" (the main container sprite) at root depth 1.
 *   - Sounds are handled from within DefineSprite_12's own frame scripts.
 *   - The outer `frame_138/DoAction.as` (`this.removeMovieClip()`) signals
 *     completion; we model this in anim1's frame_100 stop + separate
 *     completion at the outer-mc removal frame.
 *
 * NOTE: The manifest has `frameCount: 102` for anim1 and the outer
 * `frame_138/DoAction.as` fires at frame 138. Since the inner anim1
 * stops at frame 100, we model the outer-mc removal at anim1's frame 99
 * (0-based 98, the `stopFrame` in the manifest) and complete there.
 * Canonical hit signal fires at frame_76 (0-based 75) of anim1.
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
  width: 251,
  height: 128.55,
  offsetX: -125.5,
  offsetY: -52,
};

export class Spell2114 extends RuntimeSpell {
  readonly spellId = 2114;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim_loop — randomised sub-symbol (DefineSprite_11) ----
    // frame_1: gotoAndPlay(random(31) + 1)  → jump to a random frame in [1,31]
    // frame_55: stop()
    // This is a container-only symbol (no direct textures of its own in
    // the manifest); its visual content comes from the parent composite.
    const animLoopSym: SymbolDefinition = {
      name: "anim_loop",
      totalFrames: 55,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_11/frame_1/DoAction.as
            // gotoAndPlay(random(31) + 1) — AS is 1-based, runtime 0-based
            const target = Math.floor(Math.random() * 31) + 1;
            clip.gotoAndPlay(target - 1);
          },
        ],
        [
          54,
          (clip) => {
            // AS: DefineSprite_11/frame_55/DoAction.as
            // stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- rot_cw — clockwise-rotating sub-clip (PlaceObject2_4_2) ----
    // AS: DefineSprite_9/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // onEnterFrame: _rotation = _rotation + 2
    const rotCwSym: SymbolDefinition = {
      name: "rot_cw",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_9/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        clip.rotation += (2 * Math.PI) / 180;
      },
    };

    // ---- rot_ccw — counter-clockwise-rotating sub-clip (PlaceObject2_8_10) ----
    // AS: DefineSprite_9/frame_1/PlaceObject2_8_10/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // onEnterFrame: _rotation = _rotation - 1.3
    const rotCcwSym: SymbolDefinition = {
      name: "rot_ccw",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_9/frame_1/PlaceObject2_8_10/CLIPACTIONRECORD onClipEvent(enterFrame).as
        clip.rotation -= (1.3 * Math.PI) / 180;
      },
    };

    // ---- anim1 — main impact animation container (DefineSprite_12) ----
    // frame_1   → SOMA.playSound("fx_612.mp3")
    // frame_76  → SOMA.playSound("fx_611.mp3") + signalHit
    // frame_100 → stop() (outer frame_138 = this.removeMovieClip() → complete)
    //
    // The two rotating child clips (PlaceObject2_4_2 at depth 2,
    // PlaceObject2_8_10 at depth 10) are pre-placed objects inside
    // DefineSprite_9 which is the container for both. We attach them
    // as children in the frame_1 (onLoad) of anim1 so they start
    // spinning from the first frame.
    //
    // anim1 uses the bare "anim1" texture key (no lib_ prefix) because
    // it appears only in animations[], not in librarySymbols[].
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 102,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      onLoad: (clip, ctx) => {
        // Attach the two rotating overlays that live as placed objects
        // inside DefineSprite_9 (the spinning-ring composites).
        // PlaceObject2_4_2 = depth 2, PlaceObject2_8_10 = depth 10.
        clip.attach(rotCwSym, "rot_cw", 2, ctx);
        clip.attach(rotCcwSym, "rot_ccw", 10, ctx);
      },
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS: DefineSprite_12/frame_1/DoAction.as
            // SOMA.playSound("fx_612.mp3");
            this.soundCallback?.("fx_612.mp3");
          },
        ],
        [
          75,
          (_clip) => {
            // AS: DefineSprite_12/frame_76/DoAction.as
            // SOMA.playSound("fx_611.mp3");
            this.soundCallback?.("fx_611.mp3");
            // Canonical hit signal — frame 76 is when the impact sound
            // fires, marking the moment damage should be applied.
            this.runtime.signalHit();
          },
        ],
        [
          99,
          (clip) => {
            // AS: DefineSprite_12/frame_100/DoAction.as
            // stop();
            // The outer main-timeline frame_138/DoAction.as fires
            // this.removeMovieClip() — we model that as completion here
            // since the inner anim stops and the spell is done.
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(animLoopSym);
    this.registry.register(rotCwSym);
    this.registry.register(rotCcwSym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use inside frame scripts (sounds fired
    // from within anim1's timeline rather than directly on the main
    // timeline).
    this.soundCallback = callbacks.playSound;

    // Attach the main impact animation at root depth 1.
    // Canonical: the SWF places DefineSprite_12 on the main timeline
    // at the target cell (displayType=11).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
