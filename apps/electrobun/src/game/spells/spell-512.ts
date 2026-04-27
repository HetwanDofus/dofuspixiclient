/**
 * Spell 512 — Éboulement (Sacrieur earth-rock impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/512/scripts/scripts/
 *
 * displayType=11 (TargetCell). The main animated content (sprite_42) positions
 * itself at _parent.cellTo in its own frame_1 DoAction_2.as, which is the
 * canonical target-cell pattern. No projectile motion, no caster reference,
 * no dual-anchored WorldAbsolute needed — the outer container sits at the
 * target cell and sprite_42 reads _parent.cellTo for its own placement (which
 * in TargetCell mode resolves to (0,0) since the container IS already at
 * cellTo). The sprite_27 sub-animation randomises its start frame.
 *
 * Library symbols:
 *   - lib_pierres — small rock/pebble particle. onLoad seeds vx, vy, scatter
 *     position on parent, scale, alpha, vertical velocity v, rotation velocity vr.
 *     onEnterFrame drives physics: horizontal drift, vertical arc, bounce on
 *     ground (Y=0), eventual rest (t=1 sentinel stops movement).
 *
 * Main timeline:
 *   - frame_2/DoAction.as: stop() — single-frame outer timeline.
 *
 * sprite_42 (213-frame, isComposite, target-anchored):
 *   - frame_1 DoAction.as:   SOMA.playSound("licrounch_1008")
 *   - frame_1 DoAction_2.as: _X = _parent.cellTo.x; _Y = _parent.cellTo.y
 *     (resolves to 0,0 in TargetCell mode since container is already at target)
 *   - frame_7:  PlaceObject2_6_7 (shake child) + PlaceObject2_10_9 (spinner child)
 *                come into existence; their clip events drive shake/spin.
 *   - frame_55 DoAction.as:  SOMA.playSound("many_512b")
 *   - frame_61 DoAction.as:  this.end() → signalHit
 *   - frame_61 PlaceObject2_35_12 onClipEvent(load): attach 7 "pierres" particles
 *   - frame_211 DoAction.as: _parent.removeMovieClip() → complete()
 *
 * sprite_27 (93-frame sub-animation inside sprite_42 composite):
 *   - frame_1 DoAction.as: gotoAndPlay(random(30)) → randomises loop start
 *
 * sprite_10 (2-frame sub-animation, the spinner visual inside sprite_42):
 *   Used by PlaceObject2_10_9's clip events to switch between frame 1 and 2
 *   based on |vr| > 100 threshold.
 *
 * Sounds: licrounch_1008 at frame_1, many_512b at frame_55 of sprite_42.
 * Both are fired from sprite_42 frameScripts; the outer onSpellStart has no
 * sound (frame_2/DoAction.as is just stop()).
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
  width: 6.4,
  height: 3.85,
  offsetX: -3.2,
  offsetY: -2.2,
};

const SPRITE27_BOUNDS = {
  width: 64.75,
  height: 46.25,
  offsetX: -29.8,
  offsetY: -43.6,
};

const SPRITE28_BOUNDS = {
  width: 106.55,
  height: 99.3,
  offsetX: -53.95,
  offsetY: -45.05,
};

const SPRITE42_BOUNDS = {
  width: 120.6,
  height: 163.35,
  offsetX: -60.4,
  offsetY: -142.55,
};

const SPRITE10_BOUNDS = {
  width: 33,
  height: 44,
  offsetX: -4.55,
  offsetY: -22.5,
};

export class Spell512 extends RuntimeSpell {
  readonly spellId = 512;
  readonly displayType = SpellDisplayType.TargetCell;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const sprite27Anchor = calculateAnchor(SPRITE27_BOUNDS);
    const sprite28Anchor = calculateAnchor(SPRITE28_BOUNDS);
    const sprite42Anchor = calculateAnchor(SPRITE42_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE10_BOUNDS);

    // ---- lib_pierres — rock/pebble particle ----------------------
    // onLoad: AS DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    // onEnterFrame: AS DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const pierresSym: SymbolDefinition = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS: vx = 5 * (Math.random() - 0.5)
        // AS: vy = 2 * (Math.random() - 0.5)
        // AS: _parent._x = 20 * (Math.random() - 0.5)
        // AS: _parent._y = 10 * (Math.random() - 0.5)
        // AS: t = 60 + 40 * Math.random()
        // AS: _xscale = t; _yscale = t
        // AS: _alpha = 20 + random(90)
        // AS: v = -5 * Math.random() - 5
        // AS: vr = 40 * (-0.5 + Math.random())
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
        clip.vars.v = -5 * Math.random() - 5;
        clip.vars.vr = 40 * (-0.5 + Math.random());
      },
      onEnterFrame: (clip) => {
        // AS: _parent._x += vx; _parent._y += vy
        // AS: if (t != 1) { _Y += v; _rotation += vr; v += 0.5; if (_Y > 0) { bounce / settle } }
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        const t = clip.vars.t as number;

        if (clip.parent) {
          clip.parent.x += vx;
          clip.parent.y += vy;
        }

        if (t !== 1) {
          let v = clip.vars.v as number;
          const vr = clip.vars.vr as number;

          clip.y += v;
          clip.rotation += (vr * Math.PI) / 180;
          v += 0.5;
          clip.vars.v = v;

          if (clip.y > 0) {
            clip.vars.vx = vx / 2;
            clip.vars.vy = vy / 2;
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

    // ---- sprite_10 — 2-frame spinner visual ----------------------
    // Used by PlaceObject2_10_9's enterFrame: switches gotoAndStop(1) or (2)
    // based on |vr| > 100. Registered so it can be resolved if needed as
    // a container child inside sprite_42 composite. Since it's an animations[]
    // entry (not a librarySymbol), we use bare name "sprite_10".
    const sprite10Sym: SymbolDefinition = {
      name: "sprite_10",
      totalFrames: 2,
      frames: textures.getFrames("sprite_10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
    };

    // ---- sprite_27 — 93-frame sub-animation (looping rock imagery) -
    // AS DefineSprite_27/frame_1/DoAction.as: gotoAndPlay(random(30))
    // Randomises start frame so multiple instances don't look synchronised.
    const sprite27Sym: SymbolDefinition = {
      name: "sprite_27",
      totalFrames: 93,
      frames: textures.getFrames("sprite_27"),
      anchorX: sprite27Anchor.x,
      anchorY: sprite27Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_27/frame_1/DoAction.as: gotoAndPlay(random(30))
            clip.gotoAndPlay(Math.floor(Math.random() * 30));
          },
        ],
      ]),
    };

    // ---- sprite_28 — 81-frame composite (part of sprite_42 visual) -
    // No authored scripts; purely visual content inside the composite.
    const sprite28Sym: SymbolDefinition = {
      name: "sprite_28",
      totalFrames: 81,
      frames: textures.getFrames("sprite_28"),
      anchorX: sprite28Anchor.x,
      anchorY: sprite28Anchor.y,
    };

    // ---- sprite_42 — 213-frame main composite, target-anchored ---
    // frame_1 DoAction.as:   SOMA.playSound("licrounch_1008")
    // frame_1 DoAction_2.as: _X = _parent.cellTo.x; _Y = _parent.cellTo.y
    //   (in TargetCell mode container IS at cellTo, so cellTo offset = 0,0)
    // frame_7: PlaceObject2_6_7 (shake) + PlaceObject2_10_9 (spinner) go live
    //   their clip events run from this frame forward — modelled as onEnterFrame
    //   handlers seeded in frame_7's frameScript.
    // frame_55 DoAction.as:  SOMA.playSound("many_512b")
    // frame_61 DoAction.as:  this.end() → signalHit
    // frame_61 PlaceObject2_35_12 onClipEvent(load): attach 7 pierres
    // frame_211 DoAction.as: _parent.removeMovieClip() → complete()
    //
    // The shake child (PlaceObject2_6_7) and spinner child (PlaceObject2_10_9)
    // are placed by the SWF at frame 7 as part of the composite. We model
    // them as vars on the clip and drive their behaviour from sprite_42's
    // own onEnterFrame (since they are authored children of the composite,
    // not separately attached via attachMovie). The shaker randomises X/Y
    // each frame; the spinner oscillates rotation and switches its visual
    // between two sub-frames.
    const sprite42Sym: SymbolDefinition = {
      name: "sprite_42",
      totalFrames: 213,
      frames: textures.getFrames("sprite_42"),
      anchorX: sprite42Anchor.x,
      anchorY: sprite42Anchor.y,
      onEnterFrame: (clip) => {
        // Drive the shake child (PlaceObject2_6_7) logic once it's live (frame>=7).
        // AS DefineSprite_42/frame_7/PlaceObject2_6_7/CLIPACTIONRECORD onClipEvent(enterFrame).as:
        //   _X = (Math.random() - 0.5) * 5; _Y = (Math.random() - 0.5) * 5 + y
        if (clip.currentFrame >= 6 && clip.vars.shakeActive) {
          const shakeY = clip.vars.shakeY as number;
          clip.vars.shakeOffsetX = (Math.random() - 0.5) * 5;
          clip.vars.shakeOffsetY = (Math.random() - 0.5) * 5 + shakeY;
        }

        // Drive the spinner child (PlaceObject2_10_9) logic once live (frame>=7).
        // AS DefineSprite_42/frame_7/PlaceObject2_10_9/CLIPACTIONRECORD onClipEvent(enterFrame).as:
        //   _rotation = _rotation + vr; vr = 46.6 * sin(i += random()); if (|vr|>100) gotoAndStop(2) else gotoAndStop(1)
        if (clip.currentFrame >= 6 && clip.vars.spinnerActive) {
          let spinnerRot = clip.vars.spinnerRot as number;
          let spinnerVr = clip.vars.spinnerVr as number;
          let spinnerI = clip.vars.spinnerI as number;
          spinnerI += Math.random();
          spinnerVr = 46.6 * Math.sin(spinnerI);
          spinnerRot += spinnerVr;
          clip.vars.spinnerRot = spinnerRot;
          clip.vars.spinnerVr = spinnerVr;
          clip.vars.spinnerI = spinnerI;
          // The visual switch (gotoAndStop 1 or 2) applies to the sub-sprite
          // inside the composite; modelled as a vars flag for rendering reference.
          if (Math.abs(spinnerVr) > 100) {
            clip.vars.spinnerFrame = 1; // frame 2 (0-based: 1)
          } else {
            clip.vars.spinnerFrame = 0; // frame 1 (0-based: 0)
          }
        }
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_42/frame_1/DoAction.as: SOMA.playSound("licrounch_1008")
            if (this.soundCallback) {
              this.soundCallback("licrounch_1008");
            }
            // AS DefineSprite_42/frame_1/DoAction_2.as:
            //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y
            // In TargetCell mode the container is already at cellTo, so
            // cellTo in local coords = (0, 0). Set explicitly for fidelity.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            const anchor = root?.vars.cellFrom as { x: number; y: number } | undefined;
            // For TargetCell, container origin IS at cellTo, so local offset = 0.
            // But to match the AS exactly: _X = cellTo.x, _Y = cellTo.y
            // means position in parent (root) coords. Root container is at cellTo,
            // so sprite_42 should be at (0,0) relative to root. cellTo - anchor
            // gives local. For TargetCell anchor = target, so delta = 0.
            if (cellTo && anchor) {
              clip.x = cellTo.x - anchor.x;
              clip.y = cellTo.y - anchor.y;
            } else {
              clip.x = 0;
              clip.y = 0;
            }
          },
        ],
        [
          6,
          (clip) => {
            // AS frame_7: PlaceObject2_6_7 (shake child) placed.
            // onClipEvent(load): y = _Y  → record current Y as baseline.
            // AS DefineSprite_42/frame_7/PlaceObject2_6_7/CLIPACTIONRECORD onClipEvent(load).as
            clip.vars.shakeActive = true;
            clip.vars.shakeY = clip.y;
            clip.vars.shakeOffsetX = 0;
            clip.vars.shakeOffsetY = 0;

            // AS frame_7: PlaceObject2_10_9 (spinner child) placed.
            // onClipEvent(load): i = 0
            // AS DefineSprite_42/frame_7/PlaceObject2_10_9/CLIPACTIONRECORD onClipEvent(load).as
            clip.vars.spinnerActive = true;
            clip.vars.spinnerI = 0;
            clip.vars.spinnerVr = 0;
            clip.vars.spinnerRot = 0;
            clip.vars.spinnerFrame = 0;
          },
        ],
        [
          54,
          () => {
            // AS DefineSprite_42/frame_55/DoAction.as: SOMA.playSound("many_512b")
            if (this.soundCallback) {
              this.soundCallback("many_512b");
            }
          },
        ],
        [
          60,
          (clip, ctx) => {
            // AS DefineSprite_42/frame_61/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();

            // AS DefineSprite_42/frame_61/PlaceObject2_35_12/CLIPACTIONRECORD onClipEvent(load).as:
            //   c = 0; while (c < 7) { this.attachMovie("pierres","pierres"+c,c); c++; }
            // The PlaceObject2_35_12 is a container placed at frame_61 inside the
            // sprite_42 composite. We model it as a direct child of clip (sprite_42)
            // with the pierres attached to it. Since we attach them directly on clip,
            // the parent._x/_y scatter in pierres onLoad will affect the clip-level
            // offset for each stone container — this matches the canonical structure.
            for (let c = 0; c < 7; c++) {
              clip.attach(pierresSym, `pierres${c}`, c, ctx);
            }
          },
        ],
        [
          210,
          (clip) => {
            // AS DefineSprite_42/frame_211/DoAction.as: _parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(pierresSym);
    this.registry.register(sprite10Sym);
    this.registry.register(sprite27Sym);
    this.registry.register(sprite28Sym);
    this.registry.register(sprite42Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback so frameScripts can fire sounds later.
    this.soundCallback = callbacks.playSound;

    // Main outer timeline: frame_2/DoAction.as is just stop() — no sound here.
    // sprite_42 is the sole authored child on the main timeline; attach it so
    // it starts ticking. Its own frame_1 scripts handle positioning + first sound.
    const sprite42Sym = this.registry.resolve("sprite_42");
    if (sprite42Sym) {
      this.root.attach(sprite42Sym, "sprite42", 1, context);
    }
  }
}
