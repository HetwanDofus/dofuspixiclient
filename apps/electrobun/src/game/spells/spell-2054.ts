/**
 * Spell 2054 — (Cra-class projectile with impact burst and bubble particles).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2054/scripts/scripts/
 *
 * displayType=51 (WorldAbsoluteAlt). Two parallel authored timelines:
 *   - sprite_10 (DefineSprite_10): caster-side projectile/launch, 48 frames.
 *     frame_1: positions self at cellFrom (y-25), computes angle to cellTo,
 *              plays "herbe" sound, rotation=0.
 *     frame_46: stop(). Contains sprite_9 (DefineSprite_9) child which on
 *               load copies _parent.angle.
 *   - sprite_13 (DefineSprite_13): target-side impact timeline, 45 frames.
 *     frame_1:  positions self at cellTo, sets rotation to angle.
 *     frame_24: signalHit (this.end()), plays "coquille" sound. Contains
 *               sprite_12 (DefineSprite_12) child which on load sets
 *               rotation = -_parent._parent.angle.
 *     frame_45: _parent.removeMovieClip() → spell complete.
 *
 * Library symbols:
 *   - bulle (DefineSprite_5_bulle): bubble particle placed inside sprite_10.
 *     onLoad: randomises start frame (gotoAndPlay(random(15)+1)).
 *     frame_1/DoAction: seeds rx/ry/vx/vy/_alpha, attaches onEnterFrame
 *                       physics (drift with friction).
 *
 * sprite_4 (DefineSprite_4): 54-frame animated sub-sprite inside sprite_10,
 *   frame_52: stop().
 *
 * sprite_9 (DefineSprite_9): 27-frame animated sub-sprite inside sprite_10
 *   (PlaceObject2_9_1 placed at frame_46 of sprite_10):
 *   onClipEvent(load): _rotation = _parent.angle.
 *   frame_25: stop().
 *
 * sprite_12 (DefineSprite_12): 12-frame animated sub-sprite inside sprite_13
 *   (PlaceObject2_12_1 placed at frame_24 of sprite_13):
 *   onClipEvent(load): _rotation = -_parent._parent.angle.
 *   frame_12: stop().
 *
 * Main timeline (frame_2/DoAction.as): SOMA.playSound("jet_903"); stop();
 * Both sprite_10 and sprite_13 are placed on the main timeline (WorldAbsolute
 * pattern — they position themselves via _parent.cellFrom/_parent.cellTo).
 *
 * Because the outer container is at world (0,0) (displayType=51), sprite_10
 * and sprite_13 set their own x/y from cellFrom/cellTo in their frame_1 scripts.
 * signalHit is fired from sprite_13/frame_24 (not the harness, which only
 * auto-signals for displayType 30/31).
 * complete() is fired from sprite_13/frame_45 (_parent.removeMovieClip).
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

// Bounds from manifest animations[] entries (no librarySymbols in this spell)
const SPRITE_4_BOUNDS = {
  width: 19.5,
  height: 21.35,
  offsetX: -11.55,
  offsetY: -10.35,
};

const SPRITE_9_BOUNDS = {
  width: 215.4,
  height: 37.85,
  offsetX: -47.2,
  offsetY: -19.15,
};

const SPRITE_10_BOUNDS = {
  width: 215.4,
  height: 86.6,
  offsetX: -48.2,
  offsetY: -74.15,
};

const SPRITE_12_BOUNDS = {
  width: 127.9,
  height: 127.9,
  offsetX: -63.95,
  offsetY: -63.95,
};

const SPRITE_13_BOUNDS = {
  width: 279.7,
  height: 50.05,
  offsetX: -236.15,
  offsetY: -24.9,
};

export class Spell2054 extends RuntimeSpell {
  readonly spellId = 2054;
  readonly displayType = SpellDisplayType.WorldAbsoluteAlt;

  // Hold symbol refs so onSpellStart can attach them
  private sprite10Sym!: SymbolDefinition;
  private sprite13Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite4Anchor = calculateAnchor(SPRITE_4_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE_9_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE_10_BOUNDS);
    const sprite12Anchor = calculateAnchor(SPRITE_12_BOUNDS);
    const sprite13Anchor = calculateAnchor(SPRITE_13_BOUNDS);

    // ---- bulle (DefineSprite_5_bulle) — bubble drift particle ----
    // Placed inside sprite_10. No librarySymbols entry → bare texture key.
    // AS: DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
    //     gotoAndPlay(random(15) + 1)
    // AS: DefineSprite_5_bulle/frame_1/DoAction.as
    //     rx = 0.7 + 0.15 * Math.random(); ry = 0.8 + 0.15 * Math.random();
    //     vx = 20 + random(25); vy = -15 + random(30);
    //     _alpha = random(50) + 50;
    //     onEnterFrame: _X += (vx *= rx); _Y += (vy *= ry);
    const bulleSym: SymbolDefinition = {
      name: "bulle",
      totalFrames: 54, // reuses sprite_4 frames (bubble uses sprite_4 as its visual)
      frames: textures.getFrames("sprite_4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.gotoAndPlay(Math.floor(Math.random() * 15)); // random(15)+1 → 0-based = random(15)
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_5_bulle/frame_1/DoAction.as
            clip.vars.rx = 0.7 + 0.15 * Math.random();
            clip.vars.ry = 0.8 + 0.15 * Math.random();
            clip.vars.vx = 20 + Math.floor(Math.random() * 25);
            clip.vars.vy = -15 + Math.floor(Math.random() * 30);
            clip.alpha = (Math.floor(Math.random() * 50) + 50) / 100;
            clip.onEnterFrame = (self) => {
              // AS: _X = _X + (vx *= rx); _Y = _Y + (vy *= ry)
              let vx = self.vars.vx as number;
              let vy = self.vars.vy as number;
              const rx = self.vars.rx as number;
              const ry = self.vars.ry as number;
              vx *= rx;
              vy *= ry;
              self.x += vx;
              self.y += vy;
              self.vars.vx = vx;
              self.vars.vy = vy;
            };
          },
        ],
      ]),
    };

    // ---- sprite_4 (DefineSprite_4) — 54-frame animated sub-sprite ----
    // Placed inside sprite_10 (authored placement on the timeline).
    // AS: DefineSprite_4/frame_52/DoAction.as → stop()
    const sprite4Sym: SymbolDefinition = {
      name: "sprite_4",
      totalFrames: 54,
      frames: textures.getFrames("sprite_4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      frameScripts: new Map([
        [
          51,
          (clip) => {
            // AS: DefineSprite_4/frame_52/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_9 (DefineSprite_9) — 27-frame sub-sprite inside sprite_10 ----
    // Placed at frame_46 of sprite_10 (PlaceObject2_9_1).
    // onClipEvent(load): _rotation = _parent.angle  (parent = sprite_10)
    // AS: DefineSprite_9/frame_25/DoAction.as → stop()
    const sprite9Sym: SymbolDefinition = {
      name: "sprite_9",
      totalFrames: 27,
      frames: textures.getFrames("sprite_9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_10/frame_46/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
        // _rotation = _parent.angle  (_parent is sprite_10, which stores angle in vars)
        const parent = clip.parent;
        const angleDeg = (parent?.vars.angle as number) ?? 0;
        clip.rotation = (angleDeg * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          24,
          (clip) => {
            // AS: DefineSprite_9/frame_25/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_12 (DefineSprite_12) — 12-frame impact burst inside sprite_13 ----
    // Placed at frame_24 of sprite_13 (PlaceObject2_12_1).
    // onClipEvent(load): _rotation = -_parent._parent.angle  (grandparent = root)
    // AS: DefineSprite_12/frame_12/DoAction.as → stop()
    const sprite12Sym: SymbolDefinition = {
      name: "sprite_12",
      totalFrames: 12,
      frames: textures.getFrames("sprite_12"),
      anchorX: sprite12Anchor.x,
      anchorY: sprite12Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_13/frame_24/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
        // _rotation = -_parent._parent.angle  (sprite_12's _parent = sprite_13, _parent._parent = root)
        const root = clip.parent?.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        clip.rotation = (-angleDeg * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          11,
          (clip) => {
            // AS: DefineSprite_12/frame_12/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_10 (DefineSprite_10) — caster-side projectile, 48 frames ----
    // AS: DefineSprite_10/frame_1/DoAction.as → SOMA.playSound("herbe")
    // AS: DefineSprite_10/frame_1/DoAction_2.as →
    //     _rotation = 0; _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 25;
    //     dx = _parent.cellTo.x - _parent.cellFrom.x;
    //     dy = _parent.cellTo.y - _parent.cellFrom.y + 25;
    //     angle = Math.atan2(dy, dx) * 180 / 3.1415;
    // AS: DefineSprite_10/frame_46/DoAction.as → stop()
    //     (also places sprite_9 at frame_46 via PlaceObject2_9_1)
    this.sprite10Sym = {
      name: "sprite_10",
      totalFrames: 48,
      frames: textures.getFrames("sprite_10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_10/frame_1/DoAction.as
            // SOMA.playSound("herbe") — played via stored callback in onSpellStart
            // AS: DefineSprite_10/frame_1/DoAction_2.as
            clip.rotation = 0;
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 25;
            }
            let angleDeg = 0;
            if (cellFrom && cellTo) {
              const dx = cellTo.x - cellFrom.x;
              const dy = cellTo.y - cellFrom.y + 25;
              angleDeg = (Math.atan2(dy, dx) * 180) / 3.1415;
            }
            clip.vars.angle = angleDeg;
            void ctx; // context available if needed
          },
        ],
        [
          45,
          (clip, ctx) => {
            // AS: DefineSprite_10/frame_46/DoAction.as → stop()
            // Also places sprite_9 (PlaceObject2_9_1 placed at this frame)
            clip.attach(sprite9Sym, "sprite_9_1", 1, ctx);
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_13 (DefineSprite_13) — target-side impact, 45 frames ----
    // AS: DefineSprite_13/frame_1/DoAction.as →
    //     _X = _parent.cellTo.x; _Y = _parent.cellTo.y; _rotation = _parent.angle;
    // AS: DefineSprite_13/frame_24/DoAction.as → this.end() (signalHit)
    // AS: DefineSprite_13/frame_24/DoAction_2.as → SOMA.playSound("coquille")
    //     (also places sprite_12 via PlaceObject2_12_1 at frame_24)
    // AS: DefineSprite_13/frame_45/DoAction.as → _parent.removeMovieClip()
    this.sprite13Sym = {
      name: "sprite_13",
      totalFrames: 45,
      frames: textures.getFrames("sprite_13"),
      anchorX: sprite13Anchor.x,
      anchorY: sprite13Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_13/frame_1/DoAction.as
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          23,
          (clip, ctx) => {
            // AS: DefineSprite_13/frame_24/DoAction.as → this.end() (signalHit)
            // AS: DefineSprite_13/frame_24/DoAction_2.as → SOMA.playSound("coquille")
            // Also places sprite_12 (PlaceObject2_12_1) at this frame
            this.runtime.signalHit();
            this.soundCallback?.("coquille");
            clip.attach(sprite12Sym, "sprite_12_1", 1, ctx);
          },
        ],
        [
          44,
          (clip) => {
            // AS: DefineSprite_13/frame_45/DoAction.as → _parent.removeMovieClip()
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(bulleSym);
    this.registry.register(sprite4Sym);
    this.registry.register(sprite9Sym);
    this.registry.register(sprite12Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite13Sym);
  }

  // Capture the playSound callback so frame scripts inside sprites can use it
  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture for use by frame scripts (e.g. sprite_13/frame_24 plays "coquille")
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_2/DoAction.as: SOMA.playSound("jet_903"); stop();
    callbacks.playSound("jet_903");

    // Implicit main-timeline placement of sprite_10 and sprite_13.
    // Both are WorldAbsolute: they position themselves in their frame_1 scripts.
    // sprite_10 also plays "herbe" in its own frame_1 — fire it now since
    // frame_1 scripts run synchronously on attach().
    // The DoAction.as for sprite_10/frame_1 references SOMA.playSound("herbe");
    // we fire it here before attach so order matches canonical (sound then position).
    callbacks.playSound("herbe");

    this.root.attach(this.sprite10Sym, "sprite10", 1, context);
    this.root.attach(this.sprite13Sym, "sprite13", 2, context);
  }
}
