/**
 * Spell 2001 — (Wabbit / Bow Wow explosion, displayType=50 WorldAbsolute).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2001/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). DefineSprite_10's frame_1/DoAction_2.as reads
 * `_parent.cellFrom` and `_parent.cellTo` directly to position itself in world
 * coords, and DefineSprite_19's frame_1/DoAction.as reads `_parent.cellTo` and
 * `_parent.clip1._rotation` — both are classic WorldAbsolute patterns. The
 * container is placed at world (0,0) and children position themselves via the
 * stored cellFrom/cellTo vars on the root.
 *
 * Library symbols (manifest animations[], no librarySymbols[]):
 *   - sprite_8   — 48-frame beam/bolt animation. Stops at frame 46 (stop()).
 *                  No removal; lives inside sprite_10 as a placed child
 *                  (`clip1`) whose _rotation is later read by sprite_19.
 *                  onLoad: sets _width = _parent.longueur (stretches beam to
 *                  match caster→target distance).
 *   - sprite_10  — 144-frame composite outer container. frame_1 plays
 *                  "wab_explo", positions self at cellFrom, rotates to face
 *                  cellTo, measures longueur. Contains sprite_8 as a child
 *                  (clip1 in AS). No explicit removal — sprite_19 drives
 *                  completion.
 *   - sprite_19  — 34-frame impact at target. frame_1 positions self at
 *                  cellTo and copies clip1._rotation from parent. frame_7
 *                  plays "vol" and calls this.end() (→ signalHit). frame_33
 *                  stop() + _parent.removeMovieClip() → complete().
 *
 * Main timeline: frame_2/DoAction.as → stop() (just halts the main timeline).
 * Sounds: "wab_explo" on sprite_10 frame_1, "vol" on sprite_19 frame_7.
 *
 * Attach sequence in onSpellStart:
 *   1. Attach sprite_10 (clip1) at depth 1 — positions itself at cellFrom.
 *   2. Attach sprite_19 (clip2) at depth 2 — positions itself at cellTo,
 *      copies rotation from clip1.
 *
 * Note: sprite_8 is a placed child *inside* sprite_10 in the canonical SWF
 * (it appears as PlaceObject2_8_1 inside DefineSprite_10's frame_1). Its
 * onLoad stretches it to `longueur`. We model this by attaching sprite_8
 * inside sprite_10's frame_1 frameScript (depth 1, instance name "clip1_inner"
 * so it doesn't clash) — but since the canonical AS only has one
 * PlaceObject2_8_1 on the sprite_10 timeline, we attach it from sprite_10's
 * frame_1 script.
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

// Bounds from manifest animations[] entries (no librarySymbols present)
const SPRITE_8_BOUNDS = {
  width: 224.15,
  height: 61.9,
  offsetX: 0,
  offsetY: -30.5,
};
const SPRITE_10_BOUNDS = {
  width: 223.25,
  height: 61.65,
  offsetX: -0.4,
  offsetY: -30.1,
};
const SPRITE_19_BOUNDS = {
  width: 119.15,
  height: 63.9,
  offsetX: -24.7,
  offsetY: -33.15,
};

export class Spell2001 extends RuntimeSpell {
  readonly spellId = 2001;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite8Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite19Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite8Anchor = calculateAnchor(SPRITE_8_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE_10_BOUNDS);
    const sprite19Anchor = calculateAnchor(SPRITE_19_BOUNDS);

    // ---- sprite_8 — beam/bolt visual inside sprite_10 ------------
    // AS: DefineSprite_10/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load).as
    //   _width = _parent.longueur;
    // AS: DefineSprite_8/frame_46/DoAction.as → stop()
    //
    // sprite_8 is placed as a child of sprite_10 (PlaceObject2_8_1).
    // onLoad stretches it to the caster→target distance (longueur).
    // It stops at frame 46 (0-based: 45).
    this.sprite8Sym = {
      name: "sprite_8",
      totalFrames: 48,
      frames: textures.getFrames("sprite_8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_10/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load).as
        // _width = _parent.longueur
        const parent = clip.parent;
        const longueur = (parent?.vars.longueur as number) ?? 0;
        // Stretch the sprite horizontally to match the beam distance.
        // We achieve this via scaleX: longueur / nativeWidth.
        // The native width is SPRITE_8_BOUNDS.width.
        if (SPRITE_8_BOUNDS.width > 0 && longueur > 0) {
          clip.scaleX = longueur / SPRITE_8_BOUNDS.width;
        }
      },
      frameScripts: new Map([
        [
          45,
          (clip) => {
            // AS: DefineSprite_8/frame_46/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_10 — outer beam container (caster-side) ----------
    // AS: DefineSprite_10/frame_1/DoAction.as → SOMA.playSound("wab_explo")
    // AS: DefineSprite_10/frame_1/DoAction_2.as →
    //   x1 = _parent.cellFrom.x; y1 = _parent.cellFrom.y - 20;
    //   x2 = _parent.cellTo.x;   y2 = _parent.cellTo.y - 20;
    //   _X = x1; _Y = y1;
    //   dx = x2-x1; dy = y2-y1;
    //   _rotation = Math.atan2(dy,dx) * 57.29...  (degrees)
    //   longueur = Math.sqrt(dx*dx + dy*dy)
    //
    // sprite_8 (clip1) is a placed child (PlaceObject2_8_1) inside this
    // timeline — we attach it here in the frame_1 script so its onLoad
    // can read longueur.
    this.sprite10Sym = {
      name: "sprite_10",
      totalFrames: 144,
      frames: textures.getFrames("sprite_10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_10/frame_1/DoAction.as + DoAction_2.as
            // Sound is handled in onSpellStart for the canonical
            // SOMA.playSound call (frame_1 of this sprite).

            // Position self at cellFrom (world coords), rotated to face cellTo.
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
            // AS: _rotation = Math.atan2(dy,dx) * 57.29... (converts radians→degrees)
            // We store in radians directly.
            clip.rotation = Math.atan2(dy, dx);

            const longueur = Math.sqrt(dx * dx + dy * dy);
            clip.vars.longueur = longueur;

            // Attach sprite_8 as "clip1" (PlaceObject2_8_1 inside sprite_10).
            // Its onLoad will read longueur from this clip's vars.
            clip.attach(this.sprite8Sym, "clip1", 1, ctx);
          },
        ],
      ]),
    };

    // ---- sprite_19 — impact animation at target cell -------------
    // AS: DefineSprite_19/frame_1/DoAction.as →
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 20;
    //   _rotation = _parent.clip1._rotation;
    // AS: DefineSprite_19/frame_7/DoAction.as → SOMA.playSound("vol")
    // AS: DefineSprite_19/frame_7/DoAction_2.as → this.end()  (→ signalHit)
    // AS: DefineSprite_19/frame_33/DoAction.as → stop(); _parent.removeMovieClip()
    this.sprite19Sym = {
      name: "sprite_19",
      totalFrames: 34,
      frames: textures.getFrames("sprite_19"),
      anchorX: sprite19Anchor.x,
      anchorY: sprite19Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_19/frame_1/DoAction.as
            // _X = _parent.cellTo.x
            // _Y = _parent.cellTo.y - 20
            // _rotation = _parent.clip1._rotation
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            clip.x = cellTo?.x ?? 0;
            clip.y = (cellTo?.y ?? 0) - 20;

            // Copy rotation from clip1 (sprite_10 instance on root).
            const clip1 = root?.children.get("clip1");
            if (clip1) {
              clip.rotation = clip1.rotation;
            }
          },
        ],
        [
          6,
          () => {
            // AS: DefineSprite_19/frame_7/DoAction.as → SOMA.playSound("vol")
            // Sound is triggered via the stored callback reference.
            this.playSoundCallback?.("vol");
          },
        ],
        [
          6,
          () => {
            // AS: DefineSprite_19/frame_7/DoAction_2.as → this.end() → signalHit
            // (Both DoAction and DoAction_2 fire at frame 7 = index 6)
            this.runtime.signalHit();
          },
        ],
        [
          32,
          (clip) => {
            // AS: DefineSprite_19/frame_33/DoAction.as → stop(); _parent.removeMovieClip()
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite8Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite19Sym);
  }

  private playSoundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Capture sound callback for use in frame scripts (sprite_19 frame_7
    // plays "vol", sprite_10 frame_1 plays "wab_explo").
    this.playSoundCallback = callbacks.playSound;

    // AS: DefineSprite_10/frame_1/DoAction.as → SOMA.playSound("wab_explo")
    // Fired when sprite_10 (clip1) first appears. We play it here since
    // attach() runs the frame_1 script synchronously.
    callbacks.playSound("wab_explo");

    // Main timeline: attach sprite_10 as "clip1" (the beam, caster-side)
    // and sprite_19 as "clip2" (the impact, target-side).
    // sprite_10's frame_1 script positions it + attaches sprite_8 inside it.
    // sprite_19's frame_1 script positions it at cellTo + copies rotation.
    this.root.attach(this.sprite10Sym, "clip1", 1, context);
    this.root.attach(this.sprite19Sym, "clip2", 2, context);

    // AS: frame_2/DoAction.as → stop() on the main timeline (no-op for root).
  }
}
