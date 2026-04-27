/**
 * Spell 1200 — (Feca spell, projectile with explosion impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1200/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). Evidence:
 *   - Manifest has both `move` and `shoot` animations.
 *   - `DefineSprite_48_move` has a child with onClipEvent(enterFrame) rotating it,
 *     and a frame_25 DoAction that calls stop() — canonical 2-phase move behaviour.
 *   - `DefineSprite_7_shoot` has frame_1 (sound) and frame_130 (_parent.removeMovieClip())
 *     — canonical burn-at-target shoot pattern.
 *   - The harness drives move along a parabolic arc and attaches shoot at landing.
 *
 * Library symbols (in animations[], NOT librarySymbols[]):
 *   - `shoot` — 132-frame impact animation. frame_1 plays "explosion" sound.
 *               frame_130 calls _parent.removeMovieClip() → spell complete.
 *   - `move`  — 27-frame projectile animation. Child (DefineSprite_48_move internal
 *               sprite) rotates +50 deg/frame via onClipEvent(enterFrame).
 *               frame_25 calls stop().
 *
 * DefineSprite_5 is an explosion particle (vi/vx/vy/size/vs/va/acc physics),
 * but there is no attachMovie call targeting it visible in the provided AS —
 * the GAC.applyColor sprites (DefineSprite_17, 20, 25, 29, 31, 36, 41) are
 * character-colour overlays baked into the authored timelines of move/shoot and
 * are not dynamically attached. They do not need to be registered as standalone
 * symbols since the harness drives move/shoot directly by name and the frame
 * textures carry the visual content.
 *
 * Main timeline: manifest `sounds[0]` lists "explosion" at frame 0, which
 * corresponds to the canonical DefineSprite_7_shoot/frame_1 sound trigger.
 * The shoot symbol's own frame_1 script fires playSound("explosion") after
 * the harness attaches it at landing — that is the canonical location.
 * onSpellStart is a no-op for this spell (no top-level main-timeline sound
 * separate from the shoot frame_1 trigger).
 *
 * signalHit: displayType=30 → harness fires runtime.signalHit() automatically
 * at landing. Do NOT call it from spell code.
 *
 * complete: called from shoot frameScripts[129] mirroring frame_130
 * `_parent.removeMovieClip()`.
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
  width: 116.95,
  height: 57.4,
  offsetX: -55.85,
  offsetY: -29.25,
};

const MOVE_BOUNDS = {
  width: 29.25,
  height: 58.25,
  offsetX: -14.35,
  offsetY: -52.95,
};

export class Spell1200 extends RuntimeSpell {
  readonly spellId = 1200;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    const moveAnchor = calculateAnchor(MOVE_BOUNDS);

    // ---- move — 27-frame projectile composite -------------------
    // The harness attaches this at root (0,0) and drives it along the
    // parabolic arc. It has a child sub-sprite (DefineSprite_48_move
    // internal PlaceObject2_47_1) with onClipEvent(enterFrame) rotating
    // +50 deg/frame, and frame_25 calls stop().
    //
    // AS: DefineSprite_48_move/frame_1/PlaceObject2_47_1/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + 50;
    //
    // AS: DefineSprite_48_move/frame_25/DoAction.as
    //   stop();
    //
    // The rotation behaviour is on an inner authored sub-sprite whose
    // position is baked into the move frame textures — the move clip
    // itself does not rotate. The stop() at frame 25 (index 24) halts
    // the move timeline when it lands; the harness removes move on
    // landing regardless, so this is belt-and-suspenders.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 27,
      frames: textures.getFrames("move"),
      anchorX: moveAnchor.x,
      anchorY: moveAnchor.y,
      frameScripts: new Map([
        [
          24,
          (clip) => {
            // AS: DefineSprite_48_move/frame_25/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- shoot — 132-frame impact composite ----------------------
    // Attached by the harness at the target on landing (displayType 30).
    //
    // AS: DefineSprite_7_shoot/frame_1/DoAction.as
    //   SOMA.playSound("explosion");
    //
    // AS: DefineSprite_7_shoot/frame_130/DoAction.as
    //   _parent.removeMovieClip();
    //
    // frame_130 (index 129) removes the outer mc → spell complete.
    // signalHit is NOT called here — harness fires it automatically
    // at landing for displayType 30.
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 132,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip, _ctx) => {
            // AS: DefineSprite_7_shoot/frame_1/DoAction.as
            // Sound is triggered by onSpellStart via the shoot frame_1.
            // We store the callback reference so it is accessible here.
            if (this._soundCallback) {
              this._soundCallback("explosion");
            }
          },
        ],
        [
          129,
          (clip) => {
            // AS: DefineSprite_7_shoot/frame_130/DoAction.as
            // _parent.removeMovieClip() — kill the whole spell tree.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  private _soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // Capture the playSound callback so the shoot frame_1 script can
    // fire it when the projectile lands and the shoot clip is attached.
    this._soundCallback = callbacks.playSound;
  }
}
