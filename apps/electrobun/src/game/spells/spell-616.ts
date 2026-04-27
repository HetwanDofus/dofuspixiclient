/**
 * Spell 616 — Esquive (Dodge / Evasion).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/616/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Two parallel authored timelines:
 *   - sprite_20 (DefineSprite_20): anchored at _parent.cellFrom (caster side), 103 frames.
 *     frame_1: positions self at cellFrom, plays sound "dodge_616a".
 *     frame_103: stop().
 *   - sprite_33 (DefineSprite_33): anchored at _parent.cellTo (target side), 181 frames.
 *     frame_1: positions self at cellTo.
 *     frame_64: plays sound "dodge_616b".
 *     frame_97: this.end() → signalHit.
 *     frame_181: _parent.removeMovieClip() → complete().
 *
 * sprite_20 contains (as authored timeline children):
 *   - sprite_19 (DefineSprite_19): looping shimmer, frame_1 random-seeks, frame_61 stops.
 *   - sprite_8  (DefineSprite_8):  composite flash, frame_64 stops.
 *   - sprite_7  (DefineSprite_7):  small particle, frame_1 random-rotation/seek/alpha, frame_46 stops.
 *
 * sprite_33 contains (as authored timeline children):
 *   - sprite_32 (DefineSprite_32): large composite, frame_1 randomises rotation/scale/seek,
 *                                   frame_79 places sprite_31 (a spark container) with onClipEvent(load),
 *                                   frame_136 stops.
 *   - sprite_25 (DefineSprite_25): impact circle, frame_1 random rotation/scale, frame_13 stops.
 *
 * sprite_32 (DefineSprite_32) contains (at frame_79):
 *   - sprite_31 (DefineSprite_31): a wrapper around sprite_30 that picks a random start frame on load.
 *
 * sprite_31 (DefineSprite_31) contains:
 *   - sprite_30 (DefineSprite_30): a spark emitter. frame_1 seeds physics and installs onEnterFrame
 *                                   that moves sprite_29 (c) upward until it reaches threshold p.
 *
 * sprite_30 (DefineSprite_30) contains:
 *   - sprite_29 (DefineSprite_29): a small spark (c), placed at frame_1 with onClipEvent(load)
 *                                   seeding vrot/vrot2/i, and onClipEvent(enterFrame) fading
 *                                   alpha and oscillating xscale/rotation while _Y < p.
 *
 * The manifest has NO librarySymbols[] — all symbols appear only in animations[].
 * Therefore NO "lib_" prefix anywhere; all textures use bare animation names.
 *
 * Since sprite_20 and sprite_33 are placed by the main timeline (frame_1 is the
 * authored placement, frame_2/DoAction.as just does stop()), we attach them from
 * onSpellStart.
 *
 * NOTE: sprite_7, sprite_8, sprite_19 inside sprite_20, and sprite_25, sprite_31,
 * sprite_32 inside sprite_33 are authored timeline-placed children. In the runtime
 * model we represent them as child attaches from their parent's frameScripts[0]
 * (frame_1 entry). sprite_30 and sprite_29 are similarly nested under sprite_31.
 *
 * displayType=50 (WorldAbsolute): harness stores cellFrom/cellTo/angle on root.vars;
 * container sits at world (0,0); per-spell scripts position children at WORLD coords.
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

// ---- Bounds from manifest animations[] entries ----

const SPRITE_7_BOUNDS  = { width: 99,    height: 8.1,   offsetX: 0.3,    offsetY: -5.15  };
const SPRITE_8_BOUNDS  = { width: 124.35,height: 52.85, offsetX: -14.95, offsetY: -35.4  };
const SPRITE_19_BOUNDS = { width: 34.85, height: 108.05,offsetX: -14.35, offsetY: -106.6 };
const SPRITE_20_BOUNDS = { width: 157.5, height: 191.5, offsetX: -109.35,offsetY: -182.85};
const SPRITE_25_BOUNDS = { width: 104.7, height: 73.7,  offsetX: -51.15, offsetY: -36.65 };
const SPRITE_29_BOUNDS = { width: 19.45, height: 12.6,  offsetX: -9.7,   offsetY: -6.75  };
const SPRITE_32_BOUNDS = { width: 104.7, height: 157.3, offsetX: -48.2,  offsetY: -34.55 };
const SPRITE_33_BOUNDS = { width: 127,   height: 187.35,offsetX: -62.7,  offsetY: -159.6 };

export class Spell616 extends RuntimeSpell {
  readonly spellId = 616;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  // Symbol refs needed across methods
  private sprite7Sym!:  SymbolDefinition;
  private sprite8Sym!:  SymbolDefinition;
  private sprite19Sym!: SymbolDefinition;
  private sprite20Sym!: SymbolDefinition;
  private sprite25Sym!: SymbolDefinition;
  private sprite29Sym!: SymbolDefinition;
  private sprite32Sym!: SymbolDefinition;
  private sprite33Sym!: SymbolDefinition;

  // Sound callback captured at onSpellStart for use in frame scripts
  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const a7  = calculateAnchor(SPRITE_7_BOUNDS);
    const a8  = calculateAnchor(SPRITE_8_BOUNDS);
    const a19 = calculateAnchor(SPRITE_19_BOUNDS);
    const a20 = calculateAnchor(SPRITE_20_BOUNDS);
    const a25 = calculateAnchor(SPRITE_25_BOUNDS);
    const a29 = calculateAnchor(SPRITE_29_BOUNDS);
    const a32 = calculateAnchor(SPRITE_32_BOUNDS);
    const a33 = calculateAnchor(SPRITE_33_BOUNDS);

    // ----------------------------------------------------------------
    // sprite_29 — small spark "c" inside sprite_30
    // AS: DefineSprite_29/frame_1/DoAction.as
    //     gotoAndStop(random(4) + 1)
    // AS clip events on the PlaceObject2_29_1 inside sprite_30:
    //   onClipEvent(load): vrot/vrot2/i seeded there (handled in sprite_30 onLoad)
    //   onClipEvent(enterFrame): fade alpha, oscillate xscale/rotation while _Y < p
    // ----------------------------------------------------------------
    this.sprite29Sym = {
      name: "sprite_29",
      totalFrames: 4,
      frames: textures.getFrames("sprite_29"),
      anchorX: a29.x,
      anchorY: a29.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_29/frame_1/DoAction.as
            // gotoAndStop(random(4) + 1)  →  0-based: random(4) + 0
            clip.gotoAndStop(Math.floor(Math.random() * 4));
          },
        ],
      ]),
      // onLoad and onEnterFrame for the "c" instance are driven by
      // sprite_30's own logic (see sprite_30 definition below).
    };

    // ----------------------------------------------------------------
    // sprite_30 — spark emitter; contains sprite_29 as child "c"
    // AS: DefineSprite_30/frame_1/DoAction.as  — seeds physics, installs onEnterFrame
    // AS: DefineSprite_30/frame_1/PlaceObject2_29_1/CLIPACTIONRECORD onClipEvent(load).as
    //       → seeds vrot, vrot2, i on the "c" child
    // AS: DefineSprite_30/frame_1/PlaceObject2_29_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //       → fades alpha; oscillates xscale/rotation while _Y < p
    // ----------------------------------------------------------------
    const sprite30Sym: SymbolDefinition = {
      name: "sprite_30",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_30/frame_1/DoAction.as
            // roti = 70 + 60 * Math.random()
            // c._rotation = roti
            // dv = 1.05 + 0.2 * Math.random()
            // v = 3 + 10 * Math.random()
            // vx = v * cos(roti * PI/180)
            // vy = v * sin(roti * PI/180)
            // p = 60 - random(30)
            // cacc = 1.3 + 0.3 * Math.random()
            // this.onEnterFrame = function() { ... }

            const roti = 70 + 60 * Math.random();
            clip.vars.dv   = 1.05 + 0.2 * Math.random();
            const v        = 3 + 10 * Math.random();
            clip.vars.vx   = v * Math.cos((roti * Math.PI) / 180);
            clip.vars.vy   = v * Math.sin((roti * Math.PI) / 180);
            const p        = 60 - Math.floor(Math.random() * 30);
            clip.vars.p    = p;
            clip.vars.cacc = 1.3 + 0.3 * Math.random();

            // Attach sprite_29 as child "c"
            const c = clip.attach(this.sprite29Sym, "c", 1, ctx);

            // Apply onClipEvent(load) for the c instance:
            // AS: DefineSprite_30/frame_1/PlaceObject2_29_1/CLIPACTIONRECORD onClipEvent(load).as
            //   vrot  = -50 + 100 * Math.random()
            //   vrot2 = -1 + 2 * Math.random()
            //   i     = 0
            c.vars.vrot  = -50 + 100 * Math.random();
            c.vars.vrot2 = -1  + 2   * Math.random();
            c.vars.i     = 0;

            // Set initial _rotation of c from DoAction (c._rotation = roti)
            c.rotation = (roti * Math.PI) / 180;

            // Install onEnterFrame for c
            // AS: DefineSprite_30/frame_1/PlaceObject2_29_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
            //   _alpha -= 2.5
            //   if (_Y < _parent.p) {
            //     vrot2 /= 1.12
            //     _xscale = 50 * sin(i += vrot2)
            //     _rotation += vrot
            //   }
            c.onEnterFrame = (cClip) => {
              cClip.alpha -= 2.5 / 100;
              const parentP = cClip.parent?.vars.p as number | undefined;
              if (parentP !== undefined && cClip.y < parentP) {
                let vrot2 = cClip.vars.vrot2 as number;
                const vrot = cClip.vars.vrot as number;
                let i = cClip.vars.i as number;
                vrot2 /= 1.12;
                i += vrot2;
                cClip.scaleX = (50 * Math.sin(i)) / 100;
                cClip.rotation += (vrot * Math.PI) / 180;
                cClip.vars.vrot2 = vrot2;
                cClip.vars.i     = i;
              }
            };

            // Install onEnterFrame for the container clip (sprite_30 itself)
            // AS: this.onEnterFrame = function() {
            //   if (c._y < p) {
            //     c._y += cacc; _X += vx; _Y += vy; vx /= dv; vy /= dv;
            //   }
            // }
            clip.onEnterFrame = (self) => {
              const cChild = self.children.get("c");
              if (!cChild) { return; }
              const pVal = self.vars.p as number;
              if (cChild.y < pVal) {
                const cacc = self.vars.cacc as number;
                let vxS  = self.vars.vx as number;
                let vyS  = self.vars.vy as number;
                const dv = self.vars.dv as number;
                cChild.y += cacc;
                self.x   += vxS;
                self.y   += vyS;
                vxS /= dv;
                vyS /= dv;
                self.vars.vx = vxS;
                self.vars.vy = vyS;
              }
            };
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite_31 — wrapper around sprite_30; picks random start frame
    // AS: DefineSprite_31/frame_1/PlaceObject2_30_1/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndStop(random(_totalframes) + 1)
    //   (here _totalframes refers to sprite_31's own totalFrames)
    // We model sprite_31 as a 1-frame container that attaches sprite_30.
    // The onClipEvent(load) on the PlaceObject2_30_1 randomises sprite_30's timeline
    // start — in our runtime sprite_30 only has 1 frame, so this is a no-op
    // in practice; we still emit the canonical gotoAndStop call.
    // ----------------------------------------------------------------
    const sprite31Sym: SymbolDefinition = {
      name: "sprite_31",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach sprite_30 as child
            const s30 = clip.attach(sprite30Sym, "sprite_30", 1, ctx);
            // AS: onClipEvent(load) on PlaceObject2_30_1:
            //   gotoAndStop(random(_totalframes) + 1)
            // sprite_30 totalFrames = 1, so random(1)+1 = gotoAndStop(1) → 0-based = 0
            // (no-op for single-frame, but we mirror it canonically)
            s30.gotoAndStop(Math.floor(Math.random() * s30.totalFrames));
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite_7 — small particle inside sprite_20
    // AS: DefineSprite_7/frame_1/DoAction.as
    //   _rotation = random(360)
    //   gotoAndPlay(24 + random(6))
    //   _alpha = 40 + random(60)
    // AS: DefineSprite_7/frame_46/DoAction.as
    //   stop()
    // ----------------------------------------------------------------
    this.sprite7Sym = {
      name: "sprite_7",
      totalFrames: 48,
      frames: textures.getFrames("sprite_7"),
      anchorX: a7.x,
      anchorY: a7.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_7/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            clip.gotoAndPlay(24 + Math.floor(Math.random() * 6) - 1); // AS gotoAndPlay(24+r) → 0-based
            clip.alpha = (40 + Math.floor(Math.random() * 60)) / 100;
          },
        ],
        [
          45,
          (clip) => {
            // AS: DefineSprite_7/frame_46/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite_8 — composite flash inside sprite_20
    // AS: DefineSprite_8/frame_64/DoAction.as → stop()
    // ----------------------------------------------------------------
    this.sprite8Sym = {
      name: "sprite_8",
      totalFrames: 66,
      frames: textures.getFrames("sprite_8"),
      anchorX: a8.x,
      anchorY: a8.y,
      frameScripts: new Map([
        [
          63,
          (clip) => {
            // AS: DefineSprite_8/frame_64/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite_19 — looping shimmer inside sprite_20
    // AS: DefineSprite_19/frame_1/DoAction.as  → gotoAndPlay(random(10))
    // AS: DefineSprite_19/frame_61/DoAction.as → stop()
    // ----------------------------------------------------------------
    this.sprite19Sym = {
      name: "sprite_19",
      totalFrames: 180,
      frames: textures.getFrames("sprite_19"),
      anchorX: a19.x,
      anchorY: a19.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_19/frame_1/DoAction.as
            // gotoAndPlay(random(10)) → AS 1-based value, but random(10) can be 0
            // canonical AS gotoAndPlay(0) means frame 1 (1-based) → 0-based = 0-1 = wrap
            // In practice gotoAndPlay(N) where N can be 0: AS treats 0 as frame 1
            // so we clamp: max(0, random(10) - 1) but AS says gotoAndPlay(random(10))
            // and random(10) returns [0..9], so gotoAndPlay(0) in AS = no-op/frame1 (stays 0-based 0)
            // safest: clip.gotoAndPlay(Math.max(0, Math.floor(Math.random() * 10) - 1))
            // Actually AS gotoAndPlay(0) is equivalent to gotoAndPlay(1) → frame index 0
            // random(10) ∈ [0,9]; AS gotoAndPlay(N) for N=0 goes to frame 1 = index 0
            // So 0-based index = max(0, N-1) when N>=1, or 0 when N=0
            const r = Math.floor(Math.random() * 10);
            clip.gotoAndPlay(r > 0 ? r - 1 : 0);
          },
        ],
        [
          60,
          (clip) => {
            // AS: DefineSprite_19/frame_61/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite_20 — caster-side timeline (103 frames)
    // AS: DefineSprite_20/frame_1/DoAction.as   → SOMA.playSound("dodge_616a")
    // AS: DefineSprite_20/frame_1/DoAction_2.as → _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y
    // AS: DefineSprite_20/frame_103/DoAction.as → stop()
    // Children sprite_7, sprite_8, sprite_19 are authored on its timeline (placed at frame_1).
    // ----------------------------------------------------------------
    this.sprite20Sym = {
      name: "sprite_20",
      totalFrames: 103,
      frames: textures.getFrames("sprite_20"),
      anchorX: a20.x,
      anchorY: a20.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_20/frame_1/DoAction.as
            // SOMA.playSound("dodge_616a") — captured playSound ref
            this.playSound?.("dodge_616a");

            // AS: DefineSprite_20/frame_1/DoAction_2.as
            // _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y;
            }

            // Attach authored timeline children at frame_1
            clip.attach(this.sprite19Sym, "sprite_19", 1, ctx);
            clip.attach(this.sprite8Sym,  "sprite_8",  2, ctx);
            clip.attach(this.sprite7Sym,  "sprite_7",  3, ctx);
          },
        ],
        [
          102,
          (clip) => {
            // AS: DefineSprite_20/frame_103/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite_25 — impact circle inside sprite_33
    // AS: DefineSprite_25/frame_1/DoAction.as
    //   _rotation = random(360)
    //   t = 30 + random(50)
    //   _xscale = t; _yscale = t
    // AS: DefineSprite_25/frame_13/DoAction.as → stop()
    // ----------------------------------------------------------------
    this.sprite25Sym = {
      name: "sprite_25",
      totalFrames: 15,
      frames: textures.getFrames("sprite_25"),
      anchorX: a25.x,
      anchorY: a25.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_25/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            const t = 30 + Math.floor(Math.random() * 50);
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
          },
        ],
        [
          12,
          (clip) => {
            // AS: DefineSprite_25/frame_13/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite_32 — large composite inside sprite_33
    // AS: DefineSprite_32/frame_1/DoAction.as
    //   r = _rotation
    //   _rotation = r + 40 * (-0.5 + Math.random())
    //   _xscale = 50 + random(50)
    //   _yscale = 80 + random(60)
    //   gotoAndPlay(random(45))
    // AS: DefineSprite_32/frame_79/PlaceObject2_31_3/CLIPACTIONRECORD onClipEvent(load).as
    //   _rotation = random(360)   (on the sprite_31 child placed at frame_79)
    // AS: DefineSprite_32/frame_136/DoAction.as → stop()
    // ----------------------------------------------------------------
    this.sprite32Sym = {
      name: "sprite_32",
      totalFrames: 198,
      frames: textures.getFrames("sprite_32"),
      anchorX: a32.x,
      anchorY: a32.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_32/frame_1/DoAction.as
            // r = _rotation (current rotation, initially 0)
            const r = clip.rotation; // radians
            clip.rotation = r + (40 * (-0.5 + Math.random()) * Math.PI) / 180;
            clip.scaleX = (50 + Math.floor(Math.random() * 50)) / 100;
            clip.scaleY = (80 + Math.floor(Math.random() * 60)) / 100;
            // gotoAndPlay(random(45)) — AS 1-based, random(45) ∈ [0,44]
            // gotoAndPlay(0) in AS = frame 1 = index 0; gotoAndPlay(N) → index N-1 for N>=1
            const rg = Math.floor(Math.random() * 45);
            clip.gotoAndPlay(rg > 0 ? rg - 1 : 0);
          },
        ],
        [
          78,
          (clip, ctx) => {
            // AS: frame_79 places sprite_31 (PlaceObject2_31_3) with onClipEvent(load):
            //   _rotation = random(360)
            const s31 = clip.attach(sprite31Sym, "sprite_31", 3, ctx);
            // Apply the onClipEvent(load) for this PlaceObject2:
            // AS: DefineSprite_32/frame_79/PlaceObject2_31_3/CLIPACTIONRECORD onClipEvent(load).as
            //   _rotation = random(360)
            s31.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          135,
          (clip) => {
            // AS: DefineSprite_32/frame_136/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite_33 — target-side timeline (181 frames)
    // AS: DefineSprite_33/frame_1/DoAction.as   → _X = _parent.cellTo.x; _Y = _parent.cellTo.y
    // AS: DefineSprite_33/frame_64/DoAction.as  → SOMA.playSound("dodge_616b")
    // AS: DefineSprite_33/frame_97/DoAction.as  → this.end() → signalHit
    // AS: DefineSprite_33/frame_102/PlaceObject2_31_7/CLIPACTIONRECORD onClipEvent(load).as
    //   _rotation = random(360)  (on a sprite_31 child placed at frame_102)
    // AS: DefineSprite_33/frame_181/DoAction.as → _parent.removeMovieClip(); stop() → complete()
    // Children sprite_25 and sprite_32 are authored timeline children (placed at frame_1).
    // ----------------------------------------------------------------
    this.sprite33Sym = {
      name: "sprite_33",
      totalFrames: 181,
      frames: textures.getFrames("sprite_33"),
      anchorX: a33.x,
      anchorY: a33.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_33/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }

            // Attach authored timeline children at frame_1
            clip.attach(this.sprite32Sym, "sprite_32", 1, ctx);
            clip.attach(this.sprite25Sym, "sprite_25", 2, ctx);
          },
        ],
        [
          63,
          () => {
            // AS: DefineSprite_33/frame_64/DoAction.as → SOMA.playSound("dodge_616b")
            this.playSound?.("dodge_616b");
          },
        ],
        [
          96,
          () => {
            // AS: DefineSprite_33/frame_97/DoAction.as → this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          101,
          (clip, ctx) => {
            // AS: DefineSprite_33/frame_102 places another sprite_31 (PlaceObject2_31_7)
            // with onClipEvent(load): _rotation = random(360)
            const s31b = clip.attach(sprite31Sym, "sprite_31b", 7, ctx);
            // AS: DefineSprite_33/frame_102/PlaceObject2_31_7/CLIPACTIONRECORD onClipEvent(load).as
            //   _rotation = random(360)
            s31b.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          180,
          (clip) => {
            // AS: DefineSprite_33/frame_181/DoAction.as
            // _parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // Register all symbols (no librarySymbols[] in manifest → no lib_ prefix)
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite8Sym);
    this.registry.register(this.sprite19Sym);
    this.registry.register(this.sprite20Sym);
    this.registry.register(this.sprite25Sym);
    this.registry.register(this.sprite29Sym);
    this.registry.register(sprite30Sym);
    this.registry.register(sprite31Sym);
    this.registry.register(this.sprite32Sym);
    this.registry.register(this.sprite33Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use in frame scripts
    this.playSound = callbacks.playSound;

    // AS: frame_2/DoAction.as → stop()  (main timeline stops at frame 2)
    // The canonical main timeline places sprite_20 and sprite_33 at frame_1
    // (before stop() fires at frame_2). We attach them here so they start
    // ticking from the next runtime frame.
    this.root.attach(this.sprite20Sym, "sprite_20", 1, context);
    this.root.attach(this.sprite33Sym, "sprite_33", 2, context);
  }
}
