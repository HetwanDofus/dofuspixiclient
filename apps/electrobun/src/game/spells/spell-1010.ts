/**
 * Spell 1010 — (Cra earth/nature spell, likely "Flèche de Recul" or similar grass/sling attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1010/scripts/scripts/
 *
 * displayType=11 (TargetCell). No `move`/`shoot`/`duplicate` symbols, no
 * caster-relative positioning — both authored sprites position themselves
 * at `_parent.cellTo` (target cell). sprite_15/frame_1 sets _X/_Y to
 * cellTo explicitly, confirming target-cell anchoring. No projectile arc,
 * no beam pattern. → TargetCell (11).
 *
 * Animations in manifest (no librarySymbols — use bare names, NO lib_ prefix):
 *   - sprite_11  — 6-frame small impact spark/flash (used indirectly as
 *                  a sub-element of sprite_14's composite; registered for
 *                  completeness but not directly attached by AS).
 *   - sprite_14  — 261-frame main impact composite (grass/earth burst).
 *                  frame_1 (DoAction.as): SOMA.playSound("herbe").
 *                  frame_1 (DoAction_2.as): gotoAndPlay(random(30) + 1) —
 *                    randomises entry point in first 30 frames.
 *                  frame_151 (DoAction.as): SOMA.playSound("fronde").
 *                  frame_259 (DoAction.as): stop().
 *   - sprite_15  — 204-frame longer composite (secondary hit/linger).
 *                  frame_1 (DoAction.as): _X = _parent.cellTo.x; _Y = _parent.cellTo.y.
 *                  frame_163 (DoAction.as): this.end() → signalHit.
 *                  frame_202 (DoAction.as): _parent.removeMovieClip() → complete.
 *
 * Main timeline frame_2/DoAction.as: stop().
 * Sounds on main timeline manifest: "herbe" at frame 0, "fronde" at frame 150.
 * Both sounds are also triggered from inside sprite_14's frame scripts,
 * which is the canonical place — onSpellStart plays "herbe" to mirror the
 * main-timeline frame_1 sound entry.
 *
 * Both sprite_14 and sprite_15 are attached in onSpellStart (they are
 * placed on the main timeline frame_1 implicitly in canonical AS).
 * sprite_15/frame_1 reads _parent.cellTo → cellTo is on root.vars (set by harness).
 * For displayType=11 (TargetCell), the container anchor IS cellTo, so
 * _parent.cellTo.x relative to the container origin is (0,0). We apply
 * that in sprite_15's frame_1 script, setting x/y to 0 (container-local target).
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

const SPRITE_11_BOUNDS = {
  width: 14.3,
  height: 10.9,
  offsetX: -7.15,
  offsetY: -5.45,
};

const SPRITE_14_BOUNDS = {
  width: 71.45,
  height: 107.85,
  offsetX: -36.9,
  offsetY: -78.3,
};

const SPRITE_15_BOUNDS = {
  width: 90.85,
  height: 142,
  offsetX: -44.1,
  offsetY: -95.65,
};

export class Spell1010 extends RuntimeSpell {
  readonly spellId = 1010;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite14Sym!: SymbolDefinition;
  private sprite15Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite11Anchor = calculateAnchor(SPRITE_11_BOUNDS);
    const sprite14Anchor = calculateAnchor(SPRITE_14_BOUNDS);
    const sprite15Anchor = calculateAnchor(SPRITE_15_BOUNDS);

    // ---- sprite_11 — 6-frame spark/flash element -----------------
    // No direct AS attachMovie calls reference this by name from the
    // top-level scripts — it is a composite sub-element baked into
    // sprite_14's rendered frames. Registered for completeness.
    const sprite11Sym: SymbolDefinition = {
      name: "sprite_11",
      totalFrames: 6,
      frames: textures.getFrames("sprite_11"),
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,
    };

    // ---- sprite_14 — 261-frame main grass/earth burst -------------
    //
    // AS DefineSprite_14/frame_1/DoAction.as:
    //   SOMA.playSound("herbe");
    // AS DefineSprite_14/frame_1/DoAction_2.as:
    //   gotoAndPlay(random(30) + 1);
    // AS DefineSprite_14/frame_151/DoAction.as:
    //   SOMA.playSound("fronde");
    // AS DefineSprite_14/frame_259/DoAction.as:
    //   stop();
    //
    // The two DoAction scripts on frame_1 both run on entry:
    //   1. play the "herbe" sound
    //   2. jump to a random frame in [1..30] (0-based: [0..29])
    // The "fronde" sound fires at frame 151 (0-based: 150).
    // The timeline stops at frame 259 (0-based: 258).
    //
    // Sound callbacks are only available in onSpellStart. We capture
    // a reference here so frame scripts inside the symbol can trigger
    // them at the canonical frames.
    this.sprite14Sym = {
      name: "sprite_14",
      totalFrames: 261,
      frames: textures.getFrames("sprite_14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, _ctx) => {
            // AS DefineSprite_14/frame_1/DoAction.as: SOMA.playSound("herbe")
            // Sound triggered via captured callback (see onSpellStart).
            // AS DefineSprite_14/frame_1/DoAction_2.as: gotoAndPlay(random(30) + 1)
            // random(30) returns [0..29]; +1 makes AS frame [1..30]; 0-based: [0..29]
            const target = Math.floor(Math.random() * 30);
            clip.gotoAndPlay(target);
          },
        ],
        [
          150,
          (_clip, _ctx) => {
            // AS DefineSprite_14/frame_151/DoAction.as: SOMA.playSound("fronde")
            this.soundCallbacks?.playSound("fronde");
          },
        ],
        [
          258,
          (clip) => {
            // AS DefineSprite_14/frame_259/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_15 — 204-frame secondary hit/linger --------------
    //
    // AS DefineSprite_15/frame_1/DoAction.as:
    //   _X = _parent.cellTo.x;
    //   _Y = _parent.cellTo.y;
    // For displayType=11 (TargetCell), the container is already anchored
    // AT cellTo in world space. So container-local (0, 0) IS cellTo.
    // We set x=0, y=0 here to match the canonical positioning.
    //
    // AS DefineSprite_15/frame_163/DoAction.as:
    //   this.end() → signalHit (damage popup)
    //
    // AS DefineSprite_15/frame_202/DoAction.as:
    //   _parent.removeMovieClip() → spell complete
    this.sprite15Sym = {
      name: "sprite_15",
      totalFrames: 204,
      frames: textures.getFrames("sprite_15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_15/frame_1/DoAction.as:
            //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
            // displayType=11: container origin === cellTo in world coords.
            // Container-local position of cellTo is (0, 0).
            clip.x = 0;
            clip.y = 0;
          },
        ],
        [
          162,
          (_clip) => {
            // AS DefineSprite_15/frame_163/DoAction.as: this.end()
            // Canonical hit signal — damage popup at target.
            this.runtime.signalHit();
          },
        ],
        [
          201,
          (clip) => {
            // AS DefineSprite_15/frame_202/DoAction.as: _parent.removeMovieClip()
            // This is the outer mc removal — signals spell completion.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite11Sym);
    this.registry.register(this.sprite14Sym);
    this.registry.register(this.sprite15Sym);
  }

  // Captured callbacks reference so frame scripts inside sprite_14 can
  // trigger sounds at the canonical frames (150 → "fronde").
  private soundCallbacks?: SpellCallbacks;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    this.soundCallbacks = callbacks;

    // AS main timeline: places sprite_14 and sprite_15 on frame_1.
    // frame_2/DoAction.as: stop() — main timeline halts after placing children.
    //
    // sprite_14 frame_1 also plays "herbe" — we play it here to mirror
    // the initial frame_1 entry before gotoAndPlay randomises the playhead.
    callbacks.playSound("herbe");

    // Attach sprite_14 (main burst, depth 1) and sprite_15 (secondary, depth 2).
    this.root.attach(this.sprite14Sym, "sprite14", 1, context);
    this.root.attach(this.sprite15Sym, "sprite15", 2, context);
  }
}
