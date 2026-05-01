/**
 * Spell 612 — Dodge (Sram-class dodge effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/612/scripts/scripts/
 *
 * displayType=41 (BeamLineAlt). The spell has both `duplicate` and `shoot`
 * symbols registered. The harness periodically drops `duplicate` clips along
 * the caster→target line, then at the end attaches `shoot` at the target and
 * fires signalHit. This matches the canonical layout: duplicate is a composite
 * with per-instance random-stopped child clips, and shoot is a 84-frame impact
 * timeline that removes itself at frame 70 and signals completion.
 *
 * Library symbols:
 *   - sprite36 — directlyDynamic: true. 81-frame animated dodger sprite.
 *     frame_1 (index 0): positions children via PlaceObject2 with onLoad
 *     gotoAndStop(random(_totalframes)+1). frame_79 (index 78): stop().
 *     Also hosts placements of sprite23 at frames 1 and 73 with onLoad
 *     gotoAndStop handlers, but sprite23 is not in librarySymbols (it is
 *     an authored shape, not a dynamic clip). We register sprite36 with its
 *     full frame textures and a frameScripts stop at frame 78.
 *   - sprite37 — directlyDynamic: false. 5-frame wrapper used inside both
 *     sprite38 (depth 1, frame 0) and sprite39/duplicate (depth 1 and 3,
 *     frame 1). Its two children (at depths 1 and 3) each get onLoad
 *     gotoAndStop(random(_totalframes)+1). Attach them from sprite37's
 *     frameScripts.set(0, ...) after sprite38/duplicate places sprite37.
 *   - sprite38 — directlyDynamic: true. 1-frame wrapper. Has one placement
 *     of sprite37 at frame 0 (depth 1) with onLoad gotoAndStop handler.
 *     Used inside duplicate at depth 2, frame 0 (the "static" first instance).
 *     (sprite38 hosts sprite37 at depth 1.)
 *   - shoot (animation) — 84-frame full-rendered impact. frame_1: _rotation=0.
 *     frame_70: _parent.removeMovieClip(); stop(); → signals complete.
 *   - duplicate (animation) — 3-frame composite. frame_1 DoAction scales to
 *     t = 10*level+40, then gotoAndStop(random(_totalframes)+1). The harness
 *     uses the name "duplicate" for BeamLine drops.
 *
 * Main timeline: SOMA.playSound("dodge_604"); (no stop — single frame).
 *
 * Hit signal: fired automatically by the harness (BeamLineAlt) when the beam
 * reaches the target, so we must NOT call signalHit ourselves.
 * Completion: fired from shoot's frame 69 script (_parent.removeMovieClip).
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
const SPRITE36_BOUNDS = {
  width: 71.75,
  height: 115.1,
  offsetX: -38.45,
  offsetY: -83.45,
};
const SPRITE37_BOUNDS = {
  width: 70.3,
  height: 129.45,
  offsetX: -38.9,
  offsetY: -86.1,
};
const SPRITE38_BOUNDS = {
  width: 60.25,
  height: 110.95,
  offsetX: -37.9,
  offsetY: -70.85,
};

// --- Manifest bounds for animations (no lib_ prefix) ---
const SHOOT_BOUNDS = {
  width: 121.1,
  height: 112.65,
  offsetX: -58.55,
  offsetY: -74.2,
};
const DUPLICATE_BOUNDS = {
  width: 83.25,
  height: 133,
  offsetX: -50.05,
  offsetY: -83.7,
};

export class Spell612 extends RuntimeSpell {
  readonly spellId = 612;
  readonly displayType = SpellDisplayType.BeamLineAlt;

  // Keep references so onSpellStart and nested frameScripts can use them.
  private sprite36Sym!: SymbolDefinition;
  private sprite37Sym!: SymbolDefinition;
  private sprite38Sym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;
  private duplicateSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite36Anchor = calculateAnchor(SPRITE36_BOUNDS);
    const sprite37Anchor = calculateAnchor(SPRITE37_BOUNDS);
    const sprite38Anchor = calculateAnchor(SPRITE38_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    const duplicateAnchor = calculateAnchor(DUPLICATE_BOUNDS);

    // ----------------------------------------------------------------
    // sprite36 — directlyDynamic: true, 81-frame animated dodge sprite
    // ----------------------------------------------------------------
    // AS: scripts/DefineSprite_36/frame_1/PlaceObject2_23_17/CLIPACTIONRECORD onClipEvent(load).as
    //     scripts/DefineSprite_36/frame_1/PlaceObject2_23_3/CLIPACTIONRECORD onClipEvent(load).as
    //     scripts/DefineSprite_36/frame_73/PlaceObject2_23_9/CLIPACTIONRECORD onClipEvent(load).as
    //     scripts/DefineSprite_36/frame_79/DoAction.as → stop()
    //
    // PlaceObject2_23_* are instances of DefineSprite_23 (an authored shape/
    // internal animated sprite not exported as a library symbol). Their onLoad
    // scripts each do: gotoAndStop(random(_totalframes) + 1). Because sprite23
    // does not appear in librarySymbols and its textures are baked into the
    // sprite36 composite frames, we only need to honour the frame_79 stop()
    // and let the authored sprite36 frame textures carry the visual. There are
    // no enterFrame scripts on sprite36 itself.
    this.sprite36Sym = {
      name: "sprite36",
      totalFrames: 81,
      frames: textures.getFrames("lib_sprite36"),
      anchorX: sprite36Anchor.x,
      anchorY: sprite36Anchor.y,
      frameScripts: new Map([
        [
          78, // AS frame_79/DoAction.as → stop()
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite37 — directlyDynamic: false, 5-frame wrapper
    // ----------------------------------------------------------------
    // sprite37 is placed by both sprite38 (depth 1 frame 0) and by
    // sprite39/duplicate (depth 1 and depth 3, frame 1). Its two
    // child instances each carry:
    //   onClipEvent(load){ gotoAndStop(random(_totalframes) + 1); }
    // The instances are of sprite37 itself (it loops through its own
    // 5-frame timeline). We model this: when sprite37 is attached,
    // its onLoad jumps to a random frame of its own timeline, which is
    // the canonical behaviour from the CLIPACTIONRECORD scripts.
    //
    // AS: scripts/DefineSprite_39_duplicate/frame_2/PlaceObject2_37_1/CLIPACTIONRECORD onClipEvent(load).as
    //     scripts/DefineSprite_39_duplicate/frame_2/PlaceObject2_37_3/CLIPACTIONRECORD onClipEvent(load).as
    //     scripts/DefineSprite_38/frame_1/PlaceObject2_37_1/CLIPACTIONRECORD onClipEvent(load).as
    this.sprite37Sym = {
      name: "sprite37",
      totalFrames: 5,
      frames: textures.getFrames("lib_sprite37"),
      anchorX: sprite37Anchor.x,
      anchorY: sprite37Anchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load): gotoAndStop(random(_totalframes) + 1)
        // _totalframes = 5 for sprite37
        const targetFrame = Math.floor(Math.random() * 5);
        clip.gotoAndStop(targetFrame);
      },
    };

    // ----------------------------------------------------------------
    // sprite38 — directlyDynamic: true, 1-frame wrapper
    // ----------------------------------------------------------------
    // sprite38 contains one authored PlaceObject2 placement of sprite37
    // at depth 1, frame 0. That placement carries an onLoad handler:
    //   onClipEvent(load){ gotoAndStop(random(_totalframes) + 1); }
    // We implement this by attaching sprite37 from sprite38's frameScripts
    // at frame 0 (the entry frame), which then triggers sprite37's own
    // onLoad automatically through clip.attach().
    //
    // AS: scripts/DefineSprite_38/frame_1/PlaceObject2_37_1/CLIPACTIONRECORD onClipEvent(load).as
    this.sprite38Sym = {
      name: "sprite38",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite38"),
      anchorX: sprite38Anchor.x,
      anchorY: sprite38Anchor.y,
      frameScripts: new Map([
        [
          0, // AS DefineSprite_38/frame_1 — place sprite37 at depth 1
          (clip, ctx) => {
            // PlaceObject2_37_1: place sprite37 at depth 1
            // matrix: translateX=-4.55, translateY=2.95, scale=0.857
            clip.attach(this.sprite37Sym, "sprite37_1", 1, ctx, {
              x: -4.55,
              y: 2.95,
            });
            const child = clip.children.get("sprite37_1");
            if (child) {
              child.scaleX = 0.857147216796875;
              child.scaleY = 0.857147216796875;
            }
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // shoot — 84-frame impact animation (from animations[], not librarySymbols)
    // ----------------------------------------------------------------
    // AS: scripts/DefineSprite_16_shoot/frame_1/DoAction.as → _rotation = 0
    //     scripts/DefineSprite_16_shoot/frame_70/DoAction.as → _parent.removeMovieClip(); stop()
    this.shootSym = {
      name: "shoot",
      totalFrames: 84,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0, // AS DefineSprite_16_shoot/frame_1/DoAction.as
          (clip) => {
            // _rotation = 0 — reset any harness-applied rotation
            clip.rotation = 0;
          },
        ],
        [
          69, // AS DefineSprite_16_shoot/frame_70/DoAction.as
          (clip) => {
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // duplicate — 3-frame composite (from animations[], not librarySymbols)
    // ----------------------------------------------------------------
    // AS: scripts/DefineSprite_39_duplicate/frame_1/DoAction.as
    //   t = 10 * _parent.level + 40;
    //   _xscale = t; _yscale = t;
    //   gotoAndStop(random(_totalframes) + 1);
    //
    // The harness attaches "duplicate" by that name, so this is the entry
    // for the BeamLine drop. After the scale/goto, the duplicate sits on a
    // random frame from its 3-frame authored composite.
    //
    // frame_2 of duplicate (index 1) has TWO PlaceObject2 placements of
    // sprite37 (depths 1 and 3). Both carry:
    //   onClipEvent(load){ gotoAndStop(random(_totalframes) + 1); }
    // We attach them from frameScripts[1].
    this.duplicateSym = {
      name: "duplicate",
      totalFrames: 3,
      frames: textures.getFrames("duplicate"),
      anchorX: duplicateAnchor.x,
      anchorY: duplicateAnchor.y,
      frameScripts: new Map([
        [
          0, // AS DefineSprite_39_duplicate/frame_1/DoAction.as
          (clip, ctx) => {
            // t = 10 * _parent.level + 40; _xscale = t; _yscale = t;
            const level = (clip.parent?.vars.level as number) ?? 1;
            const t = 10 * level + 40;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            // gotoAndStop(random(_totalframes) + 1) — _totalframes = 3
            const targetFrame = Math.floor(Math.random() * 3);
            clip.gotoAndStop(targetFrame);
            // If we landed on frame index 1 (AS frame 2), attach the
            // sprite37 children. Check here since gotoAndStop won't
            // re-fire frameScripts[1] when called from frameScripts[0].
            if (targetFrame === 1) {
              this.attachDuplicateFrame2Children(clip, ctx);
            }
          },
        ],
        [
          1, // AS DefineSprite_39_duplicate/frame_2 placements
          (clip, ctx) => {
            // PlaceObject2_37_1 (depth 1) and PlaceObject2_37_3 (depth 3)
            // Each carries onClipEvent(load){ gotoAndStop(random(_totalframes)+1); }
            // which is implemented inside sprite37Sym.onLoad.
            this.attachDuplicateFrame2Children(clip, ctx);
          },
        ],
      ]),
    };

    this.registry.register(this.sprite36Sym);
    this.registry.register(this.sprite37Sym);
    this.registry.register(this.sprite38Sym);
    this.registry.register(this.shootSym);
    this.registry.register(this.duplicateSym);
  }

  /**
   * Attach the two sprite37 instances that belong to duplicate's frame_2
   * (AS DefineSprite_39_duplicate/frame_2/PlaceObject2_37_1 and _37_3).
   * Called both from frameScripts[1] and from frameScripts[0] when the
   * random gotoAndStop lands on frame index 1.
   */
  private attachDuplicateFrame2Children(
    clip: import("@dofus/spell-runtime").SpellClip,
    ctx: SpellContext
  ): void {
    // PlaceObject2_37_1: depth 1, ratio 1, translateX=4.6, translateY=-9.05, scale=0.857
    // AS: scripts/DefineSprite_39_duplicate/frame_2/PlaceObject2_37_1/CLIPACTIONRECORD onClipEvent(load).as
    if (!clip.children.has("sprite37_d1")) {
      clip.attach(this.sprite37Sym, "sprite37_d1", 1, ctx, {
        x: 4.6,
        y: -9.05,
      });
      const c1 = clip.children.get("sprite37_d1");
      if (c1) {
        c1.scaleX = 0.857147216796875;
        c1.scaleY = 0.857147216796875;
      }
    }
    // PlaceObject2_37_3: depth 3, ratio 1, translateX=-11.15, translateY=5.95, scale=1
    // AS: scripts/DefineSprite_39_duplicate/frame_2/PlaceObject2_37_3/CLIPACTIONRECORD onClipEvent(load).as
    if (!clip.children.has("sprite37_d3")) {
      clip.attach(this.sprite37Sym, "sprite37_d3", 3, ctx, {
        x: -11.15,
        y: 5.95,
      });
      // scaleX/Y already 1 by default
    }
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // AS: scripts/frame_1/DoAction.as → SOMA.playSound("dodge_604");
    callbacks.playSound("dodge_604");
  }
}
