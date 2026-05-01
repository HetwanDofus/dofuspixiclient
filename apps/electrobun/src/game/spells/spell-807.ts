/**
 * Spell 807 — Vlad (unknown class, dark/death-themed impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/807/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute).
 *
 * The manifest has no `librarySymbols[]` — there is only a single
 * `animations[]` entry (`anim1`, 69 frames). The canonical AS places a
 * single DefineSprite_5 on the main timeline (no `attachMovie` calls).
 * DefineSprite_5 IS the `anim1` animation (its frames are the pre-rendered
 * SVG sequence).
 *
 * The three frame scripts on DefineSprite_5 are:
 *   - frame_10  : reposition self at cellFrom (caster cell)
 *   - frame_43  : call this.end() (signalHit) + reposition at cellTo (target cell)
 *   - frame_67  : stop()
 *
 * Because the sprite positions itself using `_parent.cellFrom` / `_parent.cellTo`
 * (absolute world coords), this is a WorldAbsolute spell (displayType=50).
 * The harness stores cellFrom/cellTo on root.vars so per-clip scripts can read them.
 *
 * Main timeline: SOMA.playSound("vlad_807"); (frame_1/DoAction.as)
 *
 * Library symbols: none (librarySymbols[] is absent/empty in manifest).
 * anim1 is registered as a container-driven symbol with its frameScripts
 * porting the three DefineSprite_5 frame actions.
 *
 * Completion signal: frame_67 calls stop(); after that the spell is done.
 * We fire complete() at frame_67 (0-based: 66).
 * Hit signal: frame_43 calls this.end() → signalHit() (0-based: 42).
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

const ANIM1_BOUNDS = {
  width: 261.2,
  height: 494,
  offsetX: -130.25,
  offsetY: -450.1,
};

export class Spell807 extends RuntimeSpell {
  readonly spellId = 807;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — single authored timeline, 69 frames ----------------
    // This is DefineSprite_5 in the canonical SWF. It has three frame
    // scripts and is placed once on the main timeline.
    //
    // frame_10/DoAction.as:  this._x = this._parent.cellFrom.x;
    //                         this._y = this._parent.cellFrom.y;
    // frame_43/DoAction.as:  this.end();
    //                         _X = _parent.cellTo.x;
    //                         _Y = _parent.cellTo.y;
    // frame_67/DoAction.as:  stop();
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 69,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          9,
          (clip) => {
            // AS DefineSprite_5/frame_10/DoAction.as
            // this._x = this._parent.cellFrom.x;
            // this._y = this._parent.cellFrom.y;
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
          42,
          (clip) => {
            // AS DefineSprite_5/frame_43/DoAction.as
            // this.end() → signalHit (damage popup at target)
            // _X = _parent.cellTo.x;
            // _Y = _parent.cellTo.y;
            this.runtime.signalHit();
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
          66,
          (clip) => {
            // AS DefineSprite_5/frame_67/DoAction.as
            // stop();
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("vlad_807");
    callbacks.playSound("vlad_807");

    // Attach anim1 on the root. For WorldAbsolute the root container
    // sits at world (0,0); the sprite positions itself at cellFrom/cellTo
    // via its own frameScripts (frame_10 and frame_43).
    // Initial position: frame_1 of the canonical SWF places DefineSprite_5
    // at the default position (0,0) before frame_10 repositions it to
    // cellFrom. We honour that by attaching without an explicit transform.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
