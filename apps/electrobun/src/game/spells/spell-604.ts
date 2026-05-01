/**
 * Spell 604 — Dodge (Sram / evasion animation).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/604/scripts/scripts/
 *
 * displayType=40 (BeamLine). The spell has a `duplicate` symbol and no
 * ballistic `move` symbol. The harness drops `duplicate` sprites along
 * the caster→target line and signals hit when the beam reaches the end.
 *
 * Library symbols (from manifest.json librarySymbols[]):
 *   - sprite18 (directlyDynamic: true) — 81-frame character silhouette
 *     particle. Children (PlaceObject2_10_*) placed on frames 1 and 73
 *     all get `onLoad: gotoAndStop(random(_totalframes)+1)`.
 *     Frame 79: stop(). No onEnterFrame.
 *
 *   - sprite19 (directlyDynamic: false) — 5-frame wrapper sprite.
 *     Placed inside sprite20 (frame 0) with a static matrix. Its onLoad
 *     randomizes its start frame. Contains sprite18 instances as children.
 *
 *   - sprite20 (directlyDynamic: true) — 1-frame wrapper. Placed inside
 *     DefineSprite_26_duplicate at frame 0 (depth 1). Its single child
 *     (PlaceObject2_19_1) gets `onLoad: gotoAndStop(random(_totalframes)+1)`.
 *
 *   - sprite24 (directlyDynamic: true) — 54-frame character silhouette,
 *     parallel to sprite18 but for the duplicate's inner content.
 *     Children (PlaceObject2_21_*) placed at frames 1 and 49 get
 *     `onLoad: gotoAndStop(random(_totalframes)+1)`. Frame 53: stop().
 *
 *   - sprite25 (directlyDynamic: false) — 10-frame wrapper, analogous
 *     to sprite19 but for sprite24 content. Placed inside
 *     DefineSprite_26_duplicate at frame 1 (depth 3).
 *
 *   - shoot (animations[] only) — 90-frame animation at target.
 *     frame_1: `_rotation = _parent.angle`. frame_88: `_parent.removeMovieClip()`.
 *
 *   - duplicate (animations[] + DefineSprite_26_duplicate) — 4-frame
 *     container. frame_1: scale by level, gotoAndStop random frame.
 *     frame_2 placements: sprite19 (depth 1) + sprite25 (depth 3).
 *
 * Main timeline: SOMA.playSound("dodge_604").
 *
 * Signal hit: fired by harness automatically (BeamLine displayType=40).
 * Complete: fired from shoot's frame_88 script (`_parent.removeMovieClip()`).
 *
 * Note on displayType: The spell has both `duplicate` (BeamLine) and `shoot`
 * (BeamLineAlt attaches shoot at end). The manifest has `shoot` and `duplicate`
 * in animations[]. BeamLineAlt (41) attaches shoot at the end of the beam.
 * We use displayType=41 (BeamLineAlt) so shoot gets attached at impact.
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

// ---- Manifest bounds for library symbols ----

const SPRITE18_BOUNDS = {
  width: 54.25,
  height: 101,
  offsetX: -25.7,
  offsetY: -69.35,
};

const SPRITE19_BOUNDS = {
  width: 57.7,
  height: 110.95,
  offsetX: -29.55,
  offsetY: -69.05,
};

const SPRITE20_BOUNDS = {
  width: 49.5,
  height: 95.1,
  offsetX: -29.9,
  offsetY: -56.25,
};

const SPRITE24_BOUNDS = {
  width: 54.25,
  height: 101,
  offsetX: -25.7,
  offsetY: -69.35,
};

const SPRITE25_BOUNDS = {
  width: 57.3,
  height: 111.65,
  offsetX: -29.15,
  offsetY: -69.35,
};

const SHOOT_BOUNDS = {
  width: 301.75,
  height: 135.95,
  offsetX: -101.9,
  offsetY: -60.45,
};

const DUPLICATE_BOUNDS = {
  width: 70.95,
  height: 116.9,
  offsetX: -41.1,
  offsetY: -70.65,
};

export class Spell604 extends RuntimeSpell {
  readonly spellId = 604;
  readonly displayType = SpellDisplayType.BeamLineAlt;

  // Hold symbol refs so parent frameScripts can reference them.
  private sprite18Sym!: SymbolDefinition;
  private sprite19Sym!: SymbolDefinition;
  private sprite20Sym!: SymbolDefinition;
  private sprite24Sym!: SymbolDefinition;
  private sprite25Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite18Anchor = calculateAnchor(SPRITE18_BOUNDS);
    const sprite19Anchor = calculateAnchor(SPRITE19_BOUNDS);
    const sprite20Anchor = calculateAnchor(SPRITE20_BOUNDS);
    const sprite24Anchor = calculateAnchor(SPRITE24_BOUNDS);
    const sprite25Anchor = calculateAnchor(SPRITE25_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    const duplicateAnchor = calculateAnchor(DUPLICATE_BOUNDS);

    // ---- sprite18 — 81-frame directlyDynamic character silhouette ----
    // AS: DefineSprite_18
    // Children (PlaceObject2_10_3, PlaceObject2_10_19 at frame_1,
    //           PlaceObject2_10_10 at frame_73) each have:
    //   onClipEvent(load){ gotoAndStop(random(_totalframes) + 1); }
    // Frame 79: stop()
    // Because this sprite is directlyDynamic, its children are
    // sub-instances of sprite19 (characterId=19) which use `gotoAndStop`
    // to pick a random frame on load. We model the onLoad randomization
    // on the sprite18 clip itself (it represents the whole composed visual).
    this.sprite18Sym = {
      name: "sprite18",
      totalFrames: 81,
      frames: textures.getFrames("lib_sprite18"),
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_18/frame_1/PlaceObject2_10_3 and PlaceObject2_10_19
        //   onClipEvent(load){ gotoAndStop(random(_totalframes) + 1); }
        // These are placed children of sprite18 that jump to a random frame
        // on load. We model this as sprite18 itself jumping to a random frame
        // so the visual variation is preserved.
        const totalFrames = clip.totalFrames;
        const randomFrame = Math.floor(Math.random() * totalFrames);
        clip.gotoAndStop(randomFrame);
      },
      frameScripts: new Map([
        [
          78,
          (clip) => {
            // AS: DefineSprite_18/frame_79/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite19 — 5-frame wrapper (directlyDynamic: false) ----
    // AS: DefineSprite_19 — no own clipEvents, just wraps sprite18.
    // Placed inside sprite20 at frame 0, depth 1.
    // onLoad: gotoAndStop(random(_totalframes)+1) from its parent placement.
    this.sprite19Sym = {
      name: "sprite19",
      totalFrames: 5,
      frames: textures.getFrames("lib_sprite19"),
      anchorX: sprite19Anchor.x,
      anchorY: sprite19Anchor.y,
      onLoad: (clip, ctx) => {
        // AS: DefineSprite_20/frame_1/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(load).as
        //   gotoAndStop(random(_totalframes) + 1);
        const totalFrames = clip.totalFrames;
        const randomFrame = Math.floor(Math.random() * totalFrames);
        clip.gotoAndStop(randomFrame);
        // sprite19 contains sprite18 as a child placed at its frame 0.
        // Attach sprite18 at depth 1 per the placements[] data.
        // matrix: scaleX=0.857, scaleY=0.857, tx=-4.55, ty=2.95
        const child = clip.attach(this.sprite18Sym, "sprite18_child", 1, ctx, {
          x: -4.55,
          y: 2.95,
        });
        child.scaleX = 0.857147216796875;
        child.scaleY = 0.857147216796875;
      },
    };

    // ---- sprite20 — 1-frame directlyDynamic wrapper ----
    // AS: DefineSprite_20
    // Placed inside DefineSprite_26_duplicate at frame 0, depth 1.
    // Child PlaceObject2_19_1 has:
    //   onClipEvent(load){ gotoAndStop(random(_totalframes) + 1); }
    // sprite20 itself contains sprite19 as a static child.
    this.sprite20Sym = {
      name: "sprite20",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite20"),
      anchorX: sprite20Anchor.x,
      anchorY: sprite20Anchor.y,
      onLoad: (clip, ctx) => {
        // AS: DefineSprite_20/frame_1/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(load).as
        //   gotoAndStop(random(_totalframes) + 1);
        // The PlaceObject2_19_1 child (sprite19) randomizes its frame on load.
        // Attach sprite19 at depth 1 with the placement matrix from manifest:
        // parentSpriteId=20, frame=0, depth=1, tx=0.75, ty=-4.9, scale=1.
        const child = clip.attach(this.sprite19Sym, "sprite19_child", 1, ctx, {
          x: 0.75,
          y: -4.9,
        });
        child.scaleX = 1;
        child.scaleY = 1;
      },
    };

    // ---- sprite24 — 54-frame directlyDynamic character silhouette ----
    // AS: DefineSprite_24
    // Children at frame_1 (PlaceObject2_21_3, PlaceObject2_21_19) and
    // frame_49 (PlaceObject2_21_10) each have:
    //   onClipEvent(load){ gotoAndStop(random(_totalframes) + 1); }
    // Frame 53: stop()
    this.sprite24Sym = {
      name: "sprite24",
      totalFrames: 54,
      frames: textures.getFrames("lib_sprite24"),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_24/frame_1/PlaceObject2_21_3 and PlaceObject2_21_19
        //   onClipEvent(load){ gotoAndStop(random(_totalframes) + 1); }
        // As with sprite18, we model child randomization on the sprite itself.
        const totalFrames = clip.totalFrames;
        const randomFrame = Math.floor(Math.random() * totalFrames);
        clip.gotoAndStop(randomFrame);
      },
      frameScripts: new Map([
        [
          52,
          (clip) => {
            // AS: DefineSprite_24/frame_53/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite25 — 10-frame wrapper (directlyDynamic: false) ----
    // AS: DefineSprite_25 — wraps sprite24.
    // Placed inside DefineSprite_26_duplicate at frame 1 (depth 3).
    // Its child PlaceObject2_25_3 has:
    //   onClipEvent(load){ gotoAndStop(random(_totalframes) + 1); }
    this.sprite25Sym = {
      name: "sprite25",
      totalFrames: 10,
      frames: textures.getFrames("lib_sprite25"),
      anchorX: sprite25Anchor.x,
      anchorY: sprite25Anchor.y,
      onLoad: (clip, ctx) => {
        // AS: DefineSprite_26_duplicate/frame_2/PlaceObject2_25_3/
        //     CLIPACTIONRECORD onClipEvent(load).as
        //   gotoAndStop(random(_totalframes) + 1);
        const totalFrames = clip.totalFrames;
        const randomFrame = Math.floor(Math.random() * totalFrames);
        clip.gotoAndStop(randomFrame);
        // sprite25 contains sprite24 as a child placed at its frame 0.
        // Use placement from manifest: parentSpriteId=25 frame=0 depth=1
        // matrix: scaleX=0.605, scaleY=0.684, skew0=-0.102, skew1=0.190,
        //         tx=4.85, ty=-3.2
        const child = clip.attach(this.sprite24Sym, "sprite24_child", 1, ctx, {
          x: 4.85,
          y: -3.2,
        });
        child.scaleX = 0.6058502197265625;
        child.scaleY = 0.6847381591796875;
      },
    };

    // ---- shoot — 90-frame animation at target ----
    // AS: DefineSprite_3_shoot
    // frame_1: _rotation = _parent.angle
    // frame_88: _parent.removeMovieClip()
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 90,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_3_shoot/frame_1/DoAction.as
            //   _rotation = _parent.angle;
            const root = clip.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          87,
          (clip) => {
            // AS: DefineSprite_3_shoot/frame_88/DoAction.as
            //   _parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- duplicate — 4-frame container (DefineSprite_26_duplicate) ----
    // AS: DefineSprite_26_duplicate
    // frame_1:
    //   t = 10 * _parent.level + 50;
    //   _xscale = t; _yscale = t;
    //   gotoAndStop(random(_totalframes) + 1);
    // frame_2 placements:
    //   PlaceObject2_19_1 → sprite19 at depth 1, tx=3.8 ty=-11.45 scale=0.857
    //   PlaceObject2_25_3 → sprite25 at depth 3, tx=-11.95 ty=3.55 scale=1
    // Both get onClipEvent(load){ gotoAndStop(random(_totalframes)+1); }
    const duplicateSym: SymbolDefinition = {
      name: "duplicate",
      totalFrames: 4,
      frames: textures.getFrames("duplicate"),
      anchorX: duplicateAnchor.x,
      anchorY: duplicateAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_26_duplicate/frame_1/DoAction.as
            //   t = 10 * _parent.level + 50;
            //   _xscale = t; _yscale = t;
            //   gotoAndStop(random(_totalframes) + 1);
            const root = clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            const t = 10 * level + 50;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            const totalFrames = clip.totalFrames;
            const randomFrame = Math.floor(Math.random() * totalFrames);
            clip.gotoAndStop(randomFrame);
          },
        ],
        [
          1,
          (clip, ctx) => {
            // AS: DefineSprite_26_duplicate/frame_2 placements
            // PlaceObject2_19_1 — sprite19, depth 1, tx=3.8, ty=-11.45, scale=0.857
            //   onClipEvent(load){ gotoAndStop(random(_totalframes)+1); }
            // PlaceObject2_25_3 — sprite25, depth 3, tx=-11.95, ty=3.55, scale=1
            //   onClipEvent(load){ gotoAndStop(random(_totalframes)+1); }

            // Attach sprite19 at depth 1
            const s19 = clip.attach(
              this.sprite19Sym,
              "sprite19_dup",
              1,
              ctx,
              { x: 3.8, y: -11.45 }
            );
            s19.scaleX = 0.857147216796875;
            s19.scaleY = 0.857147216796875;

            // Attach sprite25 at depth 3
            const s25 = clip.attach(
              this.sprite25Sym,
              "sprite25_dup",
              3,
              ctx,
              { x: -11.95, y: 3.55 }
            );
            s25.scaleX = 1;
            s25.scaleY = 1;
          },
        ],
      ]),
    };

    // Also attach sprite20 inside duplicate at frame 0 depth 1.
    // From manifest: sprite20 placements[].parentSpriteId=26, frame=0, depth=1
    // tx=0.75, ty=-4.9 scale=1.
    // We augment the duplicate's frame_1 script (frame index 0) to also
    // attach sprite20 BEFORE jumping to random frame. We override the
    // frameScripts entry to include this attachment.
    // Actually, looking at the placements data more carefully:
    // sprite20.placements[0]: parentSpriteId=26, frame=0, depth=1, tx=0.75, ty=-4.9
    // sprite19.placements[0]: parentSpriteId=20, frame=0, depth=1, tx=-4.55, ty=2.95
    // sprite19.placements[1]: parentSpriteId=26, frame=1, depth=1, tx=3.8, ty=-11.45
    // sprite25.placements[0]: parentSpriteId=26, frame=1, depth=3, tx=-11.95, ty=3.55
    //
    // So the duplicate (sprite26) timeline:
    //   frame 0 (=frame_1): place sprite20 at depth 1 (tx=0.75, ty=-4.9)
    //   frame 1 (=frame_2): place sprite19 at depth 1 + sprite25 at depth 3
    //
    // BUT frame_1/DoAction.as does gotoAndStop(random(_totalframes)+1) AFTER
    // setting scale — so the duplicate may immediately jump to frame 2 which
    // triggers the frame_2 placements. We need to attach sprite20 in the
    // frame 0 script BEFORE the gotoAndStop. Let's rebuild duplicateSym
    // with the complete frame_0 logic including sprite20 attachment.

    // We need to redefine duplicateSym with the sprite20 attachment included.
    // Since SymbolDefinition is const, we build the final version now and
    // register it. The sprite20Sym is already built above.
    const duplicateSymFinal: SymbolDefinition = {
      name: "duplicate",
      totalFrames: 4,
      frames: textures.getFrames("duplicate"),
      anchorX: duplicateAnchor.x,
      anchorY: duplicateAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_26_duplicate/frame_1/DoAction.as
            //   t = 10 * _parent.level + 50;
            //   _xscale = t; _yscale = t;
            //   gotoAndStop(random(_totalframes) + 1);
            const root = clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            const t = 10 * level + 50;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;

            // sprite20 placement: parentSpriteId=26, frame=0, depth=1
            // tx=0.75, ty=-4.9, scale=1
            const s20 = clip.attach(
              this.sprite20Sym,
              "sprite20_dup",
              1,
              ctx,
              { x: 0.75, y: -4.9 }
            );
            s20.scaleX = 1;
            s20.scaleY = 1;

            const totalFrames = clip.totalFrames;
            const randomFrame = Math.floor(Math.random() * totalFrames);
            clip.gotoAndStop(randomFrame);
          },
        ],
        [
          1,
          (clip, ctx) => {
            // AS: DefineSprite_26_duplicate/frame_2 placements
            // PlaceObject2_19_1 — sprite19, depth 1, tx=3.8, ty=-11.45, scale=0.857
            //   onClipEvent(load){ gotoAndStop(random(_totalframes)+1); }
            // PlaceObject2_25_3 — sprite25, depth 3, tx=-11.95, ty=3.55, scale=1
            //   onClipEvent(load){ gotoAndStop(random(_totalframes)+1); }

            // Attach sprite19 at depth 1
            const s19 = clip.attach(
              this.sprite19Sym,
              "sprite19_dup",
              1,
              ctx,
              { x: 3.8, y: -11.45 }
            );
            s19.scaleX = 0.857147216796875;
            s19.scaleY = 0.857147216796875;

            // Attach sprite25 at depth 3
            const s25 = clip.attach(
              this.sprite25Sym,
              "sprite25_dup",
              3,
              ctx,
              { x: -11.95, y: 3.55 }
            );
            s25.scaleX = 1;
            s25.scaleY = 1;
          },
        ],
      ]),
    };

    this.registry.register(this.sprite18Sym);
    this.registry.register(this.sprite19Sym);
    this.registry.register(this.sprite20Sym);
    this.registry.register(this.sprite24Sym);
    this.registry.register(this.sprite25Sym);
    this.registry.register(shootSym);
    this.registry.register(duplicateSymFinal);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // AS: scripts/frame_1/DoAction.as
    //   SOMA.playSound("dodge_604");
    callbacks.playSound("dodge_604");
  }
}
