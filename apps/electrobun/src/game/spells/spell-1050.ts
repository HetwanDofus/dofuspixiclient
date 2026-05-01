/**
 * Spell 1050 — (Sacrieur spell, likely "Sanglante" or blood-drop attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1050/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main sprite (DefineSprite_7, mapped as
 * sprite_7 in animations[]) places itself at _parent.cellFrom.x / _parent.cellFrom.y
 * in its frame_1 script — this is the WorldAbsolute pattern where children
 * position themselves at absolute world coords via _parent.cellFrom / _parent.cellTo.
 *
 * Structure:
 *   - DefineSprite_7 (sprite_7, 78-frame container) — the outer timeline.
 *       frame_1 (DoAction.as):   SOMA.playSound("sacrieur_1050")
 *       frame_1 (DoAction_2.as): _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y;
 *                                 spawn 19 "goutte" particles (c=1..19).
 *       frame_43 (DoAction.as):  this.end() → signalHit
 *       frame_49 (DoAction.as):  SOMA.playSound("sacrieur_1050b")
 *       frame_76 (DoAction.as):  _parent.removeMovieClip(); stop(); → complete
 *
 *   - lib_goutte (DefineSprite_5_goutte, 1 frame wrapper) — wraps sprite4.
 *       frame_1/DoAction.as: vx = 7.5 * (-0.5 + Math.random()); vy = 3.75 * ...
 *                             onEnterFrame: _X += vx; _Y += vy;
 *       Directly hosts sprite4 (characterId=4) at depth 1, frame 0 via PlaceObject2.
 *
 *   - lib_sprite4 (DefineSprite_4, 30-frame animated drop, directlyDynamic=true) —
 *       the actual blood drop particle.
 *       frame_1/PlaceObject2_2_1/onClipEvent(load):
 *           _alpha = 50 + random(50); t = 50 + random(60); _xscale = _yscale = t
 *       frame_1/PlaceObject2_4_1/onClipEvent(load):
 *           stop(); _Y = -1; g = 0.67; f = -11 - 1.67 * Math.random()
 *       frame_1/PlaceObject2_4_1/onClipEvent(enterFrame):
 *           gravity simulation: while _Y < 0 integrate, then play() on landing
 *       frame_28/DoAction.as: stop()
 *
 * Library symbols:
 *   - goutte  — 1-frame wrapper. frame_1 seeds vx/vy, onEnterFrame drifts clip.
 *               Hosts sprite4 as a child (the inner animated drop).
 *   - sprite4 — 30-frame animated blood drop. onLoad sets alpha/scale (PlaceObject2_2_1)
 *               and gravity vars (PlaceObject2_4_1). onEnterFrame drives gravity arc.
 *               frame_27 stops.
 *
 * Main timeline (frame_2/DoAction.as): stop() — the outer SWF stops at frame 2.
 * We use displayType=50 (WorldAbsolute) because DefineSprite_7 reads
 * _parent.cellFrom.x / _parent.cellFrom.y directly in its frame_1 script.
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

// Bounds from manifest.json librarySymbols
const GOUTTE_BOUNDS = {
  width: 20.4,
  height: 17.4,
  offsetX: -10.2,
  offsetY: -12.3,
};

const SPRITE4_BOUNDS = {
  width: 20.4,
  height: 17.4,
  offsetX: -10.2,
  offsetY: -12.3,
};

export class Spell1050 extends RuntimeSpell {
  readonly spellId = 1050;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite4Sym!: SymbolDefinition;
  private goutteSym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const goutte_anchor = calculateAnchor(GOUTTE_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE4_BOUNDS);

    // ---- lib_sprite4 — 30-frame animated blood drop particle -----
    // This is DefineSprite_4 (characterId=4, directlyDynamic=true).
    //
    // onLoad ports TWO PlaceObject2 clip event loads:
    //   1. PlaceObject2_2_1/onClipEvent(load): alpha + scale randomization
    //   2. PlaceObject2_4_1/onClipEvent(load): gravity seed (_Y=-1, g, f)
    //
    // onEnterFrame ports PlaceObject2_4_1/onClipEvent(enterFrame): gravity arc.
    //
    // frame_28/DoAction.as: stop()
    this.sprite4Sym = {
      name: "sprite4",
      totalFrames: 30,
      frames: textures.getFrames("lib_sprite4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        // _alpha = 50 + random(50)
        // t = 50 + random(60)
        // _xscale = t; _yscale = t
        const alpha = 50 + Math.floor(Math.random() * 50);
        clip.alpha = alpha / 100;
        const t = 50 + Math.floor(Math.random() * 60);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;

        // AS: DefineSprite_5_goutte/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
        // stop(); _Y = -1; g = 0.67; f = -11 - 1.67 * Math.random()
        clip.stop();
        clip.y = -1;
        clip.vars.g = 0.67;
        clip.vars.f = -11 - 1.67 * Math.random();
        clip.vars.fin = 0;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_5_goutte/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // if (_Y < 0) { f += g; _Y = _Y + f; }
        // else if (fin != 1) { play(); fin = 1; _parent.vx = 0; _parent.vy = 0; }
        const g = clip.vars.g as number;
        let f = clip.vars.f as number;
        const fin = clip.vars.fin as number;

        if (clip.y < 0) {
          f += g;
          clip.y = clip.y + f;
          clip.vars.f = f;
        } else if (fin !== 1) {
          clip.play();
          clip.vars.fin = 1;
          // _parent.vx = 0; _parent.vy = 0 — zero out parent goutte drift
          if (clip.parent) {
            clip.parent.vars.vx = 0;
            clip.parent.vars.vy = 0;
          }
        }
      },
      frameScripts: new Map([
        [
          27,
          (clip) => {
            // AS: DefineSprite_4/frame_28/DoAction.as
            // stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- lib_goutte — 1-frame wrapper hosting sprite4 -----------
    // DefineSprite_5_goutte (characterId=5).
    // frame_1/DoAction.as: vx = 7.5 * (-0.5 + Math.random()); vy = 3.75 * ...
    //   this.onEnterFrame = function() { _X += vx; _Y += vy; }
    // Also places sprite4 (PlaceObject2 at depth 1, frame 0) with clip events.
    // The placement matrix is identity (translate 0,0), so no extra transform.
    this.goutteSym = {
      name: "goutte",
      totalFrames: 1,
      frames: textures.getFrames("lib_goutte"),
      anchorX: goutte_anchor.x,
      anchorY: goutte_anchor.y,
      onLoad: (clip, ctx) => {
        // AS: DefineSprite_5_goutte/frame_1/DoAction.as
        // vx = 7.5 * (-0.5 + Math.random())
        // vy = 3.75 * (-0.5 + Math.random())
        // this.onEnterFrame = function() { _X += vx; _Y += vy; }
        clip.vars.vx = 7.5 * (-0.5 + Math.random());
        clip.vars.vy = 3.75 * (-0.5 + Math.random());

        // Place sprite4 as a child (PlaceObject2 at depth 1, frame 0, identity matrix)
        // This mirrors the PlaceObject2_4_1 placement in DefineSprite_5_goutte.
        clip.attach(this.sprite4Sym, "sprite4_inner", 1, ctx, {
          x: 0,
          y: 0,
        });

        // Attach the onEnterFrame drift handler
        clip.onEnterFrame = (self) => {
          // AS: this.onEnterFrame — _X += vx; _Y += vy
          const vx = self.vars.vx as number;
          const vy = self.vars.vy as number;
          self.x += vx;
          self.y += vy;
        };
      },
    };

    // ---- sprite_7 — outer 78-frame container at cellFrom --------
    // DefineSprite_7 — the main animation timeline for this spell.
    // frame_1 (DoAction.as):   sound — handled in onSpellStart
    // frame_1 (DoAction_2.as): _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y;
    //                           spawn goutte c=1..19
    // frame_43:                 this.end() → signalHit
    // frame_49:                 SOMA.playSound("sacrieur_1050b")
    // frame_76:                 _parent.removeMovieClip(); stop(); → complete
    this.sprite7Sym = {
      name: "sprite_7",
      totalFrames: 78,
      frames: textures.getFrames("sprite_7"),
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_7/frame_1/DoAction_2.as
            // _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y;
            // c = 1; while (c < 20) { this.attachMovie("goutte","goutte"+c,c); c++; }
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y;
            }
            for (let c = 1; c < 20; c++) {
              clip.attach(this.goutteSym, `goutte${c}`, c, ctx);
            }
          },
        ],
        [
          42,
          () => {
            // AS: DefineSprite_7/frame_43/DoAction.as
            // this.end() → damage popup / hit signal
            this.runtime.signalHit();
          },
        ],
        [
          48,
          () => {
            // AS: DefineSprite_7/frame_49/DoAction.as
            // SOMA.playSound("sacrieur_1050b")
            this.soundCallback?.("sacrieur_1050b");
          },
        ],
        [
          75,
          (clip) => {
            // AS: DefineSprite_7/frame_76/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite4Sym);
    this.registry.register(this.goutteSym);
    this.registry.register(this.sprite7Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Capture sound callback for use inside frame scripts (frame_49)
    this.soundCallback = callbacks.playSound;

    // AS: DefineSprite_7/frame_1/DoAction.as
    // SOMA.playSound("sacrieur_1050")
    callbacks.playSound("sacrieur_1050");

    // main timeline frame_2/DoAction.as: stop()
    // Attach the sprite_7 container as the main child on root.
    // For WorldAbsolute, root is at (0,0); sprite_7 positions itself
    // at cellFrom in its own frame_1 script.
    this.root.attach(this.sprite7Sym, "sprite7", 1, context);
  }
}
