/**
 * Spell 2045 — (Unknown name, likely a Cra/archer projectile spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2045/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main timeline frame_2 does `stop()` and
 * places sprite_10 (the main animation) on the timeline with onClipEvent(load/enterFrame)
 * handlers. sprite_10 is positioned at cellFrom and moves toward cellTo over 45 frames.
 * sprite_10 itself is a 99-frame composite animation that:
 *   - At frame 46: plays a "pok" sound and calls this.end() (signalHit).
 *   - At frame 88: calls _parent.removeMovieClip() (spell complete).
 *
 * sprite_10 also contains sprite3 (lib_sprite3) placed at depth 1. sprite3 is a
 * "directlyDynamic: true" clipEvent symbol — on load it seeds a random rotation speed
 * `r`, and on each frame it increments rotation by `r`.
 *
 * The outer main timeline (frame_2/PlaceObject2_10_1) drives sprite_10's position:
 *   - onLoad: position at cellFrom, compute dx/dy toward cellTo (-20 y offset), t=0.
 *   - onEnterFrame: for 45 frames, advance by dx/dy each tick.
 *
 * Since the outer clip (sprite_10) is placed on the main timeline (not via attachMovie),
 * and the main timeline does WorldAbsolute-style positioning (_parent.cellFrom/cellTo),
 * displayType=50 (WorldAbsolute) is the correct choice. The harness sets root.vars with
 * cellFrom/cellTo/angle and the spell positions sprite_10 manually.
 *
 * Library symbols:
 *   - sprite_10 (DefineSprite_10, 99 frames): the main projectile composite.
 *     Contains sprite3 as a child. frame_46 plays "pok" + signalHit. frame_88 removes parent.
 *   - lib_sprite3 (DefineSprite_3, 1 frame): spinning particle placed inside sprite_10.
 *     onLoad seeds r = random(90). onEnterFrame: _rotation += r (spins continuously).
 *
 * Main timeline: frame_2/DoAction.as → stop(); plus PlaceObject2_10_1 which places
 * sprite_10 with the position-tracking clip events.
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

const SPRITE3_BOUNDS = {
  width: 10.95,
  height: 11.8,
  offsetX: -5.5,
  offsetY: -5.6,
};

const SPRITE10_BOUNDS = {
  width: 124.95,
  height: 185,
  offsetX: -65.55,
  offsetY: -157.6,
};

export class Spell2045 extends RuntimeSpell {
  readonly spellId = 2045;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite3Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private savedCallbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE3_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE10_BOUNDS);

    // ---- lib_sprite3 — spinning particle placed inside sprite_10 ---
    // AS: scripts/DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    //   r = random(90);
    // AS: scripts/DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + r;
    this.sprite3Sym = {
      name: "sprite3",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.r = Math.floor(Math.random() * 90);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation + r  (degrees → radians delta)
        const r = clip.vars.r as number;
        clip.rotation += (r * Math.PI) / 180;
      },
    };

    // ---- sprite_10 — 99-frame main projectile composite -----------
    // The main animation sprite. Placed on the main timeline with position
    // tracking clip events. Contains sprite3 as a child (placed at depth 1
    // via PlaceObject2 in its own timeline frame 0).
    //
    // AS DefineSprite_10/frame_46/DoAction.as:   SOMA.playSound("pok");
    // AS DefineSprite_10/frame_46/DoAction_2.as: this.end();
    // AS DefineSprite_10/frame_88/DoAction.as:   _parent.removeMovieClip();
    //
    // sprite3 is placed inside sprite_10 at depth 1 (parentSpriteId=10, frame=0).
    // We attach it in sprite_10's frameScripts[0] (frame_1 of sprite_10's timeline).
    this.sprite10Sym = {
      name: "sprite_10",
      totalFrames: 99,
      frames: textures.getFrames("sprite_10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place sprite3 child inside sprite_10 at depth 1.
            // AS: DefineSprite_3 is placed at frame_1 of DefineSprite_10 via PlaceObject2.
            // Initial matrix: translateX=-0.15, translateY=-112 (from placements[0]).
            clip.attach(this.sprite3Sym, "sprite3", 1, ctx, {
              x: -0.15,
              y: -112,
            });
          },
        ],
        [
          45,
          (clip) => {
            // AS DefineSprite_10/frame_46/DoAction.as:   SOMA.playSound("pok");
            // AS DefineSprite_10/frame_46/DoAction_2.as: this.end();
            // Sound was scheduled in manifest sounds[frame:45] — fire it here too
            // via the saved callback reference.
            this.savedCallbacks?.playSound("pok");
            // this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          87,
          (clip) => {
            // AS DefineSprite_10/frame_88/DoAction.as: _parent.removeMovieClip();
            // _parent of sprite_10 is root → complete the spell.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite3Sym);
    this.registry.register(this.sprite10Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Save callbacks so frame scripts can fire sounds.
    this.savedCallbacks = callbacks;

    // AS: scripts/frame_2/DoAction.as → stop(); (main timeline stops at frame 2)
    // AS: scripts/frame_2/PlaceObject2_10_1 places sprite_10 with position-tracking clip events.
    //
    // onClipEvent(load):
    //   _X = _parent.cellFrom.x;
    //   _Y = _parent.cellFrom.y;
    //   dx = (- _parent.cellFrom.x + _parent.cellTo.x) / 45;
    //   dy = (- _parent.cellFrom.y - 20 + _parent.cellTo.y) / 45;
    //   t = 0;
    //
    // onClipEvent(enterFrame):
    //   if(t++ < 45) { _X = _X + dx; _Y = _Y + dy; }
    //
    // We attach sprite_10 to root here. The onLoad/onEnterFrame for the
    // main-timeline clip events are implemented on the symbol itself.
    // However, since this is a PlaceObject2 on the MAIN timeline (not a
    // library symbol's own clip events), we implement the position tracking
    // directly on the sprite_10 symbol's onLoad/onEnterFrame below.
    //
    // Because registerSymbols is called before onSpellStart, we can
    // re-create the symbol with the position-tracking handlers by
    // attaching a wrapper approach — but the cleanest canonical port
    // is to use the onLoad/onEnterFrame on the sprite_10 SymbolDefinition
    // we already registered, since those correspond to the PlaceObject2
    // clip events that drive its position.
    //
    // We attach sprite_10 to root at depth 1.
    const sprite10WithTracking: SymbolDefinition = {
      name: "sprite_10",
      totalFrames: 99,
      frames: this.sprite10Sym.frames,
      anchorX: this.sprite10Sym.anchorX,
      anchorY: this.sprite10Sym.anchorY,
      frameScripts: this.sprite10Sym.frameScripts,
      onLoad: (clip) => {
        // AS scripts/frame_2/PlaceObject2_10_1/CLIPACTIONRECORD onClipEvent(load).as
        const root = clip.parent;
        const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
        const fromX = cellFrom?.x ?? 0;
        const fromY = cellFrom?.y ?? 0;
        const toX = cellTo?.x ?? 0;
        const toY = cellTo?.y ?? 0;
        clip.x = fromX;
        clip.y = fromY;
        clip.vars.dx = (-fromX + toX) / 45;
        clip.vars.dy = (-fromY - 20 + toY) / 45;
        clip.vars.t = 0;
      },
      onEnterFrame: (clip) => {
        // AS scripts/frame_2/PlaceObject2_10_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // if(t++ < 45) { _X = _X + dx; _Y = _Y + dy; }
        const t = clip.vars.t as number;
        if (t < 45) {
          const dx = clip.vars.dx as number;
          const dy = clip.vars.dy as number;
          clip.x += dx;
          clip.y += dy;
        }
        clip.vars.t = t + 1;
      },
    };

    // Re-register with the updated symbol (overrides the one from registerSymbols).
    this.registry.register(sprite10WithTracking);

    this.root.attach(sprite10WithTracking, "sprite_10", 1, context);
  }
}
