/**
 * Spell 912 — Flèche Empoisonnée (Cra poison arrow).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/912/scripts/scripts/
 *
 * displayType=51 (WorldAbsoluteAlt). Two parallel authored timelines:
 *   - sprite_20  — caster-side timeline (45 frames): positions itself at
 *                  cellFrom on frame_1, rotated to face target; stops at
 *                  frame_43.
 *   - sprite_35  — target-side timeline (129 frames): positions itself at
 *                  cellTo on frame_1, rotated to angle; fires sound at
 *                  frame_10; signals hit + plays sound at frame_76;
 *                  removes outer mc at frame_127.
 *
 * sprite_35 embeds a child symbol (DefineSprite_27, canonically referenced
 * by sprite_35 but represented in the animations list as sprite_30). The
 * child (sprite_30) has its own authored 42-frame timeline with:
 *   frame_1: random rotation + scale; frame_40: stop().
 * Its placed instance (PlaceObject2_26_1 inside DefineSprite_27) carries
 * clip events:
 *   onLoad:      counter-rotate to cancel parent rotation.
 *   onEnterFrame: randomise alpha each frame (flicker).
 *
 * Because librarySymbols[] is empty in the manifest, there is NO lib_ prefix
 * anywhere — all textures use their bare animation names.
 *
 * Main timeline (frame_2/DoAction.as): SOMA.playSound("jet_903"); stop();
 * Both sprite_20 and sprite_35 are attached in onSpellStart mirroring the
 * implicit main-timeline PlaceObject2 placements.
 *
 * Sound schedule (canonical):
 *   frame_2  (main timeline) → "jet_903"
 *   frame_10 (sprite_35)     → "jet_912"
 *   frame_76 (sprite_35)     → "jet_912b"
 *
 * signalHit fires at sprite_35 frame_76 (this.end() in canonical AS).
 * complete() fires at sprite_35 frame_127 (_parent.removeMovieClip()).
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

const SPRITE_20_BOUNDS = {
  width: 186.6,
  height: 41.2,
  offsetX: 5.15,
  offsetY: -25.1,
};

const SPRITE_30_BOUNDS = {
  width: 75.05,
  height: 1.05,
  offsetX: 0,
  offsetY: -1.05,
};

const SPRITE_35_BOUNDS = {
  width: 147.8,
  height: 103,
  offsetX: -72.85,
  offsetY: -53.45,
};

export class Spell912 extends RuntimeSpell {
  readonly spellId = 912;
  readonly displayType = SpellDisplayType.WorldAbsoluteAlt;

  private sprite20Sym!: SymbolDefinition;
  private sprite30Sym!: SymbolDefinition;
  private sprite35Sym!: SymbolDefinition;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite20Anchor = calculateAnchor(SPRITE_20_BOUNDS);
    const sprite30Anchor = calculateAnchor(SPRITE_30_BOUNDS);
    const sprite35Anchor = calculateAnchor(SPRITE_35_BOUNDS);

    // ---- sprite_30 — flickering inner particle (DefineSprite_27 child) ----
    // PlaceObject2_26_1 inside DefineSprite_27 carries two clip events.
    //
    // AS: DefineSprite_27/frame_1/PlaceObject2_26_1/CLIPACTIONRECORD onClipEvent(load).as
    //   _rotation = -_parent._parent._rotation;
    //
    // AS: DefineSprite_27/frame_1/PlaceObject2_26_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _alpha = random(100) + 50;
    //
    // AS: DefineSprite_30/frame_1/DoAction.as
    //   _rotation = random(360);
    //   t = random(50) + 50;
    //   _xscale = t;
    //   _yscale = t;
    //
    // AS: DefineSprite_30/frame_40/DoAction.as
    //   stop();
    this.sprite30Sym = {
      name: "sprite_30",
      totalFrames: 42,
      frames: textures.getFrames("sprite_30"),
      anchorX: sprite30Anchor.x,
      anchorY: sprite30Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_30/frame_1/DoAction.as (initial placement actions)
        // and PlaceObject2_26_1/onClipEvent(load) counter-rotation.
        // frame_1 DoAction fires during attach() as frameScripts[0], so
        // onLoad handles the clip-event(load) counter-rotation only.
        // _rotation = -_parent._parent._rotation
        // clip.parent is sprite_35; sprite_35.rotation is in radians already.
        const grandparent = clip.parent;
        if (grandparent) {
          clip.rotation = -grandparent.rotation;
        }
      },
      onEnterFrame: (clip) => {
        // AS: PlaceObject2_26_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _alpha = random(100) + 50;
        // AS alpha 50-150 range → clamp to 0-1. Values > 100 in AS clamp to 100%.
        const rawAlpha = Math.floor(Math.random() * 100) + 50;
        clip.alpha = Math.min(rawAlpha, 100) / 100;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_30/frame_1/DoAction.as
            // _rotation = random(360);
            // t = random(50) + 50;
            // _xscale = t; _yscale = t;
            const rot = Math.floor(Math.random() * 360);
            clip.rotation = (rot * Math.PI) / 180;
            const t = Math.floor(Math.random() * 50) + 50;
            clip.vars.t = t;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
          },
        ],
        [
          39,
          (clip) => {
            // AS: DefineSprite_30/frame_40/DoAction.as
            // stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_20 — caster-side timeline (45 frames) ----------------------
    // AS: DefineSprite_20/frame_1/DoAction.as
    //   _X = _parent.cellFrom.x;
    //   _Y = _parent.cellFrom.y - 30;
    //   _rotation = _parent.angle;
    //
    // AS: DefineSprite_20/frame_43/DoAction.as
    //   stop();
    this.sprite20Sym = {
      name: "sprite_20",
      totalFrames: 45,
      frames: textures.getFrames("sprite_20"),
      anchorX: sprite20Anchor.x,
      anchorY: sprite20Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_20/frame_1/DoAction.as
            // _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 30;
            // _rotation = _parent.angle;
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 30;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          42,
          (clip) => {
            // AS: DefineSprite_20/frame_43/DoAction.as
            // stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_35 — target-side timeline (129 frames) ---------------------
    // AS: DefineSprite_35/frame_1/DoAction.as
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 30;
    //   _rotation = _parent.angle;
    //
    // AS: DefineSprite_35/frame_10/DoAction.as
    //   SOMA.playSound("jet_912");
    //
    // AS: DefineSprite_35/frame_76/DoAction.as
    //   SOMA.playSound("jet_912b");
    //
    // AS: DefineSprite_35/frame_76/DoAction_2.as
    //   this.end(); → signalHit
    //
    // AS: DefineSprite_35/frame_127/DoAction.as
    //   _parent.removeMovieClip(); → complete
    this.sprite35Sym = {
      name: "sprite_35",
      totalFrames: 129,
      frames: textures.getFrames("sprite_35"),
      anchorX: sprite35Anchor.x,
      anchorY: sprite35Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_35/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 30;
            // _rotation = _parent.angle;
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y - 30;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
            // DefineSprite_27 (the sprite_30 child container) is authored as
            // a placed instance inside sprite_35 from its first frame. We
            // attach it here so it starts ticking alongside the parent.
            clip.attach(this.sprite30Sym, "sprite_30_inst", 1, ctx);
          },
        ],
        [
          9,
          () => {
            // AS: DefineSprite_35/frame_10/DoAction.as
            // SOMA.playSound("jet_912");
            this.soundCallback?.("jet_912");
          },
        ],
        [
          75,
          () => {
            // AS: DefineSprite_35/frame_76/DoAction.as
            // SOMA.playSound("jet_912b");
            // AS: DefineSprite_35/frame_76/DoAction_2.as
            // this.end(); → signalHit
            this.soundCallback?.("jet_912b");
            this.runtime.signalHit();
          },
        ],
        [
          126,
          (clip) => {
            // AS: DefineSprite_35/frame_127/DoAction.as
            // _parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite30Sym);
    this.registry.register(this.sprite20Sym);
    this.registry.register(this.sprite35Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: scripts/frame_2/DoAction.as
    // SOMA.playSound("jet_903"); stop();
    this.soundCallback = callbacks.playSound;
    callbacks.playSound("jet_903");

    // Implicit main-timeline placement of sprite_20 (caster-side) and
    // sprite_35 (target-side) — mirrors the authored PlaceObject2 entries
    // on the main timeline that the AS compiler exposes as frame_1 placements.
    this.root.attach(this.sprite20Sym, "sprite20", 1, context);
    this.root.attach(this.sprite35Sym, "sprite35", 2, context);
  }
}
