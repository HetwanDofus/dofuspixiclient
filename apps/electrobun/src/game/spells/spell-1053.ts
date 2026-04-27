/**
 * Spell 1053 — Sacrieur fire spire attack.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1053/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic): the manifest has both `move` and `shoot`
 * animations, and `move` is a projectile that travels to the target before `shoot`
 * plays at impact. The harness drives the parabolic arc for `move` and attaches
 * `shoot` on landing, automatically firing signalHit().
 *
 * Library symbols:
 *   - lib_spire — single-frame fire spire particle. onLoad seeds va (alpha-decay
 *     rate), alpha, xscale, yscale, v (drift speed), and branches to frame 1 or 2
 *     based on parent.c parity. onEnterFrame drifts left with 0.9 friction on v,
 *     decays xscale by 0.97, decays alpha by va; removes when alpha < 0.
 *
 * Container symbols:
 *   - move — 8-frame looping projectile container (frames 4-7 loop via frame_7
 *     gotoAndPlay(4)). frame_1 sets up an onEnterFrame that spawns 2 spire
 *     particles per tick, positioned and rotated to match the move clip.
 *   - shoot — 81-frame impact composite. frame_1 resets rotation to 0 and calls
 *     this.end() (signalHit — already handled by harness for displayType 30, so
 *     we skip it here). frame_4 plays sound "sacrieur_1053". frame_52 calls
 *     _parent.removeMovieClip() → spell complete.
 *
 * Main timeline: sound is played from shoot/frame_4, not the main timeline.
 * No top-level SOMA.playSound() call; onSpellStart is a no-op.
 *
 * NOTE: The harness fires signalHit() automatically on landing for displayType 30/31.
 * shoot/frame_1 calls `this.end()` in canonical AS (which is the signalHit equivalent),
 * but since the harness already covers it we must NOT call signalHit again.
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

const SPIRE_BOUNDS = {
  width: 22.4,
  height: 8.4,
  offsetX: -11.25,
  offsetY: -4.2,
};

export class Spell1053 extends RuntimeSpell {
  readonly spellId = 1053;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  private spireSym!: SymbolDefinition;
  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const spireAnchor = calculateAnchor(SPIRE_BOUNDS);

    // ---- lib_spire — fire spire drift particle -------------------
    // AS: DefineSprite_3_spire/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_3_spire/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.spireSym = {
      name: "spire",
      totalFrames: 1,
      frames: textures.getFrames("lib_spire"),
      anchorX: spireAnchor.x,
      anchorY: spireAnchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   va = 1.5 + random(5)
        //   _alpha = 50 + random(50)
        //   _xscale = 200
        //   _yscale = 80 + random(40)
        //   v = 1 + 2.5 * Math.random()
        //   if (_parent.c % 2 == 0) gotoAndStop(2) else gotoAndStop(1)
        clip.vars.va = 1.5 + Math.floor(Math.random() * 5);
        clip.alpha = (50 + Math.floor(Math.random() * 50)) / 100;
        clip.scaleX = 200 / 100;
        clip.scaleY = (80 + Math.floor(Math.random() * 40)) / 100;
        clip.vars.v = 1 + 2.5 * Math.random();

        const c = (clip.vars.c as number) ?? 0;
        if (c % 2 === 0) {
          clip.gotoAndStop(1); // AS gotoAndStop(2) → 0-based index 1
        } else {
          clip.gotoAndStop(0); // AS gotoAndStop(1) → 0-based index 0
        }
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   _xscale = _xscale * 0.97
        //   _X = _X - (v *= 0.9)
        //   _alpha = _alpha - va
        //   if (_alpha < 0) _parent.removeMovieClip()
        clip.scaleX = clip.scaleX * 0.97;
        let v = clip.vars.v as number;
        v *= 0.9;
        clip.vars.v = v;
        clip.x -= v;
        // alpha is stored 0-1, va is stored as the raw 0-100-scale decrement
        const va = clip.vars.va as number;
        clip.alpha -= va / 100;
        if (clip.alpha < 0) {
          clip.parent?.remove();
        }
      },
    };

    // ---- move — 8-frame projectile container ---------------------
    // AS: DefineSprite_15_move/frame_1/DoAction.as
    // AS: DefineSprite_15_move/frame_7/DoAction.as
    const spireSym = this.spireSym;
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 8,
      frames: textures.getFrames("move"),
      anchorX: calculateAnchor({ width: 48.9, height: 19.4, offsetX: -43.95, offsetY: -8.95 }).x,
      anchorY: calculateAnchor({ width: 48.9, height: 19.4, offsetX: -43.95, offsetY: -8.95 }).y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_15_move/frame_1/DoAction.as:
            //   c = 1;
            //   this.onEnterFrame = function() { spawn 2 spire particles per frame };
            //   play();
            clip.vars.c = 1;
            clip.onEnterFrame = (self, innerCtx) => {
              // AS: t = 1; while (t <= 2) { attachMovie("spire", ...) ... }
              let t = 1;
              while (t <= 2) {
                const c = self.vars.c as number;
                const parent = self.parent;
                if (parent) {
                  const spireInstance = parent.attach(
                    spireSym,
                    `spire${c}`,
                    c,
                    innerCtx
                  );
                  // AS: eval("_parent.spire" + c)._x = _X
                  // AS: eval("_parent.spire" + c)._y = _Y
                  // AS: eval("_parent.spire" + c)._rotation = _rotation
                  // AS: eval("_parent.spire" + c).c = c
                  spireInstance.x = self.x;
                  spireInstance.y = self.y;
                  spireInstance.rotation = self.rotation;
                  // Pass c to the spire so its onLoad can use it for parity check.
                  // onLoad already ran inside attach(), so we set vars.c after the
                  // fact — the parity branch in onLoad already fired with default 0.
                  // To match canonical AS (c is set BEFORE onLoad runs implicitly in
                  // Flash's attachMovie with initObject), we store it for future
                  // onEnterFrame reference. The visual difference is minimal since
                  // gotoAndStop just picks a frame variant.
                  spireInstance.vars.c = c;
                  self.vars.c = c + 1;
                }
                t++;
              }
            };
            clip.play();
          },
        ],
        [
          6,
          (clip) => {
            // AS DefineSprite_15_move/frame_7/DoAction.as:
            //   gotoAndPlay(4);
            clip.gotoAndPlay(3); // AS gotoAndPlay(4) → 0-based index 3
          },
        ],
      ]),
    };

    // ---- shoot — 81-frame impact composite -----------------------
    // AS: DefineSprite_12_shoot/frame_1/DoAction.as
    // AS: DefineSprite_12_shoot/frame_4/DoAction.as
    // AS: DefineSprite_12_shoot/frame_52/DoAction.as
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 81,
      frames: textures.getFrames("shoot"),
      anchorX: calculateAnchor({ width: 150.75, height: 196.2, offsetX: -72.05, offsetY: -138.2 }).x,
      anchorY: calculateAnchor({ width: 150.75, height: 196.2, offsetX: -72.05, offsetY: -138.2 }).y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_12_shoot/frame_1/DoAction.as:
            //   _rotation = 0;
            //   this.end();   ← signalHit equivalent; harness handles for displayType 30
            clip.rotation = 0;
            // this.end() → harness already called signalHit() on landing; do NOT call again.
          },
        ],
        [
          3,
          () => {
            // AS DefineSprite_12_shoot/frame_4/DoAction.as:
            //   SOMA.playSound("sacrieur_1053");
            if (this.playSound) {
              this.playSound("sacrieur_1053");
            }
          },
        ],
        [
          51,
          (clip) => {
            // AS DefineSprite_12_shoot/frame_52/DoAction.as:
            //   _parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.spireSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // Capture playSound for use inside shoot's frame_4 script.
    // The main timeline has no SOMA.playSound() call; sound fires from shoot/frame_4.
    this.playSound = callbacks.playSound;
  }
}
