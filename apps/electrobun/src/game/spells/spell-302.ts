/**
 * Spell 302 — Setag (Osamodas star spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/302/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile motion, no caster reference,
 * single impact at the target cell. The outer container (DefineSprite_9)
 * attaches 19 `etoiles` instances at frame_1, plays a sound at frame_64,
 * signals hit at frame_316, and removes itself at frame_349.
 *
 * Library symbols:
 *   - lib_etoiles (DefineSprite_8_etoiles, 144 frames) — star particle.
 *     frame_1: scatter position (_X ∈ [-70,70], _Y ∈ [-25,25]), jump to
 *              random start frame in [1,30].
 *     frame_28: inner sub-clip (DefineSprite_5) onClipEvent(load) jumps
 *               to a random frame of its own timeline; its inner-inner
 *               clip (DefineSprite_7, placed on the DefineSprite_5 timeline)
 *               has frame_1 that sets _rotation = random(360). The
 *               DefineSprite_5 clip's onEnterFrame randomises alpha each
 *               frame. These are authored visual children baked into the
 *               `lib_etoiles` frames, not runtime-spawned — no separate
 *               registration needed; they are composited into the SVG
 *               frame textures.
 *     frame_88: stop(); seed physics vars (accx, accy, vx, vy, t, tf, end);
 *               install onEnterFrame closure for drift physics; when
 *               t > tf resume playback.
 *     frame_142: removeMovieClip(this); stop(). — self-removal.
 *
 * Outer container (DefineSprite_9) — modelled as the root clip directly,
 * since configureHarness for TargetCell leaves root at (0,0) / anchor at
 * target. Its frame scripts are wired via the `outerSym` SymbolDefinition
 * which is attached as "outer" at depth 1 from onSpellStart.
 *
 * Main timeline (DefineSprite_9):
 *   frame_1:   attach 19 etoiles instances.
 *   frame_64:  SOMA.playSound("setag_302").
 *   frame_316: this.end() → signalHit.
 *   frame_349: _parent._parent.removeMovieClip() → complete.
 *
 * Sound: "setag_302" at frame 64 (0-based: 63).
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

const ETOILES_BOUNDS = {
  width: 65.45,
  height: 65.4,
  offsetX: -32.3,
  offsetY: -41.7,
};

export class Spell302 extends RuntimeSpell {
  readonly spellId = 302;
  readonly displayType = SpellDisplayType.TargetCell;

  // Capture sound callback so frame scripts inside outerSym can use it.
  private playSoundFn?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const etoilesAnchor = calculateAnchor(ETOILES_BOUNDS);

    // ---- lib_etoiles — star particle (144 frames) ----------------
    // Canonical AS scripts:
    //   DefineSprite_8_etoiles/frame_1/DoAction.as
    //   DefineSprite_8_etoiles/frame_88/DoAction.as
    //   DefineSprite_8_etoiles/frame_142/DoAction.as
    //   (frame_28 sub-clip events are baked into the SVG composites)
    const etoilesSym: SymbolDefinition = {
      name: "etoiles",
      totalFrames: 144,
      frames: textures.getFrames("lib_etoiles"),
      anchorX: etoilesAnchor.x,
      anchorY: etoilesAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_8_etoiles/frame_1/DoAction.as:
            //   _X = 140 * (Math.random() - 0.5);
            //   _Y = 50 * (Math.random() - 0.5);
            //   gotoAndPlay(random(30) + 1);
            clip.x = 140 * (Math.random() - 0.5);
            clip.y = 50 * (Math.random() - 0.5);
            // AS gotoAndPlay(random(30) + 1) — 1-based → 0-based
            const startFrame = Math.floor(Math.random() * 30);
            clip.gotoAndPlay(startFrame);
          },
        ],
        [
          87,
          (clip) => {
            // AS DefineSprite_8_etoiles/frame_88/DoAction.as:
            //   stop();
            //   accx = 0.1 + 0.1 * Math.random();
            //   accy = 0.05;
            //   t = 0;
            //   tf = 90 + random(60);
            //   vx = 0;
            //   vy = -3 - 10 * Math.random();
            //   end = 0;
            //   this.onEnterFrame = function() { ... };
            clip.stop();
            clip.vars.accx = 0.1 + 0.1 * Math.random();
            clip.vars.accy = 0.05;
            clip.vars.t = 0;
            clip.vars.tf = 90 + Math.floor(Math.random() * 60);
            clip.vars.vx = 0;
            clip.vars.vy = -3 - 10 * Math.random();
            clip.vars.end = 0;

            // Install the physics onEnterFrame (mirrors the AS closure).
            clip.onEnterFrame = (c) => {
              // AS DefineSprite_8_etoiles/frame_88/DoAction.as — onEnterFrame closure:
              //   if (_X < 0) vx += accx;
              //   if (_X > 0) vx -= accx;
              //   if (_Y < -20) vy += accy;
              //   if (_Y > -20) vy -= accy;
              //   _X += vx; _Y += vy;
              //   vx *= 0.9999; vy *= 0.9555;
              //   if (t++ > tf & end != 1) { play(); end = 1; }
              let vx = c.vars.vx as number;
              let vy = c.vars.vy as number;
              const accx = c.vars.accx as number;
              const accy = c.vars.accy as number;
              let t = c.vars.t as number;
              const tf = c.vars.tf as number;
              let end = c.vars.end as number;

              if (c.x < 0) {
                vx += accx;
              }
              if (c.x > 0) {
                vx -= accx;
              }
              if (c.y < -20) {
                vy += accy;
              }
              if (c.y > -20) {
                vy -= accy;
              }

              c.x += vx;
              c.y += vy;
              vx *= 0.9999;
              vy *= 0.9555;

              // AS: t++ > tf & end != 1
              // Bitwise & (not &&) — both conditions are evaluated.
              // In AS2 `&` on booleans is bitwise AND, equivalent here.
              if (t++ > tf && end !== 1) {
                c.play();
                end = 1;
              }

              c.vars.vx = vx;
              c.vars.vy = vy;
              c.vars.t = t;
              c.vars.end = end;
            };
          },
        ],
        [
          141,
          (clip) => {
            // AS DefineSprite_8_etoiles/frame_142/DoAction.as:
            //   removeMovieClip(this); stop();
            clip.remove();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- outerSym — models DefineSprite_9 (the driving container) -
    // Attached once to root from onSpellStart. Its 349-frame timeline
    // hosts the attach loop, sound cue, hit signal, and completion.
    // Container-only (no visual content of its own).
    const outerSym: SymbolDefinition = {
      name: "outer",
      totalFrames: 349,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_9/frame_1/DoAction.as:
            //   c = 1;
            //   while (c < 20) {
            //     this.attachMovie("etoiles", "etoiles" + c, c);
            //     c++;
            //   }
            for (let c = 1; c < 20; c++) {
              clip.attach(etoilesSym, `etoiles${c}`, c, ctx);
            }
          },
        ],
        [
          63,
          (_clip) => {
            // AS DefineSprite_9/frame_64/DoAction.as:
            //   SOMA.playSound("setag_302");
            this.playSoundFn?.("setag_302");
          },
        ],
        [
          315,
          (_clip) => {
            // AS DefineSprite_9/frame_316/DoAction.as:
            //   this.end() → signalHit (damage popup).
            this.runtime.signalHit();
          },
        ],
        [
          348,
          (clip) => {
            // AS DefineSprite_9/frame_349/DoAction.as:
            //   _parent._parent.removeMovieClip(); stop();
            // _parent._parent from DefineSprite_9's perspective is the
            // outer spell mc — equivalent to calling complete() here.
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(etoilesSym);
    this.registry.register(outerSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture playSound for use from frame scripts.
    this.playSoundFn = callbacks.playSound;

    // Attach the outer driving container at root depth 1.
    // The sound in the manifest is noted at frame 63 of DefineSprite_9,
    // handled by the outerSym frameScripts above.
    const outerSymDef = this.registry["symbols"]?.get("outer");
    // Resolve via the registry and attach.
    const sym = this.registry.resolve?.("outer");
    if (sym) {
      this.root.attach(sym, "outer", 1, context);
    }
  }
}
