/**
 * Spell 2064 — Wabbit Bomb (Sadida-style explosive).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2064/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Two parallel authored timelines placed at
 * world coordinates derived from _parent.cellFrom / _parent.cellTo:
 *
 *   - sprite_15 (120 frames, composite): the lightning/beam effect drawn
 *     from caster to target. frame_1 positions itself at cellFrom, rotates
 *     to angle, computes length. Contains sprite_13 (PlaceObject2_13_1)
 *     whose onClipEvent(load) sets _width = _parent.longueur - 10.
 *     frame_4 plays "licrounch_1008b". No explicit removal — it runs to its
 *     natural end.
 *
 *   - sprite_28 (51 frames, composite): the explosion at the target cell.
 *     frame_1 positions itself at cellTo.x / cellTo.y - 40, copies rotation
 *     from clip1 (= sprite_15 instance). frame_10 plays "vol" and signals
 *     hit. frame_49 stops and removes the outer mc → spell complete.
 *
 *   - sprite_13 (42 frames): the beam/bolt child inside sprite_15. Its
 *     onClipEvent(load) sets its width to (_parent.longueur - 10).
 *
 * Main timeline (frame_2/DoAction.as): stop(). Container stays at (0,0)
 * as expected for WorldAbsolute.
 *
 * Sounds:
 *   - "wab_explo"       → DefineSprite_15/frame_1 (played when sprite_15 starts)
 *   - "licrounch_1008b" → DefineSprite_15/frame_4
 *   - "vol"             → DefineSprite_28/frame_10
 *
 * Library symbols:
 *   - sprite_13 (child of sprite_15): beam strip. onLoad sets scaleX to
 *     (_parent.longueur - 10) / naturalWidth so the sprite stretches to
 *     cover the caster→target distance.
 *   - sprite_15: main beam from caster to target. Positions itself in
 *     frame_1, attaches sprite_13 child (PlaceObject2_13_1). frame_4 sound.
 *   - sprite_28: explosion at target. Positions itself in frame_1. frame_10
 *     sound + signalHit. frame_49 removal + complete.
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

// Bounds from manifest animations[] (no librarySymbols[] present — bare names).
const SPRITE_13_BOUNDS = {
  width: 224.05,
  height: 49.75,
  offsetX: 0,
  offsetY: -27.1,
};

const SPRITE_15_BOUNDS = {
  width: 223.15,
  height: 49.55,
  offsetX: -0.4,
  offsetY: -26.7,
};

const SPRITE_28_BOUNDS = {
  width: 172,
  height: 147.3,
  offsetX: -99.55,
  offsetY: -59.4,
};

export class Spell2064 extends RuntimeSpell {
  readonly spellId = 2064;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite13Sym!: SymbolDefinition;
  private sprite15Sym!: SymbolDefinition;
  private sprite28Sym!: SymbolDefinition;

  // Capture sound callback for use inside frameScripts.
  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite13Anchor = calculateAnchor(SPRITE_13_BOUNDS);
    const sprite15Anchor = calculateAnchor(SPRITE_15_BOUNDS);
    const sprite28Anchor = calculateAnchor(SPRITE_28_BOUNDS);

    // ---- sprite_13 — beam strip, child of sprite_15 ----------------
    // Placed by sprite_15 via PlaceObject2_13_1 at frame_1.
    // AS DefineSprite_15/frame_1/PlaceObject2_13_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   _width = _parent.longueur - 10;
    // "longueur" is stored on the parent sprite_15 clip at frame_1.
    // In Pixi we reproduce _width by adjusting scaleX:
    //   naturalWidth (manifest) = 224.05
    //   targetWidth = longueur - 10
    //   scaleX = targetWidth / naturalWidth
    // AS DefineSprite_13/frame_40/DoAction.as: stop()
    this.sprite13Sym = {
      name: "sprite_13",
      totalFrames: 42,
      frames: textures.getFrames("sprite_13"),
      anchorX: sprite13Anchor.x,
      anchorY: sprite13Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_15/frame_1/PlaceObject2_13_1/CLIPACTIONRECORD onClipEvent(load).as
        // _width = _parent.longueur - 10
        const parent = clip.parent;
        const longueur = (parent?.vars.longueur as number) ?? 0;
        const targetWidth = longueur - 10;
        const naturalWidth = SPRITE_13_BOUNDS.width;
        if (naturalWidth > 0) {
          clip.scaleX = targetWidth / naturalWidth;
        }
      },
      frameScripts: new Map([
        [
          39,
          (clip) => {
            // AS: DefineSprite_13/frame_40/DoAction.as
            // stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_15 — beam from caster to target --------------------
    // AS DefineSprite_15/frame_1/DoAction.as:
    //   SOMA.playSound("wab_explo")
    // AS DefineSprite_15/frame_1/DoAction_2.as:
    //   x1 = _parent.cellFrom.x; y1 = _parent.cellFrom.y - 40;
    //   x2 = _parent.cellTo.x;   y2 = _parent.cellTo.y - 40;
    //   _X = x1; _Y = y1;
    //   dx = x2 - x1; dy = y2 - y1;
    //   _rotation = Math.atan2(dy,dx) * 57.29746936176985;
    //   longueur = Math.sqrt(dx * dx + dy * dy);
    // AS DefineSprite_15/frame_4/DoAction.as:
    //   SOMA.playSound("licrounch_1008b")
    this.sprite15Sym = {
      name: "sprite_15",
      totalFrames: 120,
      frames: textures.getFrames("sprite_15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_15/frame_1/DoAction.as
            this.playSound?.("wab_explo");

            // AS: DefineSprite_15/frame_1/DoAction_2.as
            const root = clip.parent;
            const cellFrom = (root?.vars.cellFrom as { x: number; y: number }) ?? { x: 0, y: 0 };
            const cellTo = (root?.vars.cellTo as { x: number; y: number }) ?? { x: 0, y: 0 };

            const x1 = cellFrom.x;
            const y1 = cellFrom.y - 40;
            const x2 = cellTo.x;
            const y2 = cellTo.y - 40;

            clip.x = x1;
            clip.y = y1;

            const dx = x2 - x1;
            const dy = y2 - y1;
            // AS: _rotation = Math.atan2(dy,dx) * 57.29746936176985 (degrees)
            // Runtime uses radians: atan2 already gives radians.
            clip.rotation = Math.atan2(dy, dx);

            const longueur = Math.sqrt(dx * dx + dy * dy);
            clip.vars.longueur = longueur;

            // Attach sprite_13 (PlaceObject2_13_1 placement at frame_1 of sprite_15).
            // onLoad will read clip.vars.longueur from this parent.
            clip.attach(this.sprite13Sym, "sprite_13_1", 1, ctx);
          },
        ],
        [
          3,
          (_clip) => {
            // AS: DefineSprite_15/frame_4/DoAction.as
            // SOMA.playSound("licrounch_1008b")
            this.playSound?.("licrounch_1008b");
          },
        ],
      ]),
    };

    // ---- sprite_28 — explosion at target ---------------------------
    // AS DefineSprite_28/frame_1/DoAction.as:
    //   _X = _parent.cellTo.x;
    //   _Y = _parent.cellTo.y - 40;
    //   _rotation = _parent.clip1._rotation;
    //     (clip1 == sprite_15 instance; same angle)
    // AS DefineSprite_28/frame_10/DoAction.as:
    //   SOMA.playSound("vol")
    // AS DefineSprite_28/frame_10/DoAction_2.as:
    //   this.end() → signalHit
    // AS DefineSprite_28/frame_49/DoAction.as:
    //   stop(); _parent.removeMovieClip() → complete
    this.sprite28Sym = {
      name: "sprite_28",
      totalFrames: 51,
      frames: textures.getFrames("sprite_28"),
      anchorX: sprite28Anchor.x,
      anchorY: sprite28Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_28/frame_1/DoAction.as
            const root = clip.parent;
            const cellTo = (root?.vars.cellTo as { x: number; y: number }) ?? { x: 0, y: 0 };

            clip.x = cellTo.x;
            clip.y = cellTo.y - 40;

            // _rotation = _parent.clip1._rotation
            // clip1 is sprite_15 (attached as "sprite_15_inst" below).
            // Both share the same atan2 angle, so we can compute it directly.
            const cellFrom = (root?.vars.cellFrom as { x: number; y: number }) ?? { x: 0, y: 0 };
            const dx = cellTo.x - cellFrom.x;
            const dy = (cellTo.y - 40) - (cellFrom.y - 40);
            clip.rotation = Math.atan2(dy, dx);
          },
        ],
        [
          9,
          (_clip) => {
            // AS: DefineSprite_28/frame_10/DoAction.as
            // SOMA.playSound("vol")
            this.playSound?.("vol");
            // AS: DefineSprite_28/frame_10/DoAction_2.as
            // this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          48,
          (clip) => {
            // AS: DefineSprite_28/frame_49/DoAction.as
            // stop(); _parent.removeMovieClip()
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite13Sym);
    this.registry.register(this.sprite15Sym);
    this.registry.register(this.sprite28Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback so frameScripts can use it.
    this.playSound = callbacks.playSound;

    // Main timeline: implicitly places sprite_15 and sprite_28 on frame_1.
    // frame_2/DoAction.as: stop() — runtime stops the main timeline by
    // default since we don't drive it; children run independently.
    // Attach both parallel timelines so they start ticking from the
    // next runtime frame.
    this.root.attach(this.sprite15Sym, "sprite_15_inst", 1, context);
    this.root.attach(this.sprite28Sym, "sprite_28_inst", 2, context);
  }
}
