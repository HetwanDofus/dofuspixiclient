/**
 * Spell 1053 — Sacrieur fire spell.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1053/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The spell has a `move` symbol that
 * loops frames 4-7 (a short 8-frame animated projectile), and a `shoot`
 * symbol (81-frame impact). The harness attaches `move` at caster,
 * rotates the container to face target, and attaches `shoot` at the
 * target offset. This matches the canonical VisualEffectHandler linear
 * projectile pattern.
 *
 * Library symbols:
 *   - spire — single-frame ember/spark particle. onLoad seeds va, alpha,
 *     xscale, yscale, v, and a gotoAndStop branch based on parent.c parity.
 *     onEnterFrame shrinks xscale by 0.97, drifts X by -v (with v*=0.9),
 *     fades alpha by va, removes when alpha < 0.
 *
 * Animations (non-library):
 *   - move  — 8-frame animated projectile looping frames 4-7.
 *             frame_1: sets up onEnterFrame to spawn 2 spire particles
 *               per tick at the move clip's position, rotated to match.
 *             frame_7: gotoAndPlay(4) to loop.
 *   - shoot — 81-frame composite impact.
 *             frame_1: _rotation = 0; this.end() → signalHit.
 *             frame_4: SOMA.playSound("sacrieur_1053").
 *             frame_52: _parent.removeMovieClip() → complete.
 *
 * Main timeline: sound is driven from shoot/frame_4. No explicit
 * onSpellStart sound needed (the harness attaches shoot, which fires
 * the sound from its own frame script). onSpellStart is a no-op here.
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

const MOVE_BOUNDS = {
  width: 48.9,
  height: 19.4,
  offsetX: -43.95,
  offsetY: -8.95,
};

const SHOOT_BOUNDS = {
  width: 150.75,
  height: 196.2,
  offsetX: -72.05,
  offsetY: -138.2,
};

export class Spell1053 extends RuntimeSpell {
  readonly spellId = 1053;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  // Keep a reference to spire so move's onEnterFrame can attach it
  private spireSym!: SymbolDefinition;

  // Callbacks captured in onSpellStart for use in frameScripts
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const spireAnchor = calculateAnchor(SPIRE_BOUNDS);
    const moveAnchor = calculateAnchor(MOVE_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- spire — ember/spark drift particle ----------------------
    // AS: DefineSprite_3_spire/frame_1/PlaceObject2_2_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    const spireSym: SymbolDefinition = {
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
        const c = (clip.parent?.vars.c as number) ?? 0;
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
        const va = clip.vars.va as number;
        const newAlpha = clip.alpha * 100 - va;
        clip.alpha = newAlpha / 100;
        if (newAlpha < 0) {
          clip.remove();
        }
      },
    };
    this.spireSym = spireSym;

    // ---- move — 8-frame animated projectile ----------------------
    // AS: DefineSprite_15_move/frame_1/DoAction.as
    //     DefineSprite_15_move/frame_7/DoAction.as
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 8,
      frames: textures.getFrames("move"),
      anchorX: moveAnchor.x,
      anchorY: moveAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_15_move/frame_1/DoAction.as:
            //   c = 1;
            //   this.onEnterFrame = function() {
            //     t = 1;
            //     while (t <= 2) {
            //       _parent.attachMovie("spire","spire"+c,c);
            //       eval("_parent.spire"+c)._x = _X;
            //       eval("_parent.spire"+c)._y = _Y;
            //       eval("_parent.spire"+c)._rotation = _rotation;
            //       eval("_parent.spire"+c).c = c;
            //       c++;
            //       t++;
            //     }
            //   };
            //   play();
            clip.vars.c = 1;
            clip.onEnterFrame = (self, innerCtx) => {
              let c = self.vars.c as number;
              const parent = self.parent;
              if (!parent) {
                return;
              }
              // Spawn 2 spire particles per tick at the move clip's position
              for (let t = 1; t <= 2; t++) {
                const instanceName = `spire${c}`;
                const spireClip = parent.attach(
                  spireSym,
                  instanceName,
                  c,
                  innerCtx,
                );
                spireClip.x = self.x;
                spireClip.y = self.y;
                spireClip.rotation = self.rotation;
                spireClip.vars.c = c;
                c++;
              }
              self.vars.c = c;
            };
            clip.play();
          },
        ],
        [
          6,
          (clip) => {
            // AS DefineSprite_15_move/frame_7/DoAction.as:
            //   gotoAndPlay(4)
            clip.gotoAndPlay(3); // AS 4 → 0-based 3
          },
        ],
      ]),
    };

    // ---- shoot — 81-frame impact composite -----------------------
    // AS: DefineSprite_12_shoot/frame_1/DoAction.as
    //     DefineSprite_12_shoot/frame_4/DoAction.as
    //     DefineSprite_12_shoot/frame_52/DoAction.as
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 81,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_12_shoot/frame_1/DoAction.as:
            //   _rotation = 0;
            //   this.end();   → signalHit (damage popup)
            clip.rotation = 0;
            this.runtime.signalHit();
          },
        ],
        [
          3,
          () => {
            // AS DefineSprite_12_shoot/frame_4/DoAction.as:
            //   SOMA.playSound("sacrieur_1053");
            this.soundCallback?.("sacrieur_1053");
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

    this.registry.register(spireSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _ctx: SpellContext,
  ): void {
    // Capture the sound callback so shoot/frame_4 can fire it
    this.soundCallback = callbacks.playSound;
    // Main timeline for this spell has no explicit sound in frame_1
    // (the sound fires from shoot's frame_4 script). No additional
    // child attaches needed — the harness handles move + shoot for
    // displayType=20 (ProjectileLinear).
  }
}
