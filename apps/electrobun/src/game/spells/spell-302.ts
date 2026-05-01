/**
 * Spell 302 — Setag (Sram star/dagger attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/302/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile motion, no
 * caster-side effects, and no dual-anchor logic. The single outer sprite
 * (DefineSprite_9) is anchored at the target cell and runs entirely there.
 *
 * Canonical AS layout:
 *
 *   DefineSprite_9 — outer container, 349 frames:
 *     frame_1:   spawn 19 `etoiles` instances (c = 1..19).
 *     frame_64:  SOMA.playSound("setag_302").
 *     frame_316: this.end() → signalHit.
 *     frame_349: _parent._parent.removeMovieClip() → complete; stop().
 *
 *   DefineSprite_8_etoiles (lib_etoiles) — 144-frame star particle:
 *     frame_1:   scatter position randomly, gotoAndPlay(random(30)+1).
 *     frame_28:  contains PlaceObject2_5_2 (sprite5 placed at depth 2)
 *                with onClipEvent(load): gotoAndStop(random(_totalframes)+1).
 *     frame_88:  stop(); seed physics vars; install onEnterFrame for
 *                floating behaviour until tf frames elapsed, then play().
 *     frame_142: removeMovieClip(this); stop().
 *
 *   DefineSprite_7 (container inside etoiles, placed at depth 1):
 *     frame_1: _rotation = random(360).
 *
 *   DefineSprite_5 / sprite5 (lib_sprite5) — 9-frame twinkle particle,
 *     placed inside etoiles at frame 28 (depth 2):
 *     onClipEvent(load):      gotoAndStop(random(_totalframes) + 1).
 *     onClipEvent(enterFrame): _alpha = random(100).
 *
 * Library symbols:
 *   - lib_etoiles — 144-frame star. frame_1 scatters & seeks; frame_28
 *     attaches sprite5; frame_88 seeds floating physics & onEnterFrame;
 *     frame_142 removes self.
 *   - lib_sprite5 — 9-frame twinkle. onLoad jumps to random frame;
 *     onEnterFrame pulses alpha randomly.
 *
 * Main timeline (DefineSprite_9) is attached from onSpellStart as the
 * outer "sprite9" container. This has no matching librarySymbols entry
 * so it is a container-only symbol registered with frames: [].
 *
 * Note: DefineSprite_7 is placed on the etoiles authored timeline (not
 * dynamically attached via AS), so its _rotation = random(360) at frame_1
 * is authored into the pre-rendered SVG frames of lib_etoiles. We do NOT
 * need to separately register or attach DefineSprite_7 — it is baked into
 * the per-frame SVG rendering of the etoiles symbol.
 * The sprite5 clip IS dynamic (directlyDynamic: true, clipEvent handlers)
 * and MUST be attached at runtime from etoiles frame_28.
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

const SPRITE5_BOUNDS = {
  width: 17.4,
  height: 17.4,
  offsetX: -8.4,
  offsetY: -8.7,
};

export class Spell302 extends RuntimeSpell {
  readonly spellId = 302;
  readonly displayType = SpellDisplayType.TargetCell;

  private etoilesSym!: SymbolDefinition;
  private sprite5Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const etoilesAnchor = calculateAnchor(ETOILES_BOUNDS);
    const sprite5Anchor = calculateAnchor(SPRITE5_BOUNDS);

    // ---- lib_sprite5 — 9-frame twinkle particle -----------------
    // Placed inside etoiles at frame_28 (depth 2).
    //
    // onClipEvent(load):
    //   AS: scripts/DefineSprite_5/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   (the load handler is in DefineSprite_8_etoiles/frame_28/PlaceObject2_5_2/CLIPACTIONRECORD onClipEvent(load).as)
    //   gotoAndStop(random(_totalframes) + 1)  →  jump to random frame [0, 8]
    //
    // onEnterFrame:
    //   AS: scripts/DefineSprite_5/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _alpha = random(100)
    this.sprite5Sym = {
      name: "sprite5",
      totalFrames: 9,
      frames: textures.getFrames("lib_sprite5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_8_etoiles/frame_28/PlaceObject2_5_2/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndStop(random(_totalframes) + 1)
        const frame = Math.floor(Math.random() * 9); // 0-based: random(9) → [0,8]
        clip.gotoAndStop(frame);
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_5/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _alpha = random(100)
        clip.alpha = Math.floor(Math.random() * 100) / 100;
      },
    };

    // ---- lib_etoiles — 144-frame star particle ------------------
    // Spawned 19 times from DefineSprite_9 frame_1.
    //
    // frame_1 (index 0):
    //   AS: scripts/DefineSprite_8_etoiles/frame_1/DoAction.as
    //   _X = 140 * (Math.random() - 0.5)
    //   _Y = 50 * (Math.random() - 0.5)
    //   gotoAndPlay(random(30) + 1)  →  0-based: gotoAndPlay(random(30))
    //
    // frame_28 (index 27):
    //   AS: DefineSprite_8_etoiles/frame_28/PlaceObject2_5_2 places sprite5
    //   at depth 2 with matrix {translateX:0, translateY:-0.25}.
    //   We attach sprite5 here.
    //
    // frame_88 (index 87):
    //   AS: scripts/DefineSprite_8_etoiles/frame_88/DoAction.as
    //   stop(); seed physics; install onEnterFrame for floating
    //
    // frame_142 (index 141):
    //   AS: scripts/DefineSprite_8_etoiles/frame_142/DoAction.as
    //   removeMovieClip(this); stop()
    this.etoilesSym = {
      name: "etoiles",
      totalFrames: 144,
      frames: textures.getFrames("lib_etoiles"),
      anchorX: etoilesAnchor.x,
      anchorY: etoilesAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_8_etoiles/frame_1/DoAction.as
            // _X = 140 * (Math.random() - 0.5)
            // _Y = 50 * (Math.random() - 0.5)
            // gotoAndPlay(random(30) + 1)
            clip.x = 140 * (Math.random() - 0.5);
            clip.y = 50 * (Math.random() - 0.5);
            const seekFrame = Math.floor(Math.random() * 30); // gotoAndPlay(random(30)+1) → 0-based index random(30)
            clip.gotoAndPlay(seekFrame);
            void ctx; // suppress unused warning
          },
        ],
        [
          27,
          (clip, ctx) => {
            // AS: DefineSprite_8_etoiles/frame_28/PlaceObject2_5_2
            // Attach sprite5 at depth 2, translateY = -0.25
            clip.attach(this.sprite5Sym, "sprite5_instance", 2, ctx, {
              x: 0,
              y: -0.25,
            });
          },
        ],
        [
          87,
          (clip) => {
            // AS: DefineSprite_8_etoiles/frame_88/DoAction.as
            // stop();
            // accx = 0.1 + 0.1 * Math.random();
            // accy = 0.05;
            // t = 0;
            // tf = 90 + random(60);
            // vx = 0;
            // vy = -3 - 10 * Math.random();
            // end = 0;
            // this.onEnterFrame = function() { ... }
            clip.stop();
            clip.vars.accx = 0.1 + 0.1 * Math.random();
            clip.vars.accy = 0.05;
            clip.vars.t = 0;
            clip.vars.tf = 90 + Math.floor(Math.random() * 60);
            clip.vars.vx = 0;
            clip.vars.vy = -3 - 10 * Math.random();
            clip.vars.end = 0;
            clip.onEnterFrame = (c) => {
              // AS: DefineSprite_8_etoiles/frame_88/DoAction.as — onEnterFrame closure
              let vx = c.vars.vx as number;
              let vy = c.vars.vy as number;
              const accx = c.vars.accx as number;
              const accy = c.vars.accy as number;
              let t = c.vars.t as number;
              const tf = c.vars.tf as number;
              const end = c.vars.end as number;

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
              c.x = c.x + vx;
              c.y = c.y + vy;
              vx *= 0.9999;
              vy *= 0.9555;
              t++;
              if (t > tf && end !== 1) {
                c.play();
                c.vars.end = 1;
                // Clear the onEnterFrame so the timeline plays freely
                c.onEnterFrame = null;
              } else {
                c.vars.vx = vx;
                c.vars.vy = vy;
                c.vars.t = t;
              }
            };
          },
        ],
        [
          141,
          (clip) => {
            // AS: DefineSprite_8_etoiles/frame_142/DoAction.as
            // removeMovieClip(this); stop()
            clip.remove();
          },
        ],
      ]),
    };

    // ---- sprite9 — outer container, 349 frames ------------------
    // This is DefineSprite_9, the outermost spell sprite. It has no
    // matching librarySymbols entry (no attachMovie uses it by name),
    // so it is registered as a container-only symbol and attached
    // from onSpellStart.
    //
    // frame_1 (index 0):   spawn 19 etoiles instances
    // frame_64 (index 63): SOMA.playSound("setag_302")
    // frame_316 (index 315): this.end() → signalHit
    // frame_349 (index 348): _parent._parent.removeMovieClip() → complete; stop()
    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 349,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_9/frame_1/DoAction.as
            // c = 1; while (c < 20) { this.attachMovie("etoiles","etoiles"+c, c); c++; }
            for (let c = 1; c < 20; c++) {
              clip.attach(this.etoilesSym, `etoiles${c}`, c, ctx);
            }
          },
        ],
        [
          63,
          (_clip) => {
            // AS: DefineSprite_9/frame_64/DoAction.as
            // SOMA.playSound("setag_302")
            // Sound is triggered here mid-timeline. We capture the
            // callback reference in onSpellStart and call it here.
            this.soundCallback?.("setag_302");
          },
        ],
        [
          315,
          (_clip) => {
            // AS: DefineSprite_9/frame_316/DoAction.as
            // this.end() — signals damage popup at target
            this.runtime.signalHit();
          },
        ],
        [
          348,
          (clip) => {
            // AS: DefineSprite_9/frame_349/DoAction.as
            // _parent._parent.removeMovieClip(); stop()
            // The outer mc is the root; signal completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite5Sym);
    this.registry.register(this.etoilesSym);
    this.registry.register(this.sprite9Sym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use in frame_64 script of sprite9.
    this.soundCallback = callbacks.playSound;
    // Attach the outer container sprite9 at depth 1.
    // The main timeline implicitly places DefineSprite_9 at frame 1.
    this.root.attach(this.sprite9Sym, "sprite9", 1, context);
  }
}
