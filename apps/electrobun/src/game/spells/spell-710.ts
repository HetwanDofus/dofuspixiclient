/**
 * Spell 710 — Grinaspic (Sadida thorn-wheel impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/710/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile, no caster-reference,
 * no dual-anchor — everything renders at the target cell. sprite_23 and sprite_24
 * are both positioned via `_parent.cellFrom/cellTo` style only for sprite_24
 * (which sets `_X = _parent.cellFrom.x` — i.e. it anchors to cellFrom), while
 * sprite_23 is the main impact at the target. However, looking more carefully:
 * sprite_24/frame_1 sets `_X = _parent.cellFrom.x; _Y = _parent.cellFrom.y` which
 * means it reads world coords from the outer mc. This is the WorldAbsolute pattern.
 * sprite_23/frame_1 plays a sound (no explicit positioning) and has authored frame
 * content, so it sits at the container origin = the anchor resolved by the harness.
 * But since sprite_24 explicitly reads `_parent.cellFrom`, we need WorldAbsolute so
 * root.vars.cellFrom is populated. displayType=50 (WorldAbsolute).
 *
 * Canonical AS layout:
 *   - main timeline frame_2: stop() — main entry just stops.
 *   - sprite_23 (225 frames, target-side impact + spinning wheel):
 *       frame_1/DoAction.as: SOMA.playSound("grina_709b")
 *       frame_1 also places three sprite_6 children (PlaceObject2_6_5,
 *         PlaceObject2_6_9, PlaceObject2_6_13) each with onClipEvent(load):
 *         gotoAndPlay(random(_totalframes + 1)) — random phase offsets.
 *       frame_49/DoAction.as: SOMA.playSound("grina_709")
 *       frame_58/DoAction.as: this.end() → signalHit
 *       frame_64/DoAction.as: SOMA.playSound("grina_710")
 *       (no explicit removal — the outer sprite_24 removes the parent at frame_163)
 *
 *   - sprite_24 (165 frames, caster-side ornament):
 *       frame_1/DoAction.as: _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y
 *       frame_163/DoAction.as: _parent.removeMovieClip() → spell complete
 *
 *   - DefineSprite_6 (sprite_6, 15-frame spinning blade):
 *       frame_1/DoAction.as: _rotation = -random(180) — randomise start rotation
 *       DefineSprite_17 is a child of sprite_6 that drives rotation:
 *         onClipEvent(load): v = 1728
 *         onClipEvent(enterFrame): _rotation = _rotation + (v *= 0.849)
 *       sprite_6 is attached three times inside sprite_23 at depth 5, 9, 13
 *       with random phase gotoAndPlay on load.
 *
 * Library symbols:
 *   - sprite_6   — 15-frame spinning blade. frame_1 randomises rotation.
 *                  Contains DefineSprite_17 as a placed child (the rotation driver).
 *                  Since DefineSprite_17's clip events are on a PLACED child inside
 *                  sprite_6, we model them as sprite_6's onEnterFrame on the
 *                  child — but since we cannot nest SymbolDefinitions, we drive
 *                  the spinning via sprite_6's own onEnterFrame seeded in onLoad.
 *   - sprite_23  — 225-frame target impact. Placed by onSpellStart.
 *   - sprite_24  — 165-frame caster ornament. Placed by onSpellStart.
 *
 * Sounds are fired from sprite_23 frameScripts at frames 1, 49, 64 (0-based: 0, 48, 63).
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

const SPRITE6_BOUNDS = {
  width: 56.65,
  height: 2.8,
  offsetX: 18,
  offsetY: -2.75,
};

const SPRITE23_BOUNDS = {
  width: 249.35,
  height: 274.8,
  offsetX: -124.7,
  offsetY: -208.8,
};

const SPRITE24_BOUNDS = {
  width: 249.35,
  height: 274.8,
  offsetX: -124.7,
  offsetY: -208.8,
};

export class Spell710 extends RuntimeSpell {
  readonly spellId = 710;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite23Sym!: SymbolDefinition;
  private sprite24Sym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);
    const sprite23Anchor = calculateAnchor(SPRITE23_BOUNDS);
    const sprite24Anchor = calculateAnchor(SPRITE24_BOUNDS);

    // ---- sprite_6 — spinning blade, placed 3× inside sprite_23 ----
    // AS DefineSprite_6/frame_1/DoAction.as:
    //   _rotation = -random(180)
    // AS DefineSprite_17/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   v = 1728
    // AS DefineSprite_17/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _rotation = _rotation + (v *= 0.849)
    // Since DefineSprite_17 is a placed child inside sprite_6 that drives
    // the overall rotation of the sprite_6 clip, we model the combined
    // behaviour: onLoad seeds the initial random rotation + v variable,
    // onEnterFrame applies the spinning decay (v *= 0.849 per frame).
    const sprite6Sym: SymbolDefinition = {
      name: "sprite_6",
      totalFrames: 15,
      frames: textures.getFrames("sprite_6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6/frame_1/DoAction.as: _rotation = -random(180)
        clip.rotation = (-(Math.floor(Math.random() * 180)) * Math.PI) / 180;
        // AS DefineSprite_17/.../onClipEvent(load): v = 1728
        clip.vars.v = 1728;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_17/.../onClipEvent(enterFrame): _rotation = _rotation + (v *= 0.849)
        let v = clip.vars.v as number;
        v *= 0.849;
        clip.vars.v = v;
        clip.rotation += (v * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6/frame_1/DoAction.as: _rotation = -random(180)
            // (Already applied in onLoad; this is the frame script that also fires.
            // In AS, frame_1 DoAction runs after onLoad, so it overwrites.
            // We re-apply here to match canonical order: onLoad runs, then frame_1.)
            clip.rotation = (-(Math.floor(Math.random() * 180)) * Math.PI) / 180;
          },
        ],
      ]),
    };

    // ---- sprite_23 — 225-frame target impact ----------------------
    // AS DefineSprite_23/frame_1/DoAction.as: SOMA.playSound("grina_709b")
    // AS DefineSprite_23/frame_1/PlaceObject2_6_5/onClipEvent(load): gotoAndPlay(random(_totalframes+1))
    // AS DefineSprite_23/frame_1/PlaceObject2_6_9/onClipEvent(load): gotoAndPlay(random(_totalframes+1))
    // AS DefineSprite_23/frame_1/PlaceObject2_6_13/onClipEvent(load): gotoAndPlay(random(_totalframes+1))
    // AS DefineSprite_23/frame_49/DoAction.as: SOMA.playSound("grina_709")
    // AS DefineSprite_23/frame_58/DoAction.as: this.end() → signalHit
    // AS DefineSprite_23/frame_64/DoAction.as: SOMA.playSound("grina_710")
    this.sprite23Sym = {
      name: "sprite_23",
      totalFrames: 225,
      frames: textures.getFrames("sprite_23"),
      anchorX: sprite23Anchor.x,
      anchorY: sprite23Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_23/frame_1/DoAction.as: SOMA.playSound("grina_709b")
            // Sound is played via the callback captured in onSpellStart.
            this.soundCallback?.("grina_709b");

            // AS DefineSprite_23/frame_1/PlaceObject2_6_5, _6_9, _6_13 onClipEvent(load):
            //   gotoAndPlay(random(_totalframes + 1))
            // Three sprite_6 blades placed on the timeline at depths 5, 9, 13.
            // Their onLoad fires gotoAndPlay(random(totalFrames+1)) for phase randomisation.
            // We attach them here then manually trigger the random phase seek,
            // since onLoad already does the random gotoAndPlay for us.
            clip.attach(sprite6Sym, "blade5", 5, ctx);
            clip.attach(sprite6Sym, "blade9", 9, ctx);
            clip.attach(sprite6Sym, "blade13", 13, ctx);

            // Apply random phase to each blade after attachment.
            // AS onClipEvent(load) for each: gotoAndPlay(random(_totalframes + 1))
            // The onLoad callback already set rotation but didn't do gotoAndPlay.
            // We call gotoAndPlay here on each blade for the phase randomisation.
            const blade5 = clip.children.get("blade5");
            if (blade5) {
              const phase = Math.floor(Math.random() * (sprite6Sym.totalFrames + 1));
              blade5.gotoAndPlay(Math.min(phase, sprite6Sym.totalFrames - 1));
            }
            const blade9 = clip.children.get("blade9");
            if (blade9) {
              const phase = Math.floor(Math.random() * (sprite6Sym.totalFrames + 1));
              blade9.gotoAndPlay(Math.min(phase, sprite6Sym.totalFrames - 1));
            }
            const blade13 = clip.children.get("blade13");
            if (blade13) {
              const phase = Math.floor(Math.random() * (sprite6Sym.totalFrames + 1));
              blade13.gotoAndPlay(Math.min(phase, sprite6Sym.totalFrames - 1));
            }
          },
        ],
        [
          48,
          () => {
            // AS DefineSprite_23/frame_49/DoAction.as: SOMA.playSound("grina_709")
            this.soundCallback?.("grina_709");
          },
        ],
        [
          57,
          () => {
            // AS DefineSprite_23/frame_58/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          63,
          () => {
            // AS DefineSprite_23/frame_64/DoAction.as: SOMA.playSound("grina_710")
            this.soundCallback?.("grina_710");
          },
        ],
      ]),
    };

    // ---- sprite_24 — 165-frame caster-side ornament ---------------
    // AS DefineSprite_24/frame_1/DoAction.as:
    //   _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y
    // AS DefineSprite_24/frame_163/DoAction.as:
    //   _parent.removeMovieClip() → spell complete
    this.sprite24Sym = {
      name: "sprite_24",
      totalFrames: 165,
      frames: textures.getFrames("sprite_24"),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_24/frame_1/DoAction.as:
            //   _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y;
            }
          },
        ],
        [
          162,
          (clip) => {
            // AS DefineSprite_24/frame_163/DoAction.as:
            //   _parent.removeMovieClip() → outermost mc removal → complete
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite6Sym);
    this.registry.register(this.sprite23Sym);
    this.registry.register(this.sprite24Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture the sound callback so frameScripts inside symbols can use it.
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_2/DoAction.as: stop() — the outer timeline stops.
    // Attach the two authored sprites to the root so they start ticking.
    // sprite_23 is the target-side impact; sprite_24 is the caster-side ornament.
    this.root.attach(this.sprite23Sym, "sprite23", 1, context);
    this.root.attach(this.sprite24Sym, "sprite24", 2, context);
  }
}
