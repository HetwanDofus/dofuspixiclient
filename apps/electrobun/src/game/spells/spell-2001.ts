/**
 * Spell 2001 — Wabbit Explosion / Beam (Sadida-family, likely "Wab Explo").
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2001/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Both sprite_10 and sprite_19 read
 * `_parent.cellFrom` / `_parent.cellTo` to position themselves in world
 * coordinates, which is the definitive WorldAbsolute pattern.
 *
 * Canonical AS layout:
 *
 *   frame_2/DoAction.as — main timeline: stop() (frame 2 = index 1)
 *   Sound "wab_explo" fires on DefineSprite_10/frame_1 (the beam sprite)
 *   Sound "vol" fires on DefineSprite_19/frame_7 (the impact sprite)
 *
 *   sprite_8 (48 frames, stopFrame=45):
 *     - The beam "stretch" inner sprite.
 *     - Placed inside sprite_10 via PlaceObject2_8_1.
 *     - CLIPACTIONRECORD onClipEvent(load): `_width = _parent.longueur;`
 *       This stretches sprite_8 to the beam length computed by sprite_10.
 *     - frame_46/DoAction.as: stop() (= frameScripts index 45)
 *
 *   sprite_10 (144 frames, composite):
 *     - The beam sprite. Positions itself from cellFrom to cellTo, rotates
 *       to face the target, computes longueur (pixel distance).
 *     - frame_1/DoAction.as: SOMA.playSound("wab_explo")
 *     - frame_1/DoAction_2.as: positions self, computes rotation + longueur.
 *     - PlaceObject2_8_1 places sprite_8 inside this sprite on frame_1;
 *       sprite_8's onClipEvent(load) reads _parent.longueur to set its width.
 *
 *   sprite_19 (34 frames):
 *     - The impact explosion at cellTo.
 *     - frame_1/DoAction.as: `_X = _parent.cellTo.x; _Y = _parent.cellTo.y - 20;
 *       _rotation = _parent.clip1._rotation;`
 *     - frame_7/DoAction.as: SOMA.playSound("vol")
 *     - frame_7/DoAction_2.as: this.end() → signalHit
 *     - frame_33/DoAction.as: stop(); _parent.removeMovieClip() → complete()
 *
 * Note: `librarySymbols` is empty in the manifest. The animations list is
 * `sprite_8`, `sprite_10`, `sprite_19`. Texture keys are bare names (NO lib_ prefix).
 * sprite_8 is a child of sprite_10 in the SWF; sprite_10 and sprite_19 are
 * placed on the root main timeline.
 *
 * The main timeline has 2 frames; frame_2 is just stop(). Sounds are triggered
 * from within the sprite frame scripts, not from onSpellStart directly — EXCEPT
 * the manifest lists "wab_explo" at frame 0 (the beam's own frame_1 fires it).
 * We replicate by playing it when sprite_10's frame_1 script runs.
 *
 * signalHit: fired at sprite_19 frame_7 (= index 6).
 * complete():  fired at sprite_19 frame_33 (= index 32).
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

// sprite_8 bounds from manifest animations entry
const SPRITE_8_BOUNDS = {
  width: 224.15,
  height: 61.9,
  offsetX: 0,
  offsetY: -30.5,
};

// sprite_10 bounds from manifest animations entry
const SPRITE_10_BOUNDS = {
  width: 223.25,
  height: 61.65,
  offsetX: -0.4,
  offsetY: -30.1,
};

// sprite_19 bounds from manifest animations entry
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

  // Capture the callbacks so frame scripts inside symbols can play sounds.
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite8Anchor = calculateAnchor(SPRITE_8_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE_10_BOUNDS);
    const sprite19Anchor = calculateAnchor(SPRITE_19_BOUNDS);

    // ---- sprite_8 — beam-stretch inner sprite --------------------
    // Placed inside sprite_10 (PlaceObject2_8_1).
    // onClipEvent(load): `_width = _parent.longueur;`
    // In Pixi terms we implement "set width" as scaleX adjusted so that
    // the sprite's natural width (SPRITE_8_BOUNDS.width) maps to longueur.
    // frame_46/DoAction.as: stop() → frameScripts index 45.
    this.sprite8Sym = {
      name: "sprite_8",
      totalFrames: 48,
      frames: textures.getFrames("sprite_8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,

      // AS: DefineSprite_10/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load).as
      // _width = _parent.longueur;
      // We implement "set _width" by computing scaleX = longueur / naturalWidth.
      onLoad: (clip) => {
        const parent = clip.parent;
        const longueur = (parent?.vars.longueur as number) ?? 0;
        if (longueur > 0) {
          clip.scaleX = longueur / SPRITE_8_BOUNDS.width;
        }
      },

      frameScripts: new Map([
        [
          // AS: DefineSprite_8/frame_46/DoAction.as → stop()
          // frame_46 → index 45
          45,
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_10 — the beam (caster→target) --------------------
    // frame_1/DoAction.as:   SOMA.playSound("wab_explo")
    // frame_1/DoAction_2.as: position + rotation + longueur computation;
    //                         also attaches sprite_8 (PlaceObject2_8_1).
    this.sprite10Sym = {
      name: "sprite_10",
      totalFrames: 144,
      frames: textures.getFrames("sprite_10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,

      frameScripts: new Map([
        [
          // AS: DefineSprite_10/frame_1/DoAction.as + DoAction_2.as (both on frame 1 = index 0)
          0,
          (clip, ctx) => {
            // DoAction.as: SOMA.playSound("wab_explo")
            this.soundCallback?.("wab_explo");

            // DoAction_2.as:
            // x1 = _parent.cellFrom.x;
            // y1 = _parent.cellFrom.y - 20;
            // x2 = _parent.cellTo.x;
            // y2 = _parent.cellTo.y - 20;
            // _X = x1; _Y = y1;
            // dx = x2 - x1; dy = y2 - y1;
            // _rotation = Math.atan2(dy,dx) * 57.29746936176985;
            // longueur = Math.sqrt(dx * dx + dy * dy);
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

            // AS stores rotation in degrees; convert to radians for SpellClip.
            clip.rotation = Math.atan2(dy, dx);

            const longueur = Math.sqrt(dx * dx + dy * dy);
            clip.vars.longueur = longueur;

            // Attach sprite_8 (PlaceObject2_8_1) — placed on frame_1 of sprite_10.
            // sprite_8's onLoad will read clip.vars.longueur from this parent.
            clip.attach(this.sprite8Sym, "sprite8", 1, ctx);
          },
        ],
      ]),
    };

    // ---- sprite_19 — impact explosion at cellTo ------------------
    // frame_1/DoAction.as:  position at cellTo, inherit rotation from clip1
    // frame_7/DoAction.as:  SOMA.playSound("vol")
    // frame_7/DoAction_2.as: this.end() → signalHit
    // frame_33/DoAction.as: stop(); _parent.removeMovieClip() → complete()
    this.sprite19Sym = {
      name: "sprite_19",
      totalFrames: 34,
      frames: textures.getFrames("sprite_19"),
      anchorX: sprite19Anchor.x,
      anchorY: sprite19Anchor.y,

      frameScripts: new Map([
        [
          // AS: DefineSprite_19/frame_1/DoAction.as
          // _X = _parent.cellTo.x;
          // _Y = _parent.cellTo.y - 20;
          // _rotation = _parent.clip1._rotation;
          0,
          (clip) => {
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            clip.x = cellTo?.x ?? 0;
            clip.y = (cellTo?.y ?? 0) - 20;

            // _parent.clip1 is sprite_10 (attached as "clip1" in onSpellStart).
            // Inherit its rotation.
            const clip1 = root?.children.get("clip1");
            if (clip1) {
              clip.rotation = clip1.rotation;
            }
          },
        ],
        [
          // AS: DefineSprite_19/frame_7/DoAction.as  → SOMA.playSound("vol")
          //     DefineSprite_19/frame_7/DoAction_2.as → this.end() (signalHit)
          // frame_7 → index 6
          6,
          () => {
            this.soundCallback?.("vol");
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_19/frame_33/DoAction.as
          // stop(); _parent.removeMovieClip();
          // frame_33 → index 32
          32,
          (clip) => {
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite8Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite19Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture callbacks reference so frame scripts inside symbols can
    // play sounds (SOMA.playSound from within DefineSprite_10 and DefineSprite_19).
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_1 implicitly places sprite_10 (beam) as "clip1"
    // and sprite_19 (impact) as "clip2" at the root level.
    // frame_2/DoAction.as is just stop() — no further action needed.
    this.root.attach(this.sprite10Sym, "clip1", 1, context);
    this.root.attach(this.sprite19Sym, "clip2", 2, context);
  }
}
