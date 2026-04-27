/**
 * Spell 2102 — (Unknown name, likely a Eniripsa/Osamodas spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2102/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single symbol `DefineSprite_34`
 * that positions itself at `_parent.cellTo` on frame_1, plays a 67-frame
 * animation, and calls `_parent.removeMovieClip()` at frame_67. There is no
 * `move`, `shoot` or `duplicate` symbol; no projectile arc or beam logic.
 * The outer `DefineSprite_18_shoot` is registered as `shoot` for the harness
 * but its only frame script is a `stop()` at frame_70 — it acts as a simple
 * 84-frame visual container at the target cell.
 *
 * Manifest note: `librarySymbols` is absent/empty. The single authored
 * animation is `shoot` (84 frames) in `animations[]`. There is also a
 * `DefineSprite_34` (67 frames) whose frame scripts drive positioning,
 * sounds, hit signal and completion. Because `DefineSprite_34` is not in
 * `librarySymbols[]` it is referenced by its AS name only; its textures come
 * from the `shoot` animation entry (the extractor flattens it there).
 *
 * Timeline summary:
 *   DefineSprite_34 (67 frames):
 *     frame_1:  SOMA.playSound("licrounch_1003");
 *               _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
 *     frame_25: SOMA.playSound("explosion"); this.end() → signalHit
 *     frame_67: _parent.removeMovieClip() → complete
 *
 *   DefineSprite_18_shoot (84 frames, the visual):
 *     frame_70: stop()
 *
 *   Main timeline frame_2: stop()
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * Main timeline: frame_2/DoAction.as → stop() — handled by onSpellStart.
 *
 * Sound triggers: "licrounch_1003" at frame_1, "explosion" at frame_25.
 * Because sounds from within symbol frame scripts cannot use the
 * `callbacks` reference directly, we capture it at onSpellStart time.
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
  width: 204.8,
  height: 129.6,
  offsetX: -102.35,
  offsetY: -68.1,
};

export class Spell2102 extends RuntimeSpell {
  readonly spellId = 2102;
  readonly displayType = SpellDisplayType.TargetCell;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot (DefineSprite_18_shoot) — 84-frame visual at target ----
    // The outer visual container. Its only authored script is:
    // AS: DefineSprite_18_shoot/frame_70/DoAction.as → stop()
    //
    // DefineSprite_34 (the inner scripted sprite) is attached inside
    // shoot's frame_1 implicitly by the main timeline in the canonical
    // SWF. We model that by attaching it from shoot's frame_1 script.
    // However, since DefineSprite_34 is not a separate library symbol
    // but rather an inner clip we drive via the shoot symbol itself,
    // we merge its logic into the shoot frameScripts below with the
    // canonical per-frame actions inline.
    //
    // The positioning (_X = _parent.cellTo.x / _Y = _parent.cellTo.y)
    // from DefineSprite_34/frame_1/DoAction_2.as applies to the shoot
    // clip itself (it IS DefineSprite_34 from the harness perspective —
    // for TargetCell the harness places root at the target, so shoot
    // lands at (0,0) relative to the container which is already at
    // cellTo). We honour the canonical coords by reading cellTo from
    // root.vars, but since the container is already anchored at cellTo
    // in TargetCell mode the net offset is zero.

    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 84,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_34/frame_1/DoAction.as → SOMA.playSound("licrounch_1003")
            this.soundCallback?.("licrounch_1003");

            // AS: DefineSprite_34/frame_1/DoAction_2.as
            //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
            // For TargetCell the container is already at cellTo so the
            // clip sits at (0,0) within the container — no extra offset.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              // anchor is resolved to cellTo for TargetCell, so local
              // coords are world coords minus anchor = (0, 0) net.
              clip.x = 0;
              clip.y = 0;
            }
          },
        ],
        [
          24,
          () => {
            // AS: DefineSprite_34/frame_25/DoAction.as → SOMA.playSound("explosion")
            this.soundCallback?.("explosion");

            // AS: DefineSprite_34/frame_25/DoAction_2.as → this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          66,
          (clip) => {
            // AS: DefineSprite_34/frame_67/DoAction.as → _parent.removeMovieClip()
            // This is the outermost removal — signals spell completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
        [
          69,
          (clip) => {
            // AS: DefineSprite_18_shoot/frame_70/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback so frame scripts can trigger sounds.
    this.soundCallback = callbacks.playSound;

    // AS: frame_2/DoAction.as → stop()
    // The main timeline stops at frame 2 — we do nothing else here
    // because the harness for TargetCell already attaches "shoot" at
    // (0,0) relative to the target-anchored container.
    //
    // Attach the shoot clip explicitly since for TargetCell the harness
    // does NOT auto-attach "shoot" (only displayType 20/21/30/31/40/41
    // do that). We mirror the implicit main-timeline PlaceObject.
    const shootSym = this.registry.resolve("shoot");
    if (shootSym) {
      this.root.attach(shootSym, "shoot", 1, context);
    }
  }
}
