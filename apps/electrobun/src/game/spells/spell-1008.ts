/**
 * Spell 1008 — Liche (Licorne / Lichrompeur attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 *
 * Canonical AS layout (`tools/combat-exporter/output/spell-anims/1008/scripts/scripts/`):
 *
 *   The main animation is a single "anim1" with 312 frames. DefineSprite_90 is
 *   the outermost authored sprite (312 frames total) and maps to the anim1
 *   composite in the manifest.
 *
 *   DefineSprite_90 frame scripts:
 *     - frame_49  (index 48): SOMA.playSound("licrounch_1008")
 *     - frame_79  (index 78): SOMA.playSound("licrounch_1008b")
 *     - frame_88  (index 87): SOMA.playSound("licrounch_1008b")
 *     - frame_154 (index 153): SOMA.playSound("licrounch_1008b")
 *     - frame_163 (index 162): SOMA.playSound("licrounch_1008b")
 *     - frame_229 (index 228): SOMA.playSound("licrounch_1008b")
 *     - frame_238 (index 237): SOMA.playSound("licrounch_1008b")
 *     - frame_250 (index 249): SOMA.playSound("licrounch_1008b") + this.end() → signalHit
 *     - frame_310 (index 309): _parent.removeMovieClip() + stop() → complete
 *
 *   DefineSprite_21 (characterId 21, "sprite21") is a library symbol:
 *     - 210 frames of authored content
 *     - directlyDynamic: true — owns a CLIPACTIONRECORD onClipEvent(load)
 *     - CLIPACTIONRECORD onClipEvent(load): gotoAndPlay(40) — must run at runtime
 *     - frame_1/DoAction: pied.gotoAndPlay(186) — pied is a named child of sprite21
 *     - frame_34/DoAction: scale tweaks on nat2/nat3/nat4 and their children
 *     - frame_124/DoAction: scale tweaks on nat6/nat7/nat8 and their children
 *     - frame_208/DoAction: stop()
 *     - Placed inside DefineSprite_90 at frame 0, depth 18, with matrix
 *       scaleX=scaleY≈0.3146, translateX=-0.2, translateY=9.35.
 *
 *   Other inner sprites (DefineSprite_18, _23, _64, _67) carry only stop() calls
 *   at their last frames — these are visual-only authored sprites with no dynamic
 *   per-tick handlers; their stop() semantics are captured by the anim1 composite
 *   stopping at frame_310.
 *
 * displayType=11 (TargetCell): This is a single-cell impact spell anchored at the
 * target. No projectile symbols (move/shoot/duplicate), no caster-side reference
 * in the outer AS. The anim1 composite plays at the target cell.
 *
 * Library symbols:
 *   - sprite21 — 210-frame animated sub-sprite. CLIPACTIONRECORD onLoad seeds
 *     gotoAndPlay(40) so the clip starts from frame 40 rather than frame 1.
 *     frameScripts port pied.gotoAndPlay(186) at frame 0, scale tweaks at
 *     frames 33 and 123, and stop() at frame 207.
 *   - anim1 — 312-frame outer composite. frameScripts drive all sounds,
 *     signalHit at frame 249, and complete() at frame 309.
 *
 * Main timeline: onSpellStart attaches anim1 at root depth 1, then attaches
 * sprite21 as a live child of anim1 at depth 18 (matching the canonical
 * PlaceObject2 placement in DefineSprite_90/frame_0) so its CLIPACTIONRECORD
 * onLoad fires and the clip ticks independently.
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

const SPRITE21_BOUNDS = {
  width: 107.25,
  height: 98.9,
  offsetX: -48.55,
  offsetY: -276.2,
};

const ANIM1_BOUNDS = {
  width: 79.65,
  height: 375.75,
  offsetX: -36.1,
  offsetY: -358.4,
};

export class Spell1008 extends RuntimeSpell {
  readonly spellId = 1008;
  readonly displayType = SpellDisplayType.TargetCell;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite21Anchor = calculateAnchor(SPRITE21_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite21 — dynamic sub-sprite with CLIPACTIONRECORD onLoad ----------
    // Canonical placement: DefineSprite_90/frame_0, depth 18,
    // matrix scaleX=scaleY=0.31463623046875, translateX=-0.2, translateY=9.35.
    // directlyDynamic: true — owns CLIPACTIONRECORD onClipEvent(load) which must
    // run at runtime so the clip starts playback from frame 40, not frame 1.
    const sprite21Sym: SymbolDefinition = {
      name: "sprite21",
      totalFrames: 210,
      frames: textures.getFrames("lib_sprite21"),
      anchorX: sprite21Anchor.x,
      anchorY: sprite21Anchor.y,

      // AS: scripts/DefineSprite_21/frame_1/PlaceObject2_16_20/CLIPACTIONRECORD onClipEvent(load).as
      // onClipEvent(load){ gotoAndPlay(40); }
      onLoad: (clip) => {
        // Canonical: gotoAndPlay(40) → 0-based index 39.
        // This fires once when the clip is instantiated so the sprite21
        // timeline starts from frame 40 rather than looping from frame 1.
        clip.gotoAndPlay(39);
      },

      frameScripts: new Map([
        [
          // AS: scripts/DefineSprite_21/frame_1/DoAction.as
          // pied.gotoAndPlay(186);
          // "pied" is a named child MovieClip inside sprite21. In the runtime
          // pied is not a separately registered live SpellClip (it has no own
          // CLIPACTIONRECORD handlers), so we look it up as a child of clip and
          // command it if present.
          0,
          (clip) => {
            // AS: DefineSprite_21/frame_1/DoAction.as — pied.gotoAndPlay(186)
            const pied = clip.find("pied");
            if (pied) {
              pied.gotoAndPlay(185); // AS 186 → 0-based 185
            }
          },
        ],
        [
          // AS: scripts/DefineSprite_21/frame_34/DoAction.as
          // nat2._xscale = 110; nat2._yscale = 110;
          // nat2.nate.nat._xscale = 70; nat2.nate.nat._yscale = 70;
          // nat3._xscale = 120; nat3._yscale = 120;
          // nat3.nate.nat._xscale = 50; nat3.nate.nat._yscale = 50;
          // nat4._xscale = 130; nat4._yscale = 130;
          // nat4.nate.nat._xscale = 20; nat4.nate.nat._yscale = 20;
          // nat4.nate.nat.gotoAndStop(2);
          33,
          (clip) => {
            // AS: DefineSprite_21/frame_34/DoAction.as
            const nat2 = clip.find("nat2");
            if (nat2) {
              nat2.scaleX = 110 / 100;
              nat2.scaleY = 110 / 100;
              const nat2NateNat = nat2.find("nate/nat");
              if (nat2NateNat) {
                nat2NateNat.scaleX = 70 / 100;
                nat2NateNat.scaleY = 70 / 100;
              }
            }
            const nat3 = clip.find("nat3");
            if (nat3) {
              nat3.scaleX = 120 / 100;
              nat3.scaleY = 120 / 100;
              const nat3NateNat = nat3.find("nate/nat");
              if (nat3NateNat) {
                nat3NateNat.scaleX = 50 / 100;
                nat3NateNat.scaleY = 50 / 100;
              }
            }
            const nat4 = clip.find("nat4");
            if (nat4) {
              nat4.scaleX = 130 / 100;
              nat4.scaleY = 130 / 100;
              const nat4NateNat = nat4.find("nate/nat");
              if (nat4NateNat) {
                nat4NateNat.scaleX = 20 / 100;
                nat4NateNat.scaleY = 20 / 100;
                nat4NateNat.gotoAndStop(1); // AS gotoAndStop(2) → 0-based 1
              }
            }
          },
        ],
        [
          // AS: scripts/DefineSprite_21/frame_124/DoAction.as
          // nat6._xscale = 110; nat6._yscale = 110;
          // nat6.nate.nat._xscale = 70; nat6.nate.nat._yscale = 70;
          // nat7._xscale = 120; nat7._yscale = 120;
          // nat7.nate.nat._xscale = 50; nat7.nate.nat._yscale = 50;
          // nat8._xscale = 130; nat8._yscale = 130;
          // nat8.nate.nat._xscale = 20; nat8.nate.nat._yscale = 20;
          // nat8.nate.nat.gotoAndStop(2);
          123,
          (clip) => {
            // AS: DefineSprite_21/frame_124/DoAction.as
            const nat6 = clip.find("nat6");
            if (nat6) {
              nat6.scaleX = 110 / 100;
              nat6.scaleY = 110 / 100;
              const nat6NateNat = nat6.find("nate/nat");
              if (nat6NateNat) {
                nat6NateNat.scaleX = 70 / 100;
                nat6NateNat.scaleY = 70 / 100;
              }
            }
            const nat7 = clip.find("nat7");
            if (nat7) {
              nat7.scaleX = 120 / 100;
              nat7.scaleY = 120 / 100;
              const nat7NateNat = nat7.find("nate/nat");
              if (nat7NateNat) {
                nat7NateNat.scaleX = 50 / 100;
                nat7NateNat.scaleY = 50 / 100;
              }
            }
            const nat8 = clip.find("nat8");
            if (nat8) {
              nat8.scaleX = 130 / 100;
              nat8.scaleY = 130 / 100;
              const nat8NateNat = nat8.find("nate/nat");
              if (nat8NateNat) {
                nat8NateNat.scaleX = 20 / 100;
                nat8NateNat.scaleY = 20 / 100;
                nat8NateNat.gotoAndStop(1); // AS gotoAndStop(2) → 0-based 1
              }
            }
          },
        ],
        [
          // AS: scripts/DefineSprite_21/frame_208/DoAction.as — stop()
          207,
          (clip) => {
            // AS: DefineSprite_21/frame_208/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- anim1 — 312-frame outer composite (= DefineSprite_90) ---------------
    // Drives all sounds, signalHit at frame 250 ("this.end()"), and spell
    // completion at frame 310 ("_parent.removeMovieClip()").
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 312,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      frameScripts: new Map([
        [
          // AS: scripts/DefineSprite_90/frame_49/DoAction.as
          // SOMA.playSound("licrounch_1008");
          48,
          (_clip) => {
            // AS: DefineSprite_90/frame_49/DoAction.as
            this.soundCallback?.("licrounch_1008");
          },
        ],
        [
          // AS: scripts/DefineSprite_90/frame_79/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          78,
          (_clip) => {
            // AS: DefineSprite_90/frame_79/DoAction.as
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          // AS: scripts/DefineSprite_90/frame_88/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          87,
          (_clip) => {
            // AS: DefineSprite_90/frame_88/DoAction.as
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          // AS: scripts/DefineSprite_90/frame_154/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          153,
          (_clip) => {
            // AS: DefineSprite_90/frame_154/DoAction.as
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          // AS: scripts/DefineSprite_90/frame_163/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          162,
          (_clip) => {
            // AS: DefineSprite_90/frame_163/DoAction.as
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          // AS: scripts/DefineSprite_90/frame_229/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          228,
          (_clip) => {
            // AS: DefineSprite_90/frame_229/DoAction.as
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          // AS: scripts/DefineSprite_90/frame_238/DoAction.as
          // SOMA.playSound("licrounch_1008b");
          237,
          (_clip) => {
            // AS: DefineSprite_90/frame_238/DoAction.as
            this.soundCallback?.("licrounch_1008b");
          },
        ],
        [
          // AS: scripts/DefineSprite_90/frame_250/DoAction.as  — SOMA.playSound("licrounch_1008b")
          // AS: scripts/DefineSprite_90/frame_250/DoAction_2.as — this.end() → signalHit
          249,
          (_clip) => {
            // AS: DefineSprite_90/frame_250/DoAction.as + DoAction_2.as
            this.soundCallback?.("licrounch_1008b");
            this.runtime.signalHit();
          },
        ],
        [
          // AS: scripts/DefineSprite_90/frame_310/DoAction.as
          // _parent.removeMovieClip(); stop();
          309,
          (clip) => {
            // AS: DefineSprite_90/frame_310/DoAction.as
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite21Sym);
    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture the sound callback so frameScripts can call it.
    this.soundCallback = callbacks.playSound;

    // Attach anim1 at root depth 1 — this is the main DefineSprite_90 composite.
    // It starts playing immediately from frame 0 (its frameScripts handle all
    // sounds, signalHit, and completion).
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }

    // Attach sprite21 as a live child of the anim1 clip, mirroring the canonical
    // PlaceObject2 in DefineSprite_90/frame_0 at depth 18.
    // Matrix: scaleX=scaleY=0.31463623046875, translateX=-0.2, translateY=9.35.
    // The CLIPACTIONRECORD onLoad (gotoAndPlay(40)) fires via the SymbolDefinition's
    // onLoad handler when attach() is called here — this is the runtime mechanism
    // that makes the dynamic handler execute.
    const anim1Clip = this.root.children.get("anim1");
    const sprite21Sym = this.registry.resolve("sprite21");
    if (anim1Clip && sprite21Sym) {
      const inst = anim1Clip.attach(sprite21Sym, "sprite21_inst", 18, context, {
        x: -0.2,
        y: 9.35,
      });
      // Apply placement matrix scale (translateX/Y already applied via transform above).
      inst.scaleX = 0.31463623046875;
      inst.scaleY = 0.31463623046875;
    }
  }
}
