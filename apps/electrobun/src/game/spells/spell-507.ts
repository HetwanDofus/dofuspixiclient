/**
 * Spell 507 — Invocation d'Archimonstre (Eniripsa/Xelor stars spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/507/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile, no caster reference,
 * and no dual-anchor logic. A single composite fires at the target cell.
 * The outermost container (DefineSprite_23) lives 247 frames, spawns 58 "etoiles"
 * library-symbol instances at frame_7 (frame index 6), plays a sound at frame_13
 * (frame index 12), and removes the parent at frame_247 (frame index 246).
 *
 * Canonical AS layout:
 *
 *   DefineSprite_23 — outer 247-frame container (no authored textures):
 *     frame_7  (index 6):  attach "etoiles" × 58 (c from 2 to 59)
 *     frame_13 (index 12): SOMA.playSound("many_507")
 *     frame_247(index 246): _parent._parent.removeMovieClip(); stop()
 *       → signals spell complete
 *
 *   lib_etoiles (DefineSprite_16_etoiles, 57 frames):
 *     frame_1  (index 0):  randomise _X/_Y, gotoAndPlay(random(15)+1)
 *     frame_13 (index 12): stop(); set up onEnterFrame physics (vy drift + resume play)
 *     frame_55 (index 54): removeMovieClip(this); stop()
 *
 *     Contains two authored placed children:
 *       PlaceObject2_13_2 at frame_7 (index 6) — an inner sprite whose
 *         onClipEvent(load) does gotoAndStop(random(_totalframes)+1).
 *         This inner sprite is DefineSprite_13 which itself contains:
 *           PlaceObject2_9_1 onEnterFrame: _alpha = random(100)   [frame_1]
 *           PlaceObject2_12_1 onLoad:      vr = -12.5 + random(33) [frame_13]
 *           PlaceObject2_12_1 onEnterFrame: _rotation += vr         [frame_13]
 *
 *   DefineSprite_6_or — gold/ore particle (not referenced by attachMovie in any
 *     script that we wire up; it appears as an authored timeline child inside
 *     lib_etoiles or the outer container — registered for completeness but the
 *     runtime will only instantiate it if attachMovie("or",...) is called).
 *
 *   DefineSprite_3_pierres — stone particle (same note as above).
 *
 *   DefineSprite_15 — small sprite whose frame_1 does _rotation = random(360).
 *
 *   DefineSprite_20_terre — earth particle with gravity onEnterFrame.
 *
 * The only attachMovie we can directly instrument is "etoiles" in DefineSprite_23/
 * frame_7. The other symbols (or, pierres, terre, the inner sprite_13, sprite_15)
 * are authored PlaceObject children within lib_etoiles / its descendants; the
 * runtime drives them via the lib_etoiles symbol's own frameScripts.
 *
 * Because lib_etoiles is a composite asset (isComposite=true in the manifest) the
 * per-frame textures already bake in those inner authored children. We therefore
 * model lib_etoiles as a single SymbolDefinition whose frameScripts/onEnterFrame
 * port only the scriptable behaviours:
 *   - frame_1 random offset + gotoAndPlay
 *   - frame_13 vy drift onEnterFrame + deferred play resume
 *   - frame_55 self-removal
 *
 * signalHit fires at DefineSprite_23/frame_13 (the sound frame, canonical impact).
 *
 * Library symbols registered:
 *   - "etoiles" — 57-frame star burst composite. frame_1 randomises position/
 *     playhead. frame_13 parks playhead and starts vy drift. frame_55 removes self.
 *
 * Main timeline: no authored top-level script (the outermost display object IS
 * DefineSprite_23 attached as child of root). We attach it from onSpellStart.
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
  width: 82.55,
  height: 95.7,
  offsetX: -44.7,
  offsetY: -57.15,
};

export class Spell507 extends RuntimeSpell {
  readonly spellId = 507;
  readonly displayType = SpellDisplayType.TargetCell;

  private etoilesSym!: SymbolDefinition;
  private outerSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const etoilesAnchor = calculateAnchor(ETOILES_BOUNDS);

    // ---- lib_etoiles — 57-frame star burst composite ----------------
    // Textures bake all authored inner children (sprite_13, sprite_15,
    // or, pierres, terre) so we only need to port the scripted behaviours
    // that live in DefineSprite_16_etoiles itself.
    this.etoilesSym = {
      name: "etoiles",
      totalFrames: 57,
      frames: textures.getFrames("lib_etoiles"),
      anchorX: etoilesAnchor.x,
      anchorY: etoilesAnchor.y,
      frameScripts: new Map([
        [
          // AS: DefineSprite_16_etoiles/frame_1/DoAction.as
          // _X = 140 * (Math.random() - 0.5);
          // _Y = 70 * (Math.random() - 0.5);
          // gotoAndPlay(random(15) + 1);
          0,
          (clip) => {
            clip.x = 140 * (Math.random() - 0.5);
            clip.y = 70 * (Math.random() - 0.5);
            // AS gotoAndPlay(random(15) + 1) — 1-based → 0-based: random(15)
            clip.gotoAndPlay(Math.floor(Math.random() * 15));
          },
        ],
        [
          // AS: DefineSprite_16_etoiles/frame_13/DoAction.as
          // stop();
          // accy = 0.3;
          // tf = 30 + random(90);
          // vy = -3 * Math.random();
          // t = 0;
          // this.onEnterFrame = function() { _Y += vy; vy *= 0.9; if(t++ > tf & end != 1){ play(); end = 1; } }
          12,
          (clip) => {
            clip.stop();
            clip.vars.vy = -3 * Math.random();
            clip.vars.tf = 30 + Math.floor(Math.random() * 90);
            clip.vars.t = 0;
            clip.vars.end = 0;
            clip.onEnterFrame = (c) => {
              // AS: DefineSprite_16_etoiles/frame_13/DoAction.as (onEnterFrame closure)
              const vy = c.vars.vy as number;
              let t = c.vars.t as number;
              const tf = c.vars.tf as number;
              const end = c.vars.end as number;

              c.y += vy;
              c.vars.vy = vy * 0.9;
              if (t++ > tf && end !== 1) {
                c.play();
                c.vars.end = 1;
              }
              c.vars.t = t;
            };
          },
        ],
        [
          // AS: DefineSprite_16_etoiles/frame_55/DoAction.as
          // removeMovieClip(this); stop();
          54,
          (clip) => {
            clip.remove();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- outer container (DefineSprite_23) — 247-frame orchestrator ----
    // No authored textures; drives attachMovie("etoiles",...), playSound,
    // and final removal.
    this.outerSym = {
      name: "outer",
      totalFrames: 247,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          // AS: DefineSprite_23/frame_7/DoAction.as
          // c = 2; while(c < 60){ this.attachMovie("etoiles","etoiles" + c, c); c++; }
          6,
          (clip, ctx) => {
            for (let c = 2; c < 60; c++) {
              clip.attach(this.etoilesSym, `etoiles${c}`, c, ctx);
            }
          },
        ],
        [
          // AS: DefineSprite_23/frame_13/DoAction.as
          // SOMA.playSound("many_507");
          // (sound is played via captured callback — see onSpellStart)
          // Also the canonical hit frame — signal hit here.
          12,
          () => {
            this.soundCallback?.("many_507");
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_23/frame_247/DoAction.as
          // _parent._parent.removeMovieClip(); stop();
          // _parent._parent of DefineSprite_23 = the outer mc = our root
          246,
          (clip) => {
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.etoilesSym);
    this.registry.register(this.outerSym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use from within frameScripts
    this.soundCallback = callbacks.playSound;

    // The top-level content is DefineSprite_23 placed on the main timeline.
    // Attach it at the root so it starts ticking from the next runtime frame.
    this.root.attach(this.outerSym, "outer", 1, context);
  }
}
