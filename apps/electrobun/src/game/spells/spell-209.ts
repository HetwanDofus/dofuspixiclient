/**
 * Spell 209 — Tremblement de Terre (Feca earth tremor).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/209/scripts/scripts/
 *
 * displayType=11 (TargetCell). Single composite animation (anim1, 174 frames)
 * rendered at the target cell. No projectile, no caster reference — pure
 * impact-at-target pattern.
 *
 * Canonical AS layout:
 *   - DefineSprite_11 — outer container (174 frames / anim1 composite):
 *       frame_49  (idx 48): SOMA.playSound("grrr1")
 *       frame_55  (idx 54): place PlaceObject2_8_47 (a "pierres" container),
 *                           onLoad attaches 5 pierres particles
 *       frame_64  (idx 63): SOMA.playSound("grrr2") + place 4 more "pierres"
 *                           containers (PlaceObject2_8_7/15/23/31/39), each
 *                           onLoad attaches 5 pierres particles
 *       frame_70  (idx 69): place PlaceObject2_8_55, onLoad attaches 5 pierres
 *       frame_76  (idx 75): place PlaceObject2_8_63, onLoad attaches 5 pierres
 *       frame_124 (idx 123): this.end() → signalHit
 *       frame_148 (idx 147): install onEnterFrame that fades alpha by 10/frame
 *       frame_172 (idx 171): _parent.removeMovieClip(); stop() → complete
 *
 *   - DefineSprite_3_pierres — stone chip particle (1 frame):
 *       PlaceObject2_2_1/onClipEvent(load): seed vx,vy,t,v,vr,scale,alpha;
 *                                           scatter _parent._x/_y
 *       PlaceObject2_2_1/onClipEvent(enterFrame): gravity/bounce physics
 *
 * The "pierres container" pattern: the outer DefineSprite_11 places several
 * plain MovieClip instances (depth 7, 15, 23, 31, 39, 47, 55, 63) across
 * multiple frames. Each container's onClipEvent(load) calls
 * attachMovie("pierres", "pierres0"…"pierres4", 0…4) to spawn 5 stone
 * particles. The inner `PlaceObject2_2_1` clip events live ON the pierres
 * symbol instance, so they are the pierres symbol's own onLoad/onEnterFrame.
 *
 * We model each "pierres container" as a registered symbol ("pierresContainer")
 * whose onLoad immediately attaches 5 "pierres" children. The actual physics
 * are on the "pierres" symbol.
 *
 * Sounds declared in manifest: frame 48 → "grrr1", frame 63 → "grrr2".
 * These are fired from DefineSprite_11 frame scripts (frames 49 and 64 in
 * AS 1-based = indices 48 and 63 in 0-based).
 *
 * Main timeline (top-level): the manifest shows anim1 (isComposite=true,
 * 174 frames). The outer sprite DefineSprite_11 IS that composite — we
 * register it as a single symbol named "anim1" and attach it from
 * onSpellStart. No separate main-timeline sound beyond those embedded in
 * DefineSprite_11.
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

const PIERRES_BOUNDS = {
  width: 4.75,
  height: 2.3,
  offsetX: -2.4,
  offsetY: -1.7,
};

const ANIM1_BOUNDS = {
  width: 84.8,
  height: 82.8,
  offsetX: -44.7,
  offsetY: -39.85,
};

export class Spell209 extends RuntimeSpell {
  readonly spellId = 209;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold symbol refs for cross-symbol attachment in onLoad callbacks.
  private pierresSym!: SymbolDefinition;
  private pierresContainerSym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  // Capture callbacks reference for sounds played from frame scripts.
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- lib_pierres — stone chip particle -----------------------
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // The clip events live on the inner PlaceObject2_2_1 instance
    // (depth 1) placed inside the pierres symbol. In Flash the
    // PlaceObject2 instance IS the visual sprite — we model its
    // events directly as the pierres symbol's own onLoad/onEnterFrame.
    //
    // onLoad seeds:
    //   vx = 5*(random-0.5), vy = 2*(random-0.5)
    //   _parent._x = 20*(random-0.5) — scatter the container clip
    //   _parent._y = 10*(random-0.5)
    //   t = 60+40*random → scale and alpha seed
    //   _alpha = 20+random(90)
    //   v = -10*random-3      (upward velocity, negative Y)
    //   vr = 40*(-0.5+random) (rotation rate)
    //
    // Note: _parent._x/_y in the AS refers to the "pierres container"
    // clip (pierresContainer) that holds the pierres instance. We
    // implement this by writing to `clip.parent.x`/`clip.parent.y`.
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,

      onLoad: (clip) => {
        // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/onClipEvent(load)
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        if (clip.parent) {
          clip.parent.x = 20 * (Math.random() - 0.5);
          clip.parent.y = 10 * (Math.random() - 0.5);
        }
        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -10 * Math.random() - 3;
        clip.vars.vr = 40 * (-0.5 + Math.random());
      },

      onEnterFrame: (clip) => {
        // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/onClipEvent(enterFrame)
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        let v = clip.vars.v as number;
        const vr = clip.vars.vr as number;
        const t = clip.vars.t as number;

        // _parent._x += vx; _parent._y += vy
        if (clip.parent) {
          clip.parent.x += vx;
          clip.parent.y += vy;
        }

        if (t !== 1) {
          clip.y += v;
          clip.rotation += (vr * Math.PI) / 180;
          v += 0.5;
          clip.vars.v = v;

          if (clip.y > 0) {
            // Bounce: halve horizontal drift, zero rotation, reset Y
            const newVx = vx / 2;
            const newVy = vy / 2;
            clip.vars.vx = newVx;
            clip.vars.vy = newVy;
            if (clip.parent) {
              // Reflect the parent velocity as well
            }
            clip.rotation = 0;
            clip.y = 0;
            const newV = (-v) / 4;
            clip.vars.v = newV;
            if (Math.abs(newV) < 1) {
              clip.vars.vx = 0;
              clip.vars.vy = 0;
              clip.vars.t = 1;
            }
          }
        }
      },
    };

    // ---- pierresContainer — plain container that spawns 5 pierres --
    // AS: Each PlaceObject2_8_N (depths 7,15,23,31,39,47,55,63) placed
    // on DefineSprite_11's timeline has onClipEvent(load) that attaches
    // "pierres" x5 into itself. We register a container symbol for this
    // pattern — its onLoad reproduces that attachMovie loop.
    //
    // AS: DefineSprite_11/frame_64/PlaceObject2_8_7/onClipEvent(load)
    //     (and identical files at depths 15,23,31,39,47,55,63)
    this.pierresContainerSym = {
      name: "pierresContainer",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      onLoad: (clip, ctx) => {
        // AS: c = 0; while(c < 5){ attachMovie("pierres","pierres"+c,c); c++ }
        for (let c = 0; c < 5; c++) {
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
        }
      },
    };

    // ---- anim1 — outer 174-frame composite (DefineSprite_11) -----
    // This is the top-level timeline content. The manifest's anim1
    // composite frames are its visual backing; the frame scripts drive
    // the particle spawns, sounds, hit signal, fade and completion.
    //
    // Frame index map (AS 1-based → 0-based):
    //   frame_49  → idx 48: SOMA.playSound("grrr1")
    //   frame_55  → idx 54: place pierresContainer at depth 47
    //   frame_64  → idx 63: SOMA.playSound("grrr2") + place 5 containers
    //                        at depths 7,15,23,31,39
    //   frame_70  → idx 69: place pierresContainer at depth 55
    //   frame_76  → idx 75: place pierresContainer at depth 63
    //   frame_124 → idx 123: this.end() → signalHit
    //   frame_148 → idx 147: install per-frame fade (alpha -10/frame)
    //   frame_172 → idx 171: _parent.removeMovieClip(); stop() → complete
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 174,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      frameScripts: new Map([
        [
          48,
          (_clip) => {
            // AS: DefineSprite_11/frame_49/DoAction.as — SOMA.playSound("grrr1")
            this.soundCallback?.("grrr1");
          },
        ],
        [
          54,
          (clip, ctx) => {
            // AS: DefineSprite_11/frame_55 — PlaceObject2_8_47 onClipEvent(load)
            // Places a pierres container at depth 47.
            clip.attach(this.pierresContainerSym, "pc_47", 47, ctx);
          },
        ],
        [
          63,
          (clip, ctx) => {
            // AS: DefineSprite_11/frame_64/DoAction.as — SOMA.playSound("grrr2")
            // AS: DefineSprite_11/frame_64/PlaceObject2_8_7/15/23/31/39 onLoad
            // Places 5 pierres containers at depths 7,15,23,31,39.
            this.soundCallback?.("grrr2");
            clip.attach(this.pierresContainerSym, "pc_7", 7, ctx);
            clip.attach(this.pierresContainerSym, "pc_15", 15, ctx);
            clip.attach(this.pierresContainerSym, "pc_23", 23, ctx);
            clip.attach(this.pierresContainerSym, "pc_31", 31, ctx);
            clip.attach(this.pierresContainerSym, "pc_39", 39, ctx);
          },
        ],
        [
          69,
          (clip, ctx) => {
            // AS: DefineSprite_11/frame_70 — PlaceObject2_8_55 onClipEvent(load)
            clip.attach(this.pierresContainerSym, "pc_55", 55, ctx);
          },
        ],
        [
          75,
          (clip, ctx) => {
            // AS: DefineSprite_11/frame_76 — PlaceObject2_8_63 onClipEvent(load)
            clip.attach(this.pierresContainerSym, "pc_63", 63, ctx);
          },
        ],
        [
          123,
          (_clip) => {
            // AS: DefineSprite_11/frame_124/DoAction.as — this.end()
            this.runtime.signalHit();
          },
        ],
        [
          147,
          (clip) => {
            // AS: DefineSprite_11/frame_148/DoAction.as
            // this.onEnterFrame = function(){ _alpha = _alpha - 10; }
            // We install a clip-level onEnterFrame that decrements alpha.
            clip.onEnterFrame = (c) => {
              c.alpha = Math.max(0, c.alpha - 10 / 100);
            };
          },
        ],
        [
          171,
          (clip) => {
            // AS: DefineSprite_11/frame_172/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.pierresContainerSym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use from frame scripts.
    this.soundCallback = callbacks.playSound;

    // Attach the main composite timeline at the root.
    // displayType=11 means the harness places the container at the target
    // cell; we place anim1 at (0,0) within that container.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
