/**
 * Spell 2910 — (Cra/Ecaflip water beam / wab explosion).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2910/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Two parallel authored timelines are placed
 * on the main timeline: sprite_19 (the beam, 144 frames, composite) and
 * sprite_28 (the impact explosion at the target cell, 51 frames).
 * sprite_19's frame_1 reads _parent.cellFrom / _parent.cellTo to position
 * and rotate itself along the caster→target line, and contains an inner
 * child (PlaceObject2_17_1, i.e. sprite_17) whose onLoad sets its _width
 * to `longueur` (the pixel distance). sprite_28's frame_1 reads
 * _parent.cellTo and _parent.clip1._rotation (clip1 = sprite_19's inner
 * sprite_17 clip, whose rotation it copies).
 *
 * Since both sprites position themselves using absolute world coords
 * (_parent.cellFrom / _parent.cellTo), displayType=50 (WorldAbsolute) is
 * correct — the container stays at (0,0) and all children place themselves
 * at raw world pixel coords.
 *
 * Library symbols:
 *   None — manifest has no `librarySymbols[]` entries.
 *
 * Authored timeline symbols (animations[]):
 *   - sprite_17  — 48-frame inner beam strip. onLoad sets _width = longueur.
 *                  frame_46 (index 45): stop().
 *   - sprite_19  — 144-frame outer beam composite. frame_1: position at
 *                  cellFrom, rotate to face cellTo, set longueur, play sound.
 *                  Holds sprite_17 as an inner child.
 *   - sprite_28  — 51-frame impact explosion at target. frame_1: position
 *                  at cellTo, copy rotation from clip1. frame_10: play sound
 *                  "vol" + signalHit. frame_49 (index 48): stop() + complete.
 *
 * Main timeline: frame_2/DoAction.as → stop(). Two children (sprite_19,
 * sprite_28) are placed on the main timeline implicitly; we attach them
 * from onSpellStart.
 *
 * signalHit fires from sprite_28's frame_10 (index 9) via `this.end()`.
 * complete fires from sprite_28's frame_49 (index 48) via
 * `_parent.removeMovieClip()`.
 *
 * NOTE: sprite_28 frame_1 references `_parent.clip1._rotation`. In the
 * canonical SWF `clip1` is the instance name of sprite_19 placed on the
 * main timeline. We attach sprite_19 under instance name "clip1" so that
 * sprite_28's frame_1 script can find it via `clip.parent?.children.get("clip1")`.
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

// ---- Bounds from manifest animations[] entries --------------------

const SPRITE_17_BOUNDS = {
  width: 225,
  height: 79.25,
  offsetX: 0,
  offsetY: -35.7,
};

const SPRITE_19_BOUNDS = {
  width: 224.1,
  height: 78.95,
  offsetX: -0.4,
  offsetY: -35.25,
};

const SPRITE_28_BOUNDS = {
  width: 119.15,
  height: 63.9,
  offsetX: -24.7,
  offsetY: -33.15,
};

export class Spell2910 extends RuntimeSpell {
  readonly spellId = 2910;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  // Keep refs to registered symbols so onSpellStart can attach them.
  private sprite17Sym!: SymbolDefinition;
  private sprite19Sym!: SymbolDefinition;
  private sprite28Sym!: SymbolDefinition;

  // Capture callbacks for use inside frame scripts that need playSound.
  private _playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite17Anchor = calculateAnchor(SPRITE_17_BOUNDS);
    const sprite19Anchor = calculateAnchor(SPRITE_19_BOUNDS);
    const sprite28Anchor = calculateAnchor(SPRITE_28_BOUNDS);

    // ---- sprite_17 — inner beam strip (width-stretched by longueur) ---
    // AS: DefineSprite_19/frame_1/PlaceObject2_17_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //   _width = _parent.longueur;
    // AS: DefineSprite_17/frame_46/DoAction.as
    //   stop();
    this.sprite17Sym = {
      name: "sprite_17",
      totalFrames: 48,
      frames: textures.getFrames("sprite_17"),
      anchorX: sprite17Anchor.x,
      anchorY: sprite17Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_19/frame_1/PlaceObject2_17_1/
        //    CLIPACTIONRECORD onClipEvent(load).as:
        //   _width = _parent.longueur;
        // _parent here is sprite_19. longueur was computed in
        // sprite_19's frame_1 DoAction_2 and stored in sprite_19.vars.
        const longueur = (clip.parent?.vars.longueur as number) ?? 0;
        // SpellClip does not expose a raw width setter; we approximate
        // the AS _width stretch by adjusting scaleX so that
        // scaleX * naturalWidth == longueur.
        // naturalWidth is SPRITE_17_BOUNDS.width (225 px).
        if (SPRITE_17_BOUNDS.width > 0 && longueur > 0) {
          clip.scaleX = longueur / SPRITE_17_BOUNDS.width;
        }
      },
      frameScripts: new Map([
        [
          45,
          (clip) => {
            // AS DefineSprite_17/frame_46/DoAction.as:
            //   stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_19 — outer beam composite (144 frames) ---------------
    // AS DefineSprite_19/frame_1/DoAction.as:
    //   SOMA.playSound("wab_explo");
    // AS DefineSprite_19/frame_1/DoAction_2.as:
    //   x1 = _parent.cellFrom.x;
    //   y1 = _parent.cellFrom.y - 20;
    //   x2 = _parent.cellTo.x;
    //   y2 = _parent.cellTo.y - 20;
    //   _X = x1;  _Y = y1;
    //   dx = x2 - x1;  dy = y2 - y1;
    //   _rotation = Math.atan2(dy,dx) * 57.29746936176985;
    //   longueur = Math.sqrt(dx*dx + dy*dy);
    // (then PlaceObject2_17_1 places sprite_17 as a child whose onLoad
    //  reads longueur from _parent = sprite_19)
    this.sprite19Sym = {
      name: "sprite_19",
      totalFrames: 144,
      frames: textures.getFrames("sprite_19"),
      anchorX: sprite19Anchor.x,
      anchorY: sprite19Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_19/frame_1/DoAction.as:
            //   SOMA.playSound("wab_explo");
            this._playSound?.("wab_explo");

            // AS DefineSprite_19/frame_1/DoAction_2.as:
            //   x1 = _parent.cellFrom.x; y1 = _parent.cellFrom.y - 20;
            //   x2 = _parent.cellTo.x;   y2 = _parent.cellTo.y - 20;
            //   _X = x1; _Y = y1;
            //   dx = x2 - x1; dy = y2 - y1;
            //   _rotation = Math.atan2(dy,dx) * 57.29746936176985;
            //   longueur = Math.sqrt(dx*dx + dy*dy);
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;

            const x1 = cellFrom?.x ?? 0;
            const y1 = (cellFrom?.y ?? 0) - 20;
            const x2 = cellTo?.x ?? 0;
            const y2 = (cellTo?.y ?? 0) - 20;

            clip.x = x1;
            clip.y = y1;

            const dx = x2 - x1;
            const dy = y2 - y1;

            // AS stores degrees; runtime uses radians.
            clip.rotation = Math.atan2(dy, dx);

            const longueur = Math.sqrt(dx * dx + dy * dy);
            clip.vars.longueur = longueur;

            // Attach the inner beam strip (sprite_17). Its onLoad will
            // read clip.vars.longueur to set its width.
            clip.attach(this.sprite17Sym, "clip17", 1, ctx);
          },
        ],
      ]),
    };

    // ---- sprite_28 — impact explosion at target (51 frames) ----------
    // AS DefineSprite_28/frame_1/DoAction.as:
    //   _X = _parent.cellTo.x;
    //   _Y = _parent.cellTo.y - 20;
    //   _rotation = _parent.clip1._rotation;
    // AS DefineSprite_28/frame_10/DoAction.as:
    //   SOMA.playSound("vol");
    // AS DefineSprite_28/frame_10/DoAction_2.as:
    //   this.end();   ← signalHit
    // AS DefineSprite_28/frame_49/DoAction.as:
    //   stop();
    //   _parent.removeMovieClip();   ← complete
    this.sprite28Sym = {
      name: "sprite_28",
      totalFrames: 51,
      frames: textures.getFrames("sprite_28"),
      anchorX: sprite28Anchor.x,
      anchorY: sprite28Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_28/frame_1/DoAction.as:
            //   _X = _parent.cellTo.x;
            //   _Y = _parent.cellTo.y - 20;
            //   _rotation = _parent.clip1._rotation;
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;

            clip.x = cellTo?.x ?? 0;
            clip.y = (cellTo?.y ?? 0) - 20;

            // Copy rotation from clip1 (= sprite_19 instance).
            const clip1 = root?.children.get("clip1");
            if (clip1) {
              clip.rotation = clip1.rotation;
            }
          },
        ],
        [
          9,
          () => {
            // AS DefineSprite_28/frame_10/DoAction.as:
            //   SOMA.playSound("vol");
            this._playSound?.("vol");

            // AS DefineSprite_28/frame_10/DoAction_2.as:
            //   this.end();   ← signalHit
            this.runtime.signalHit();
          },
        ],
        [
          48,
          (clip) => {
            // AS DefineSprite_28/frame_49/DoAction.as:
            //   stop();
            //   _parent.removeMovieClip();
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite17Sym);
    this.registry.register(this.sprite19Sym);
    this.registry.register(this.sprite28Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture playSound for use inside frame scripts.
    this._playSound = callbacks.playSound;

    // Main timeline frame_2/DoAction.as: stop();
    // (Handled implicitly — the main timeline has no further playback.)

    // Attach sprite_19 as "clip1" (canonical AS instance name used by
    // sprite_28's frame_1 to read _parent.clip1._rotation).
    this.root.attach(this.sprite19Sym, "clip1", 1, context);

    // Attach sprite_28 as "clip2" (impact explosion at target).
    this.root.attach(this.sprite28Sym, "clip2", 2, context);
  }
}
