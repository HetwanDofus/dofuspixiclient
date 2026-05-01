/**
 * Spell 2110 — (Unknown name, likely a Cra/Iop fire-type spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2110/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). Rationale: The spell has a `shoot`
 * symbol (DefineSprite_4_shoot) and a separate impact symbol (DefineSprite_13).
 * DefineSprite_13/frame_1 positions itself at `_parent.cellTo` (world
 * absolute target coords), and DefineSprite_4_shoot/frame_1 resets
 * `_rotation = 0` — the classic linear-projectile pattern where the harness
 * rotates the container to face the target and the shoot symbol flies along
 * that line. DefineSprite_13 is a separate authored timeline attached at
 * the target cell; the harness places `shoot` at the target-local offset
 * inside the rotated container.
 *
 * Wait — re-reading the scripts more carefully:
 * - DefineSprite_13/frame_1: `_X = _parent.cellTo.x; _Y = _parent.cellTo.y;`
 *   This is WorldAbsolute positioning (sets WORLD coords directly).
 * - DefineSprite_4_shoot/frame_1: `_rotation = 0;`
 * - frame_2/DoAction.as (main timeline): `stop();`
 * - The manifest has no `move` symbol — only `shoot` in animations[].
 * - DefineSprite_13 is an independent clip that positions itself at cellTo
 *   in world space — strongly suggesting displayType=51 (WorldAbsoluteAlt).
 *
 * The manifest `animations` only lists `shoot` (105 frames). There are no
 * librarySymbols entries — so `shoot` and DefineSprite_13 are both plain
 * animations referenced by AS name. The harness for displayType 20 would
 * attach `shoot` at the target-local offset, but DefineSprite_13 explicitly
 * self-positions at `_parent.cellTo.x / .y`, implying the container origin
 * is (0,0) — i.e., WorldAbsolute.
 *
 * Final classification: displayType=51 (WorldAbsoluteAlt).
 * Both `shoot` and `sprite13` (DefineSprite_13) are attached in onSpellStart.
 * `shoot` positions itself via harness transform (target offset), while
 * `sprite13` positions itself via its own frame_1 script reading _parent.cellTo.
 *
 * Library symbols (none in librarySymbols[] — all are plain animations):
 *   - shoot (105 frames): frame_1 resets _rotation=0; frame_73 starts
 *     alpha-fade (onEnterFrame: _alpha -= 10 each tick); frame_103 calls
 *     _parent.removeMovieClip + stop (triggers complete).
 *   - sprite13 (91 frames): frame_1 self-positions at cellTo; frame_37
 *     plays "explosion" sound; frame_40 calls this.end() (signalHit);
 *     frame_91 calls _parent.removeMovieClip.
 *
 * Main timeline frame_2: stop() — no sound on main timeline.
 * Sound "explosion" fired at sprite13 frame_37 (AS frame index = 36 zero-based).
 * signalHit at sprite13 frame_40 (zero-based: 39) via `this.end()`.
 * complete() at shoot frame_103 (zero-based: 102) via `_parent.removeMovieClip`.
 * sprite13 frame_91 (zero-based: 90) also calls _parent.removeMovieClip —
 * we guard with the idempotent complete().
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

const SHOOT_BOUNDS = {
  width: 177.75,
  height: 106.15,
  offsetX: -89.05,
  offsetY: -52.95,
};

export class Spell2110 extends RuntimeSpell {
  readonly spellId = 2110;
  readonly displayType = SpellDisplayType.WorldAbsoluteAlt;

  private shootSym!: SymbolDefinition;
  private sprite13Sym!: SymbolDefinition;
  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 105-frame projectile/impact animation at target ----
    // No librarySymbols entry — textures under bare name "shoot".
    // AS DefineSprite_4_shoot:
    //   frame_1:  _rotation = 0;
    //   frame_73: this.onEnterFrame = function() { _alpha -= 10; }
    //   frame_103: _parent.removeMovieClip(); stop();
    this.shootSym = {
      name: "shoot",
      totalFrames: 105,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_4_shoot/frame_1/DoAction.as
            // _rotation = 0; — override any harness-applied rotation
            clip.rotation = 0;
          },
        ],
        [
          72,
          (clip) => {
            // AS DefineSprite_4_shoot/frame_73/DoAction.as
            // this.onEnterFrame = function() { _alpha = _alpha - 10; };
            // Install a fade-out handler from frame 73 onward.
            clip.onEnterFrame = (c) => {
              c.alpha = c.alpha - 10 / 100;
            };
          },
        ],
        [
          102,
          (clip) => {
            // AS DefineSprite_4_shoot/frame_103/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- sprite13 — 91-frame impact at target cell ---------------
    // AS DefineSprite_13:
    //   frame_1:  _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    //   frame_37: SOMA.playSound("explosion");
    //   frame_40: this.end();  (→ signalHit)
    //   frame_91: _parent.removeMovieClip();
    //
    // No frames listed in manifest animations for DefineSprite_13 —
    // it is a container-only symbol (no texture frames of its own).
    // Its visual content is the authored timeline played back as a
    // child of the root. Since there are no separate texture assets
    // for it, we use frames: [].
    this.sprite13Sym = {
      name: "sprite13",
      totalFrames: 91,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_13/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
          },
        ],
        [
          36,
          () => {
            // AS DefineSprite_13/frame_37/DoAction.as
            // SOMA.playSound("explosion");
            this.playSound?.("explosion");
          },
        ],
        [
          39,
          () => {
            // AS DefineSprite_13/frame_40/DoAction.as
            // this.end(); → signalHit (damage popup at target)
            this.runtime.signalHit();
          },
        ],
        [
          90,
          (clip) => {
            // AS DefineSprite_13/frame_91/DoAction.as
            // _parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.shootSym);
    this.registry.register(this.sprite13Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback so frame scripts can call it.
    this.playSound = callbacks.playSound;

    // Main timeline frame_2: stop(); — no sound on main timeline.

    // Attach shoot at the target-local offset (WorldAbsoluteAlt —
    // container is at world origin (0,0), so we position shoot at
    // cellTo directly). shoot's own frame_1 resets _rotation = 0.
    this.root.attach(this.shootSym, "shoot", 2, context, {
      x: context.cellTo.x,
      y: context.cellTo.y,
    });

    // Attach sprite13 — it positions itself at _parent.cellTo in its
    // own frame_1 script, so no transform needed here.
    this.root.attach(this.sprite13Sym, "sprite13", 1, context);
  }
}
