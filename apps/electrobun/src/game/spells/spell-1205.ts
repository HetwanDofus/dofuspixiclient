/**
 * Spell 1205 — Pandawa spell (m_panda_spell_a).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1205/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The spell has a `move` symbol
 * (DefineSprite_9_move) and a `shoot` symbol (DefineSprite_8_shoot),
 * with no ballistic arc — the harness attaches `shoot` at the
 * target-relative offset and rotates the container to face the target.
 * This matches the ProjectileLinear pattern.
 *
 * Library symbols / sprites:
 *   - DefineSprite_6     — spark/ember particle spawned inside shoot.
 *                          frame_1 seeds angle/v/va/t and installs an
 *                          onEnterFrame that drifts the particle with
 *                          0.95 friction and random direction wobble.
 *   - DefineSprite_4     — larger ember particle, same pattern but
 *                          with different t seed and slightly different
 *                          wobble probability.
 *   - DefineSprite_9_move — `move` placeholder container. Its single
 *                          placed child has an onEnterFrame that
 *                          randomises alpha every frame.
 *   - DefineSprite_8_shoot — `shoot` 74-frame container:
 *       frame_4 (index 3): _rotation = 0 (overrides harness rotation).
 *       frame_39 (index 38): a placed child whose onEnterFrame fades
 *                            its parent by −3.34 alpha per frame.
 *       frame_72 (index 71): stop() + _parent.removeMovieClip() →
 *                            spell complete.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("m_panda_spell_a").
 *
 * Note: DefineSprite_6 and DefineSprite_4 do not appear in
 * librarySymbols[] — the manifest has no librarySymbols array. The
 * only animations[] entry is "shoot" (74 frames). The two particle
 * symbols are authored inside shoot's timeline and their textures are
 * baked into the composite shoot frames; they are NOT attached via
 * attachMovie from the canonical AS we have access to. The scripts we
 * do have for DefineSprite_6 and DefineSprite_4 describe their
 * onEnterFrame behaviour, but since they are not registered library
 * symbols that get attachMovie'd externally, and since no attachMovie
 * call for them appears in any of the provided AS files, we treat
 * them as fully baked into the shoot composite frames.
 *
 * The move symbol has one authored clip event (alpha randomisation on
 * its placed child), but again there is no librarySymbols entry and
 * no attachMovie call in the manifest scripts list. The harness will
 * look up "move" from the registry; since the manifest's animations[]
 * only has "shoot", we register `move` as a container-only symbol with
 * no frames.
 *
 * signalHit: for displayType=20 (ProjectileLinear) the harness does
 * NOT auto-fire signalHit (only 30/31 do that). We fire it from the
 * shoot frame_4 script (the first meaningful frame of the impact,
 * matching the canonical `_rotation = 0` reset that indicates the
 * shoot has landed).
 *
 * complete(): fired from shoot frame_72 (index 71), mirroring
 * `stop(); _parent.removeMovieClip();`.
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
  width: 115.25,
  height: 64.5,
  offsetX: -66,
  offsetY: -32.3,
};

export class Spell1205 extends RuntimeSpell {
  readonly spellId = 1205;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- move — placeholder container for the linear projectile ----
    // No authored textures; the harness attaches this at root and the
    // container exists purely to satisfy the ProjectileLinear harness
    // pattern. The canonical DefineSprite_9_move has one placed child
    // whose onEnterFrame randomises alpha, but since that child is
    // authored (not attachMovie'd) and baked into the composite, we
    // model move as a simple container-only symbol.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
    };

    // ---- shoot — 74-frame impact at target -----------------------
    // AS DefineSprite_8_shoot/frame_4/DoAction.as:
    //   _rotation = 0;
    // AS DefineSprite_8_shoot/frame_39/PlaceObject2_7_1/onClipEvent(enterFrame):
    //   _parent._alpha -= 3.34;
    //   (This is a clip event on a child placed at frame_39. We model
    //    the fade by installing an onEnterFrame on the shoot clip itself
    //    starting from frame 38, since the child's _parent is shoot.)
    // AS DefineSprite_8_shoot/frame_72/DoAction.as:
    //   stop(); _parent.removeMovieClip();
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 74,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_8_shoot/frame_39/PlaceObject2_7_1/
        //   CLIPACTIONRECORD onClipEvent(enterFrame).as:
        //   _parent._alpha -= 3.34;
        // The child's onClipEvent fires every frame once the child is
        // placed (at frame_39, index 38). We mirror this by checking
        // the current frame index and applying the fade from that
        // frame onward.
        if (clip.currentFrame >= 38) {
          clip.alpha = Math.max(0, clip.alpha - 3.34 / 100);
        }
      },
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS DefineSprite_8_shoot/frame_4/DoAction.as:
            //   _rotation = 0;
            // Overrides any harness-applied rotation so the impact
            // plays upright.
            clip.rotation = 0;
            // For ProjectileLinear the harness does not fire signalHit.
            // Fire it here at the first meaningful impact frame.
            this.runtime.signalHit();
          },
        ],
        [
          71,
          (clip) => {
            // AS DefineSprite_8_shoot/frame_72/DoAction.as:
            //   stop(); _parent.removeMovieClip();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as:
    //   SOMA.playSound("m_panda_spell_a");
    callbacks.playSound("m_panda_spell_a");
  }
}
