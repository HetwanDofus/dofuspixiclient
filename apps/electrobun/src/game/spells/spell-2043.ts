/**
 * Spell 2043 — (Unknown name, likely a Cra/Iop projectile spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2043/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Two parallel authored timelines anchored
 * at world origin, each positioning themselves at _parent.cellFrom or
 * _parent.cellTo using absolute world coords. This mirrors the sprite_22 /
 * sprite_41 pattern from spell 909.
 *
 * Canonical AS layout:
 *
 *   - top-level main timeline: frame_2/DoAction.as → stop(). No sound on
 *     main timeline. frame_1 implicitly places DefineSprite_29 (beam/line
 *     from caster to target) and an outer container that holds
 *     DefineSprite_37 and DefineSprite_18_shoot.
 *
 *   - DefineSprite_29 — line/beam from caster to target (frame 1 only):
 *       frame_1: positions self at cellFrom (y-20), rotates toward cellTo,
 *                sets a child "PlaceObject2_27_1" (DefineSprite_27) to width
 *                = longueur (the pixel distance). The child DefineSprite_27
 *                stops at frame 34.
 *       This is a visual beam connecting caster to target.
 *
 *   - DefineSprite_37 — target-side impact/explosion (28 frames):
 *       frame_1: position at cellTo (y-20), rotation = _parent.clip1._rotation
 *                (mirrors the beam angle).
 *       frame_4: SOMA.playSound("vol").
 *       frame_7: this.end() → signalHit (damage popup).
 *       frame_28: stop(); _parent.removeMovieClip() → spell complete.
 *
 *   - DefineSprite_18_shoot — animated shoot at target (84 frames):
 *       frame_1: position at cellTo (y=0, not -20), rotation = 0.
 *       frame_10: SOMA.playSound("explosion").
 *       frame_70: stop().
 *
 * displayType detection:
 *   - DefineSprite_29/frame_1 reads `_parent.cellFrom` AND `_parent.cellTo`
 *     and positions itself at absolute world coords.
 *   - DefineSprite_37/frame_1 reads `_parent.cellTo` at absolute world coord.
 *   - DefineSprite_18_shoot/frame_1 reads `_parent.cellTo` at absolute world coord.
 *   - No `move`/`shoot` pattern for ballistic; no `duplicate` for beam.
 *   - Multiple sprites anchored in world space → WorldAbsolute (50).
 *   - The manifest has no librarySymbols[] entry (empty). All symbols appear
 *     in animations[] as the "shoot" animation (84 frames). DefineSprite_29,
 *     DefineSprite_37, DefineSprite_27, and DefineSprite_18_shoot are
 *     container-only timelines (authored but no lib_ prefix in manifest).
 *
 * Library symbols:
 *   No librarySymbols[] in manifest — all symbols are container-only or
 *   use the bare "shoot" animation from animations[].
 *   We register: sprite29 (beam), sprite37 (impact), sprite27 (beam width
 *   child), shoot (DefineSprite_18_shoot, 84 frames of animated content).
 *
 * Main timeline: frame_2 → stop(). onSpellStart attaches sprite29, sprite37,
 * and shoot (DefineSprite_18_shoot) at root.
 *
 * Sounds:
 *   - "vol" fired from DefineSprite_37/frame_4 (frame index 3, 0-based).
 *   - "explosion" fired from DefineSprite_18_shoot/frame_10 (frame index 9).
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

export class Spell2043 extends RuntimeSpell {
  readonly spellId = 2043;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite27Sym!: SymbolDefinition;
  private sprite29Sym!: SymbolDefinition;
  private sprite37Sym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- DefineSprite_27 — beam-width child inside sprite29 ------
    // AS: DefineSprite_27/frame_34/DoAction.as → stop()
    // This is the actual visual line/beam content. It is placed as a
    // child of DefineSprite_29 and has its _width set to `longueur`
    // (the pixel distance from caster to target) via onClipEvent(load).
    // It plays through 34 frames then stops.
    this.sprite27Sym = {
      name: "sprite_27",
      totalFrames: 34,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_29/frame_1/PlaceObject2_27_1/CLIPACTIONRECORD onClipEvent(load).as
        // _width = _parent.longueur
        // We mirror this by reading longueur from the parent (sprite29).
        const longueur = (clip.parent?.vars.longueur as number) ?? 0;
        if (longueur > 0) {
          clip.scaleX = longueur / Math.max(SHOOT_BOUNDS.width, 1);
        }
      },
      frameScripts: new Map([
        [
          33,
          (clip) => {
            // AS: DefineSprite_27/frame_34/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_29 — beam from caster to target -------------
    // AS: DefineSprite_29/frame_1/DoAction.as
    // Positions self at cellFrom (y-20), rotates to face cellTo,
    // computes longueur (pixel distance), then a child (sprite_27) has
    // its width set to longueur via onClipEvent(load).
    this.sprite29Sym = {
      name: "sprite_29",
      totalFrames: 34,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_29/frame_1/DoAction.as
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            const x1 = cellFrom?.x ?? 0;
            const y1 = (cellFrom?.y ?? 0) - 20;
            const x2 = cellTo?.x ?? 0;
            const y2 = (cellTo?.y ?? 0) - 20;
            clip.x = x1;
            clip.y = y1;
            const dx = x2 - x1;
            const dy = y2 - y1;
            // AS: _rotation = Math.atan2(dy,dx) * 57.29746... (degrees)
            // TS: store radians directly
            clip.rotation = Math.atan2(dy, dx);
            const longueur = Math.sqrt(dx * dx + dy * dy);
            clip.vars.longueur = longueur;
            // Attach sprite_27 as the visual beam child at depth 1.
            // Its onLoad will read longueur from this clip.
            clip.attach(this.sprite27Sym, "clip27", 1, ctx);
          },
        ],
      ]),
    };

    // ---- DefineSprite_37 — target-side impact animation -----------
    // AS: DefineSprite_37/frame_1/DoAction.as  → position at cellTo, rotate
    // AS: DefineSprite_37/frame_4/DoAction.as  → SOMA.playSound("vol")
    // AS: DefineSprite_37/frame_7/DoAction.as  → this.end() (signalHit)
    // AS: DefineSprite_37/frame_28/DoAction.as → stop(); _parent.removeMovieClip()
    this.sprite37Sym = {
      name: "sprite_37",
      totalFrames: 28,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_37/frame_1/DoAction.as
            // _X = _parent.cellTo.x
            // _Y = _parent.cellTo.y - 20
            // _rotation = _parent.clip1._rotation
            // clip1 refers to sprite_29 (the beam clip placed at depth 1
            // on the root). We read its rotation to mirror it.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            clip.x = cellTo?.x ?? 0;
            clip.y = (cellTo?.y ?? 0) - 20;
            // Mirror the beam rotation from sprite_29 (named "clip1" in AS).
            const clip1 = root?.children.get("clip1");
            if (clip1) {
              clip.rotation = clip1.rotation;
            }
          },
        ],
        [
          3,
          () => {
            // AS: DefineSprite_37/frame_4/DoAction.as → SOMA.playSound("vol")
            this.soundCallback?.("vol");
          },
        ],
        [
          6,
          () => {
            // AS: DefineSprite_37/frame_7/DoAction.as → this.end()
            // this.end() is the canonical hit signal in Dofus AS.
            this.runtime.signalHit();
          },
        ],
        [
          27,
          (clip) => {
            // AS: DefineSprite_37/frame_28/DoAction.as
            // stop(); _parent.removeMovieClip()
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_18_shoot — animated shoot at target ---------
    // AS: DefineSprite_18_shoot/frame_1/DoAction.as
    //       _X = _parent.cellTo.x
    //       _Y = _parent.cellTo.y
    //       _rotation = 0
    // AS: DefineSprite_18_shoot/frame_10/DoAction.as → SOMA.playSound("explosion")
    // AS: DefineSprite_18_shoot/frame_70/DoAction.as → stop()
    // Uses the "shoot" animation frames from animations[] (84 frames).
    this.shootSym = {
      name: "shoot",
      totalFrames: 84,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_18_shoot/frame_1/DoAction.as
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            clip.x = cellTo?.x ?? 0;
            clip.y = cellTo?.y ?? 0;
            clip.rotation = 0;
          },
        ],
        [
          9,
          () => {
            // AS: DefineSprite_18_shoot/frame_10/DoAction.as
            // SOMA.playSound("explosion")
            this.soundCallback?.("explosion");
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

    this.registry.register(this.sprite27Sym);
    this.registry.register(this.sprite29Sym);
    this.registry.register(this.sprite37Sym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use inside frame scripts.
    this.soundCallback = callbacks.playSound;

    // AS: frame_2/DoAction.as → stop() (main timeline just stops at frame 2).
    // frame_1 implicitly places the three authored sprites.
    // We attach them here so they start ticking from the next runtime frame.

    // sprite_29 is the beam from caster to target (placed as "clip1" in AS
    // so that sprite_37 can read _parent.clip1._rotation).
    this.root.attach(this.sprite29Sym, "clip1", 1, context);

    // sprite_37 is the target-side impact animation.
    this.root.attach(this.sprite37Sym, "clip37", 2, context);

    // shoot (DefineSprite_18_shoot) is the full 84-frame animated impact.
    this.root.attach(this.shootSym, "shoot", 3, context);
  }
}
