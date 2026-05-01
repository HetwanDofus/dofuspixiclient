/**
 * Spell 211 — Croque-mitaine (Osamodas / Crockette attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/211/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main-timeline frame_2 script reads
 * `_parent.cellFrom` and `_parent.cellTo` to position child clips at world
 * coordinates. The outer PlaceObject2_22_1 onClipEvent(load) places sprite_22
 * at cellFrom, rotates it toward cellTo, and positions clac (sprite_28) at
 * cellTo — the canonical dual-anchor WorldAbsolute pattern.
 *
 * Canonical AS layout:
 *   - DefineSprite_28 (sprite_28, "clac"): 114-frame impact composite at target.
 *       frame_37: this.end() → signalHit + SOMA.playSound("crockette_211").
 *       frame_112: _parent.removeMovieClip() → spell complete.
 *   - DefineSprite_22 (sprite_22, "beam"): 93-frame composite body from caster
 *       to target. Placed via PlaceObject2_22_1 with onClipEvent(load) that
 *       computes x1/y1/x2/y2/dx/dy/d/rotation and positions itself + clac.
 *   - DefineSprite_21 (sprite_21): 93-frame animated body sub-sprite, child of
 *       sprite_22 via PlaceObject2_21_1. onClipEvent(load): _width = _parent.d / 4.5.
 *       frame_67: stop().
 *
 * Main timeline: frame_2/DoAction.as → stop(). No sound on main timeline;
 * sound fires from sprite_28 frame_37.
 *
 * Library symbols: none in librarySymbols[]; all three appear in animations[].
 * Texture keys use bare names (no lib_ prefix).
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

const SPRITE_21_BOUNDS = {
  width: 394.8,
  height: 95.35,
  offsetX: -9.35,
  offsetY: -53.8,
};

const SPRITE_22_BOUNDS = {
  width: 224.9,
  height: 95.35,
  offsetX: 1.75,
  offsetY: -53.95,
};

const SPRITE_28_BOUNDS = {
  width: 59,
  height: 49.75,
  offsetX: -27.35,
  offsetY: -24.25,
};

export class Spell211 extends RuntimeSpell {
  readonly spellId = 211;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite21Sym!: SymbolDefinition;
  private sprite22Sym!: SymbolDefinition;
  private sprite28Sym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite21Anchor = calculateAnchor(SPRITE_21_BOUNDS);
    const sprite22Anchor = calculateAnchor(SPRITE_22_BOUNDS);
    const sprite28Anchor = calculateAnchor(SPRITE_28_BOUNDS);

    // ---- sprite_21 — animated body sub-sprite (child of sprite_22) ----
    // Placed inside sprite_22 via PlaceObject2_21_1.
    // AS DefineSprite_22/frame_1/PlaceObject2_21_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   _width = _parent.d / 4.5;
    // _width in Flash = scaleX * naturalWidth. We read d from parent.vars.d
    // (set by sprite_22's onLoad before attaching this child).
    // AS DefineSprite_21/frame_67/DoAction.as: stop()
    this.sprite21Sym = {
      name: "sprite_21",
      totalFrames: 93,
      frames: textures.getFrames("sprite_21"),
      anchorX: sprite21Anchor.x,
      anchorY: sprite21Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_22/frame_1/PlaceObject2_21_1/CLIPACTIONRECORD onClipEvent(load).as
        // _width = _parent.d / 4.5;
        const parent = clip.parent;
        const d = (parent?.vars.d as number) ?? 0;
        const naturalWidth = SPRITE_21_BOUNDS.width;
        if (naturalWidth > 0) {
          clip.scaleX = (d / 4.5) / naturalWidth;
        }
      },
      frameScripts: new Map([
        [
          66,
          (clip) => {
            // AS DefineSprite_21/frame_67/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_22 — beam/body from caster to target ----------------
    // AS frame_2/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   x1 = _parent.cellFrom.x;
    //   y1 = _parent.cellFrom.y - 20;
    //   x2 = _parent.cellTo.x;
    //   y2 = _parent.cellTo.y - 20;
    //   _parent.clac._x = x2;
    //   _parent.clac._y = y2;
    //   _X = x1; _Y = y1;
    //   dx = x2 - x1; dy = y2 - y1;
    //   d = Math.sqrt(dx*dx + dy*dy);
    //   _rotation = Math.atan2(dy,dx) * 180 / 3.1415;
    this.sprite22Sym = {
      name: "sprite_22",
      totalFrames: 93,
      frames: textures.getFrames("sprite_22"),
      anchorX: sprite22Anchor.x,
      anchorY: sprite22Anchor.y,
      onLoad: (clip, ctx) => {
        // AS frame_2/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(load).as
        const x1 = ctx.cellFrom.x;
        const y1 = ctx.cellFrom.y - 20;
        const x2 = ctx.cellTo.x;
        const y2 = ctx.cellTo.y - 20;

        clip.x = x1;
        clip.y = y1;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const d = Math.sqrt(dx * dx + dy * dy);
        clip.vars.d = d;

        // AS: _rotation = Math.atan2(dy,dx) * 180 / 3.1415 (degrees)
        // SpellClip uses radians directly.
        clip.rotation = Math.atan2(dy, dx);

        // AS: _parent.clac._x = x2; _parent.clac._y = y2;
        // Re-position the already-attached clac sprite at the target.
        const root = clip.parent;
        const clac = root?.children.get("clac");
        if (clac) {
          clac.x = x2;
          clac.y = y2;
        }

        // PlaceObject2_21_1 is authored at depth 1 inside sprite_22.
        // Attach sprite_21 now — its onLoad reads clip.vars.d set above.
        clip.attach(this.sprite21Sym, "sprite_21", 1, ctx);
      },
    };

    // ---- sprite_28 — impact ("clac") at target ----------------------
    // AS DefineSprite_28/frame_37/DoAction.as:
    //   this.end(); SOMA.playSound("crockette_211");
    // AS DefineSprite_28/frame_112/DoAction.as:
    //   _parent.removeMovieClip();
    this.sprite28Sym = {
      name: "sprite_28",
      totalFrames: 114,
      frames: textures.getFrames("sprite_28"),
      anchorX: sprite28Anchor.x,
      anchorY: sprite28Anchor.y,
      frameScripts: new Map([
        [
          36,
          (_clip) => {
            // AS DefineSprite_28/frame_37/DoAction.as:
            // this.end() → signalHit; SOMA.playSound("crockette_211")
            this.runtime.signalHit();
            this.soundCallback?.("crockette_211");
          },
        ],
        [
          111,
          (clip) => {
            // AS DefineSprite_28/frame_112/DoAction.as:
            // _parent.removeMovieClip() — ends the spell.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite21Sym);
    this.registry.register(this.sprite22Sym);
    this.registry.register(this.sprite28Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture playSound so frame scripts inside sprite_28 can invoke it.
    this.soundCallback = callbacks.playSound;

    // Attach clac (sprite_28) first at a default position so that
    // sprite_22's onLoad can find it by name and move it to x2/y2.
    this.root.attach(
      this.sprite28Sym,
      "clac",
      2,
      context,
      {
        x: context.cellTo.x,
        y: context.cellTo.y - 20,
      },
    );

    // Attach the beam (sprite_22). Its onLoad positions it at cellFrom,
    // computes d + rotation, repositions clac, then attaches sprite_21.
    this.root.attach(this.sprite22Sym, "beam", 1, context);
  }
}
