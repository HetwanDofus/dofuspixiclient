/**
 * Spell 2900 — Feux d'Artifice (Fireworks).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2900/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion, no caster
 * reference, and no dual-anchor pattern. The entire animation plays at the
 * target cell. The outer DefineSprite_31 is the main container; it plays 97
 * frames, fires two sounds, and hosts a `boule` (sprite26) child plus the
 * `feux` firework burst on frame 76.
 *
 * Library symbols:
 *   - minifeux  (lib_minifeux)  — 36-frame spark. frame_1 sets rotation +
 *                                 positions at boule._x/_y. frame_34 removes.
 *                                 onLoad: alpha=150, v=random. onEnterFrame:
 *                                 fade + drift X.
 *   - minifeux2 (lib_minifeux2) — 36-frame spark variant. frame_1 random rotation.
 *                                 frame_34 removes. onLoad: alpha=random, v=random.
 *                                 onEnterFrame: fade + drift.
 *   - minifeux3 (lib_minifeux3) — 78-frame spark. frame_1 random rotation.
 *                                 frame_76 removes. onLoad: alpha=random, v>0.
 *                                 onEnterFrame: parent alpha flicker, alpha fade,
 *                                 drift with 0.85 friction.
 *   - minifeux4 (lib_minifeux4) — 78-frame spark. frame_1 empty, frame_76 removes.
 *                                 onLoad: angle, alpha, v, vr. onEnterFrame:
 *                                 angle/rotation oscillation, Y drift, X/Y from v.
 *   - feux      (lib_feux)      — 16-frame firework burst. frame_1 picks level-
 *                                 dependent frame; carries 4 child clip-event
 *                                 handlers on frames 2/5/8/11/14 for particles
 *                                 that spawn minifeux2, minifeux3, minifeux4.
 *   - sprite26  (lib_sprite26)  — 1-frame "boule" container with onClipEvent
 *                                 load/enterFrame. Placed by the harness-equivalent
 *                                 root sprite (DefineSprite_31) frame_1 via
 *                                 PlaceObject2 with matrix-tween sequence.
 *
 * Main timeline (DefineSprite_31):
 *   frame_1:  SOMA.playSound("fireworks01"); set taille/scale/rotation/compte
 *   frame_70: SOMA.playSound("explo_fireworks")
 *   frame_76: attach boule's inner `feux` children (PlaceObject2_28_3 onClipEvent(load))
 *   frame_97: stop() + complete
 *
 * signalHit is fired at frame_70 (the explosion frame) since that is the
 * canonical impact moment.
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

// ---- Bounds from manifest.librarySymbols[] ----
const MINIFEUX_BOUNDS = { width: 2.45, height: 2.05, offsetX: 0.2, offsetY: -1.2 };
const MINIFEUX2_BOUNDS = { width: 2.45, height: 2.05, offsetX: 0.2, offsetY: -1.2 };
const MINIFEUX3_BOUNDS = { width: 2.45, height: 2.05, offsetX: 0.2, offsetY: -1.2 };
const MINIFEUX4_BOUNDS = { width: 5.35, height: 6.6, offsetX: -1.25, offsetY: -2.85 };
const FEUX_BOUNDS = { width: 48.25, height: 53.3, offsetX: -18.65, offsetY: -26.75 };
const SPRITE26_BOUNDS = { width: 3.75, height: 3.75, offsetX: -1.4, offsetY: -1.85 };

export class Spell2900 extends RuntimeSpell {
  readonly spellId = 2900;
  readonly displayType = SpellDisplayType.TargetCell;

  // Symbols that are referenced across multiple handlers — stored as
  // instance fields so onSpellStart + frameScripts can reference them.
  private minifeuxSym!: SymbolDefinition;
  private minifeux2Sym!: SymbolDefinition;
  private minifeux3Sym!: SymbolDefinition;
  private minifeux4Sym!: SymbolDefinition;
  private feuxSym!: SymbolDefinition;
  private sprite26Sym!: SymbolDefinition;

  // Sound callback captured in onSpellStart for use in frameScripts.
  private playSoundFn?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const minifeuxAnchor = calculateAnchor(MINIFEUX_BOUNDS);
    const minifeux2Anchor = calculateAnchor(MINIFEUX2_BOUNDS);
    const minifeux3Anchor = calculateAnchor(MINIFEUX3_BOUNDS);
    const minifeux4Anchor = calculateAnchor(MINIFEUX4_BOUNDS);
    const feuxAnchor = calculateAnchor(FEUX_BOUNDS);
    const sprite26Anchor = calculateAnchor(SPRITE26_BOUNDS);

    // ----------------------------------------------------------------
    // lib_minifeux — spark spawned from the sprite26 (boule) enterFrame
    // AS: DefineSprite_8_minifeux
    // ----------------------------------------------------------------
    this.minifeuxSym = {
      name: "minifeux",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux"),
      anchorX: minifeuxAnchor.x,
      anchorY: minifeuxAnchor.y,
      // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.alpha_val = 150;
        clip.alpha = 150 / 100;
        clip.vars.v = Math.random();
      },
      // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        let alpha_val = clip.vars.alpha_val as number;
        const v = clip.vars.v as number;
        alpha_val -= 3.34;
        clip.vars.alpha_val = alpha_val;
        clip.alpha = Math.max(0, alpha_val) / 100;
        clip.x += v;
      },
      frameScripts: new Map([
        [
          // AS DefineSprite_8_minifeux/frame_1/DoAction.as
          // _rotation = random(360); _X = _parent.boule._x; _Y = _parent.boule._y
          // (position is applied at attach time from the spawner; rotation here)
          0,
          (clip) => {
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            // Position at boule's location — walk up: clip.parent is root (the outer mc).
            // The boule child is at depth 1 named "boule" on the root's parent (DefineSprite_31).
            // In the AS, _parent is DefineSprite_31 so _parent.boule is the boule instance.
            // Our attachment happens from the sprite26 enterFrame which already sets x/y on
            // the spawned minifeux — so we only need to apply the rotation here.
          },
        ],
        [
          // AS DefineSprite_8_minifeux/frame_34/DoAction.as: this.removeMovieClip()
          33,
          (clip) => {
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_minifeux2 — spark spawned from feux frame_8 particle
    // AS: DefineSprite_7_minifeux2
    // ----------------------------------------------------------------
    this.minifeux2Sym = {
      name: "minifeux2",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux2"),
      anchorX: minifeux2Anchor.x,
      anchorY: minifeux2Anchor.y,
      // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        const alpha_init = Math.floor(Math.random() * 150);
        clip.vars.alpha_val = alpha_init;
        clip.alpha = Math.max(0, alpha_init) / 100;
        clip.vars.v = Math.random();
      },
      // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        let alpha_val = clip.vars.alpha_val as number;
        const v = clip.vars.v as number;
        alpha_val -= 3.34;
        clip.vars.alpha_val = alpha_val;
        clip.alpha = Math.max(0, alpha_val) / 100;
        clip.x += v;
      },
      frameScripts: new Map([
        [
          // AS DefineSprite_7_minifeux2/frame_1/DoAction.as: _rotation = random(360)
          0,
          (clip) => {
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          // AS DefineSprite_7_minifeux2/frame_34/DoAction.as: this.removeMovieClip()
          33,
          (clip) => {
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_minifeux3 — spark spawned from feux frame_11 and frame_14 particles
    // AS: DefineSprite_6_minifeux3
    // ----------------------------------------------------------------
    this.minifeux3Sym = {
      name: "minifeux3",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux3"),
      anchorX: minifeux3Anchor.x,
      anchorY: minifeux3Anchor.y,
      // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        const alpha_init = Math.floor(Math.random() * 150);
        clip.vars.alpha_val = alpha_init;
        clip.alpha = Math.max(0, alpha_init) / 100;
        clip.vars.v = 2 + 3 * Math.random();
      },
      // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        let alpha_val = clip.vars.alpha_val as number;
        let v = clip.vars.v as number;
        // _parent._alpha = random(100)
        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }
        alpha_val -= 1.6;
        clip.vars.alpha_val = alpha_val;
        clip.alpha = Math.max(0, alpha_val) / 100;
        v *= 0.85;
        clip.vars.v = v;
        clip.x += v;
      },
      frameScripts: new Map([
        [
          // AS DefineSprite_6_minifeux3/frame_1/DoAction.as: _rotation = random(360)
          0,
          (clip) => {
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          // AS DefineSprite_6_minifeux3/frame_76/DoAction.as: this.removeMovieClip()
          75,
          (clip) => {
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_minifeux4 — spark spawned from feux frame_14 particle onLoad
    // AS: DefineSprite_3_minifeux4
    // ----------------------------------------------------------------
    this.minifeux4Sym = {
      name: "minifeux4",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux4"),
      anchorX: minifeux4Anchor.x,
      anchorY: minifeux4Anchor.y,
      // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.angle = 90;
        const alpha_init = Math.floor(Math.random() * 150);
        clip.vars.alpha_val = alpha_init;
        clip.alpha = Math.max(0, alpha_init) / 100;
        clip.vars.v = -1.6 - 3.34 * Math.random();
        clip.vars.vr = -0.5 + Math.random();
      },
      // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        let angle = clip.vars.angle as number;
        const vr = clip.vars.vr as number;
        let v = clip.vars.v as number;
        let alpha_val = clip.vars.alpha_val as number;

        // _rotation = angle * 57.29746936176985 (convert radians to degrees, but
        // angle is already effectively tracking radians via the oscillation)
        // The AS multiplies by ~57.3 (degrees/radian) and then assigns to _rotation
        // (which is in degrees in Flash). Net effect: clip rotation = angle (already radians-like).
        clip.rotation = angle; // angle value tracks radians-equivalent units

        angle += vr;
        clip.vars.angle = angle;

        // _parent._alpha = random(100)
        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }

        alpha_val -= 1.6;
        clip.vars.alpha_val = alpha_val;
        clip.alpha = Math.max(0, alpha_val) / 100;

        v *= 0.85;
        clip.vars.v = v;
        clip.y += v;

        const vx = v * Math.cos(angle);
        const vy = v * Math.sin(angle);
        clip.x += vx;
        clip.y += vy;
      },
      frameScripts: new Map([
        [
          // AS DefineSprite_3_minifeux4/frame_1/DoAction.as — empty
          0,
          (_clip) => {
            // intentionally empty — canonical frame_1/DoAction.as is empty
          },
        ],
        [
          // AS DefineSprite_3_minifeux4/frame_76/DoAction.as: this.removeMovieClip()
          75,
          (clip) => {
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_feux — 16-frame firework composite burst
    // AS: DefineSprite_23_feux
    // Contains 5 sub-particle handlers placed at frames 1,2,5,8,11,14
    // (0-indexed: 1,4,7,10,13). frame_1/DoAction: gotoAndStop(level+1).
    // ----------------------------------------------------------------
    this.feuxSym = {
      name: "feux",
      totalFrames: 16,
      frames: textures.getFrames("lib_feux"),
      anchorX: feuxAnchor.x,
      anchorY: feuxAnchor.y,
      frameScripts: new Map([
        [
          // AS DefineSprite_23_feux/frame_1/DoAction.as
          // gotoAndStop(_parent._parent._parent.level + 1)
          // parent chain: inner clip → feux → sprite26 (boule container) → DefineSprite_31 → root
          0,
          (clip, ctx) => {
            // Walk up to find level: clip.parent is the sprite26-derived clip,
            // whose parent is the DefineSprite_31 clip, whose parent is root.
            const level = ctx.level;
            clip.gotoAndStop(level + 1); // AS gotoAndStop(level+1) → 0-based: (level+1)-1 = level
          },
        ],
        [
          // AS DefineSprite_23_feux/frame_2/PlaceObject2_12_1 onClipEvent(load)
          // Fires when playhead reaches frame_2 (index 1)
          1,
          (clip, ctx) => {
            // Attach the "frame_2 particle" — a generic firework shape using the inner
            // sprite's clip events. We model it as an anonymous container whose onLoad
            // and onEnterFrame implement the frame_2 particle physics.
            const sym = buildFeux_Frame2_ParticleSym();
            clip.attach(sym, "p_frame2_1", 12, ctx);
          },
        ],
        [
          // AS DefineSprite_23_feux/frame_5/PlaceObject2_14_1 onClipEvent(load)
          // Fires when playhead reaches frame_5 (index 4)
          4,
          (clip, ctx) => {
            const sym = buildFeux_Frame5_ParticleSym();
            clip.attach(sym, "p_frame5_1", 14, ctx);
          },
        ],
        [
          // AS DefineSprite_23_feux/frame_8/PlaceObject2_12_1 onClipEvent(load)
          // Fires when playhead reaches frame_8 (index 7)
          7,
          (clip, ctx) => {
            const sym = buildFeux_Frame8_ParticleSym(this.minifeux2Sym);
            clip.attach(sym, "p_frame8_1", 12, ctx);
          },
        ],
        [
          // AS DefineSprite_23_feux/frame_11/PlaceObject2_19_1 onClipEvent(load)
          // Fires when playhead reaches frame_11 (index 10)
          10,
          (clip, ctx) => {
            const sym = buildFeux_Frame11_ParticleSym(this.minifeux3Sym);
            clip.attach(sym, "p_frame11_1", 19, ctx);
          },
        ],
        [
          // AS DefineSprite_23_feux/frame_14/PlaceObject2_22_1 onClipEvent(load)
          // Fires when playhead reaches frame_14 (index 13)
          13,
          (clip, ctx) => {
            const sym = buildFeux_Frame14_ParticleSym(this.minifeux3Sym, this.minifeux4Sym);
            clip.attach(sym, "p_frame14_1", 22, ctx);
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_sprite26 — the "boule" container (the rising streak / trail).
    // AS: DefineSprite_26
    // directlyDynamic: true — has its own CLIPACTIONRECORD handlers.
    // Placed at depth 1 of DefineSprite_31 frame_1 via PlaceObject2 with
    // an extensive matrix-tween sequence (frames 0..72 in placements[]).
    // ----------------------------------------------------------------
    this.sprite26Sym = {
      name: "sprite26",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite26"),
      anchorX: sprite26Anchor.x,
      anchorY: sprite26Anchor.y,
      // AS DefineSprite_26/frame_1/PlaceObject2_25_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.c = 1;
      },
      // AS DefineSprite_26/frame_1/PlaceObject2_25_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip, ctx) => {
        if (Math.floor(Math.random() * 2) === 1) {
          // _rotation = _rotation + 100
          clip.rotation += (100 * Math.PI) / 180;
          // _parent._parent.attachMovie("minifeux","minifeux"+c,c)
          // _parent is DefineSprite_31 clip, _parent._parent is root (which is at
          // target cell for displayType 11). We attach onto the DefineSprite_31 clip.
          const outerMc = clip.parent;
          if (outerMc) {
            let c = clip.vars.c as number;
            const mf = outerMc.attach(this.minifeuxSym, "minifeux" + c, c, ctx);
            // Position at boule's current position
            mf.x = clip.x;
            mf.y = clip.y;
            c++;
            clip.vars.c = c;
          }
        }
      },
    };

    // ----------------------------------------------------------------
    // DefineSprite_31 — outer container (the whole spell wrapper).
    // This is the "main" animated sprite. We model it as a symbol so
    // we can attach it from onSpellStart and drive its 97-frame timeline.
    // ----------------------------------------------------------------
    const outerMcSym: SymbolDefinition = {
      name: "outerMc",
      totalFrames: 97,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          // AS DefineSprite_31/frame_1/DoAction.as + DoAction_2.as
          // SOMA.playSound already called in onSpellStart; here we do the
          // visual init: taille, scale, rotation, compte.
          0,
          (clip) => {
            // AS: taille = 80 + random(40); _xscale/_yscale = taille; _rotation = -20+random(40)
            const taille = 80 + Math.floor(Math.random() * 40);
            clip.scaleX = taille / 100;
            clip.scaleY = taille / 100;
            clip.rotation = ((-20 + Math.floor(Math.random() * 40)) * Math.PI) / 180;
            clip.vars.compte = 1;
          },
        ],
        [
          // AS DefineSprite_31/frame_70/DoAction.as: SOMA.playSound("explo_fireworks")
          69,
          (_clip) => {
            this.playSoundFn?.("explo_fireworks");
            this.runtime.signalHit();
          },
        ],
        [
          // AS DefineSprite_31/frame_76/PlaceObject2_28_3/CLIPACTIONRECORD onClipEvent(load).as
          // sz = 60 + 20*((level-1)%3); scale; loop i<6+7*((level-1)%3) attaching feux
          75,
          (clip, ctx) => {
            const level = ctx.level;
            const sz = 60 + 20 * ((level - 1) % 3);
            clip.scaleX = sz / 100;
            clip.scaleY = sz / 100;
            const count = 6 + 7 * ((level - 1) % 3);
            for (let i = 1; i < count; i++) {
              clip.attach(this.feuxSym, "feux" + i, i, ctx);
            }
          },
        ],
        [
          // AS DefineSprite_31/frame_97/DoAction.as: stop()
          96,
          (clip) => {
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // Register all symbols
    this.registry.register(this.minifeuxSym);
    this.registry.register(this.minifeux2Sym);
    this.registry.register(this.minifeux3Sym);
    this.registry.register(this.minifeux4Sym);
    this.registry.register(this.feuxSym);
    this.registry.register(this.sprite26Sym);
    this.registry.register(outerMcSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS DefineSprite_31/frame_1/DoAction.as: SOMA.playSound("fireworks01")
    callbacks.playSound("fireworks01");
    this.playSoundFn = callbacks.playSound;

    // Attach the outer mc (DefineSprite_31) at root.
    const outerMcSym = this.registry.resolve("outerMc");
    if (outerMcSym) {
      const outerMc = this.root.attach(outerMcSym, "outerMc", 1, context);

      // Attach the boule (sprite26) at the outer mc.
      // AS places it at frame_1 depth 1, named "boule", with initial matrix
      // translateX=-0.75, translateY=-53.25 (the starting streak position).
      const boule = outerMc.attach(this.sprite26Sym, "boule", 1, context);
      boule.x = -0.75;
      boule.y = -53.25;
      boule.scaleX = 0.574462890625;
      boule.scaleY = 12.94549560546875;

      // Drive the boule tween — the placements[] array carries 70+ "move"
      // keyframes for the boule sprite. We approximate this with an
      // onEnterFrame on the outerMc that interpolates the known keyframes.
      // The canonical data from the manifest placements[] is used directly.
      const boulePlacements: Array<{
        frame: number;
        tx: number;
        ty: number;
        sx: number;
        sy: number;
      }> = [
        { frame: 0,  tx: -0.75,  ty: -53.25,  sx: 0.574462890625,    sy: 12.94549560546875 },
        { frame: 3,  tx: -0.75,  ty: -85.25,  sx: 0.574462890625,    sy: 2.739013671875 },
        { frame: 4,  tx: -0.80,  ty: -87.65,  sx: 0.594482421875,    sy: 2.6572265625 },
        { frame: 5,  tx: -0.80,  ty: -89.95,  sx: 0.6140289306640625, sy: 2.5773468017578125 },
        { frame: 6,  tx: -0.85,  ty: -92.20,  sx: 0.633087158203125,  sy: 2.49945068359375 },
        { frame: 7,  tx: -0.85,  ty: -94.45,  sx: 0.6516571044921875, sy: 2.423553466796875 },
        { frame: 8,  tx: -0.85,  ty: -96.55,  sx: 0.6697540283203125, sy: 2.3496246337890625 },
        { frame: 9,  tx: -0.90,  ty: -98.60,  sx: 0.6873626708984375, sy: 2.27764892578125 },
        { frame: 10, tx: -0.90,  ty: -100.60, sx: 0.7044830322265625, sy: 2.2076416015625 },
        { frame: 11, tx: -0.90,  ty: -102.55, sx: 0.72113037109375,   sy: 2.1396484375 },
        { frame: 12, tx: -0.95,  ty: -104.45, sx: 0.7372894287109375, sy: 2.0736083984375 },
        { frame: 13, tx: -0.95,  ty: -106.30, sx: 0.7529754638671875, sy: 2.0095062255859375 },
        { frame: 14, tx: -1.00,  ty: -108.10, sx: 0.7681732177734375, sy: 1.9473876953125 },
        { frame: 15, tx: -1.00,  ty: -109.85, sx: 0.78289794921875,   sy: 1.8872528076171875 },
        { frame: 16, tx: -1.00,  ty: -111.50, sx: 0.797119140625,     sy: 1.8291168212890625 },
        { frame: 17, tx: -1.05,  ty: -113.15, sx: 0.8108673095703125, sy: 1.77294921875 },
        { frame: 18, tx: -1.10,  ty: -114.70, sx: 0.8241424560546875, sy: 1.718658447265625 },
        { frame: 19, tx: -1.05,  ty: -116.15, sx: 0.8369293212890625, sy: 1.6664581298828125 },
        { frame: 20, tx: -1.05,  ty: -117.65, sx: 0.8492279052734375, sy: 1.616180419921875 },
        { frame: 21, tx: -1.10,  ty: -119.05, sx: 0.861053466796875,  sy: 1.5678253173828125 },
        { frame: 22, tx: -1.10,  ty: -120.35, sx: 0.87237548828125,   sy: 1.5215606689453125 },
        { frame: 23, tx: -1.10,  ty: -121.60, sx: 0.88323974609375,   sy: 1.4771270751953125 },
        { frame: 24, tx: -1.10,  ty: -122.85, sx: 0.89361572265625,   sy: 1.43475341796875 },
        { frame: 25, tx: -1.20,  ty: -124.05, sx: 0.90350341796875,   sy: 1.3943328857421875 },
        { frame: 26, tx: -1.15,  ty: -125.15, sx: 0.9129180908203125, sy: 1.355926513671875 },
        { frame: 27, tx: -1.15,  ty: -126.15, sx: 0.921844482421875,  sy: 1.3194427490234375 },
        { frame: 28, tx: -1.15,  ty: -127.20, sx: 0.9302825927734375, sy: 1.284912109375 },
        { frame: 29, tx: -1.20,  ty: -128.15, sx: 0.9382476806640625, sy: 1.2523956298828125 },
        { frame: 30, tx: -1.20,  ty: -129.00, sx: 0.9457244873046875, sy: 1.2218017578125 },
        { frame: 31, tx: -1.20,  ty: -129.85, sx: 0.9527130126953125, sy: 1.1932220458984375 },
        { frame: 32, tx: -1.20,  ty: -130.55, sx: 0.959228515625,     sy: 1.166595458984375 },
        { frame: 33, tx: -1.20,  ty: -131.30, sx: 0.9652557373046875, sy: 1.1419830322265625 },
        { frame: 34, tx: -1.20,  ty: -131.95, sx: 0.9708099365234375, sy: 1.119293212890625 },
        { frame: 35, tx: -1.20,  ty: -132.55, sx: 0.9758758544921875, sy: 1.098602294921875 },
        { frame: 36, tx: -1.30,  ty: -133.05, sx: 0.98046875,         sy: 1.0798797607421875 },
        { frame: 37, tx: -1.25,  ty: -133.60, sx: 0.98455810546875,   sy: 1.0631103515625 },
        { frame: 38, tx: -1.25,  ty: -134.00, sx: 0.9881744384765625, sy: 1.0483245849609375 },
        { frame: 39, tx: -1.25,  ty: -134.40, sx: 0.9913177490234375, sy: 1.035491943359375 },
        { frame: 40, tx: -1.25,  ty: -134.70, sx: 0.9939727783203125, sy: 1.024658203125 },
        { frame: 41, tx: -1.25,  ty: -134.90, sx: 0.9961395263671875, sy: 1.01580810546875 },
        { frame: 42, tx: -1.25,  ty: -135.10, sx: 0.997833251953125,  sy: 1.0088653564453125 },
        { frame: 43, tx: -1.25,  ty: -135.30, sx: 0.9990386962890625, sy: 1.0039825439453125 },
        { frame: 44, tx: -1.25,  ty: -135.30, sx: 0.999755859375,     sy: 1.0009613037109375 },
        { frame: 45, tx: -1.25,  ty: -135.35, sx: 1.0,                sy: 1.0 },
        { frame: 47, tx: -1.25,  ty: -135.30, sx: 1.0,                sy: 1.0 },
        { frame: 48, tx: -1.25,  ty: -135.25, sx: 1.0,                sy: 1.0 },
        { frame: 49, tx: -1.25,  ty: -135.20, sx: 1.0,                sy: 1.0 },
        { frame: 50, tx: -1.25,  ty: -135.15, sx: 1.0,                sy: 1.0 },
        { frame: 51, tx: -1.25,  ty: -135.05, sx: 1.0,                sy: 1.0 },
        { frame: 52, tx: -1.25,  ty: -134.90, sx: 1.0,                sy: 1.0 },
        { frame: 53, tx: -1.25,  ty: -134.80, sx: 1.0,                sy: 1.0 },
        { frame: 54, tx: -1.25,  ty: -134.65, sx: 1.0,                sy: 1.0 },
        { frame: 55, tx: -1.25,  ty: -134.45, sx: 1.0,                sy: 1.0 },
        { frame: 56, tx: -1.25,  ty: -134.30, sx: 1.0,                sy: 1.0 },
        { frame: 57, tx: -1.25,  ty: -134.10, sx: 1.0,                sy: 1.0 },
        { frame: 58, tx: -1.25,  ty: -133.85, sx: 1.0,                sy: 1.0 },
        { frame: 59, tx: -1.25,  ty: -133.65, sx: 1.0,                sy: 1.0 },
        { frame: 60, tx: -1.25,  ty: -133.35, sx: 1.0,                sy: 1.0 },
        { frame: 61, tx: -1.25,  ty: -133.10, sx: 1.0,                sy: 1.0 },
        { frame: 62, tx: -1.25,  ty: -132.80, sx: 1.0,                sy: 1.0 },
        { frame: 63, tx: -1.25,  ty: -132.50, sx: 1.0,                sy: 1.0 },
        { frame: 64, tx: -1.25,  ty: -132.20, sx: 1.0,                sy: 1.0 },
        { frame: 65, tx: -1.25,  ty: -131.85, sx: 1.0,                sy: 1.0 },
        { frame: 66, tx: -1.25,  ty: -131.50, sx: 1.0,                sy: 1.0 },
        { frame: 67, tx: -1.25,  ty: -131.10, sx: 1.0,                sy: 1.0 },
        { frame: 68, tx: -1.25,  ty: -130.70, sx: 1.0,                sy: 1.0 },
        { frame: 69, tx: -1.25,  ty: -130.30, sx: 1.0,                sy: 1.0 },
        { frame: 70, tx: -1.25,  ty: -129.85, sx: 1.0,                sy: 1.0 },
        { frame: 71, tx: -1.25,  ty: -129.40, sx: 1.0,                sy: 1.0 },
        { frame: 72, tx: -1.25,  ty: -128.95, sx: 1.0,                sy: 1.0 },
      ];

      // Build a lookup for fast frame-to-keyframe access
      const boulePlacementMap = new Map<
        number,
        { tx: number; ty: number; sx: number; sy: number }
      >();
      for (const kf of boulePlacements) {
        boulePlacementMap.set(kf.frame, { tx: kf.tx, ty: kf.ty, sx: kf.sx, sy: kf.sy });
      }

      // Drive boule tween via outerMc's onEnterFrame. Each tick we look up
      // the matching keyframe (or interpolate between adjacent ones).
      outerMc.onEnterFrame = (_clip) => {
        const frame = outerMc.currentFrame;
        const kf = boulePlacementMap.get(frame);
        if (kf) {
          boule.x = kf.tx;
          boule.y = kf.ty;
          boule.scaleX = kf.sx;
          boule.scaleY = kf.sy;
        }
      };
    }
  }
}

// ============================================================
// Helper factories for the feux sub-particle symbols.
// These are defined outside the class to keep the class body
// readable. They are NOT registered in the global registry —
// they are used inline by feux frameScripts.
// ============================================================

/**
 * Builds the "frame_2 particle" for DefineSprite_23_feux.
 * AS: DefineSprite_23_feux/frame_2/PlaceObject2_12_1 CLIPACTIONRECORD
 * A generic expanding / fading ember.
 */
function buildFeux_Frame2_ParticleSym(): SymbolDefinition {
  return {
    name: "__feux_p2__",
    totalFrames: 1,
    frames: [],
    anchorX: 0.5,
    anchorY: 0.5,
    // AS DefineSprite_23_feux/frame_2/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
    onLoad: (clip) => {
      // _parent._rotation = random(360)
      if (clip.parent) {
        clip.parent.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      }
      clip.vars.g = 1 * Math.random();
      clip.vars.va = 0;
      clip.vars.t = 100 + Math.floor(Math.random() * 100);
      const t = clip.vars.t as number;
      clip.scaleX = t / 100;
      clip.scaleY = t / 100;
      clip.vars.d = 100 - Math.floor(Math.random() * 70);
      clip.vars.acc = 3.34 + Math.random() * 5;
      clip.vars.vacc = 1 + 1 * Math.random();
      clip.x = 10 + Math.floor(Math.random() * 20);
    },
    // AS DefineSprite_23_feux/frame_2/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    onEnterFrame: (clip) => {
      const g = clip.vars.g as number;
      let va = clip.vars.va as number;
      const vacc = clip.vars.vacc as number;
      const acc = clip.vars.acc as number;
      const d = clip.vars.d as number;

      clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      const tScale = 20 + Math.floor(Math.random() * 80);
      clip.scaleX = tScale / 100;
      clip.scaleY = tScale / 100;
      // _parent._y += g
      if (clip.parent) {
        clip.parent.y += g;
      }
      va += vacc;
      clip.vars.va = va;
      const alphaVal = 150 - va;
      clip.alpha = Math.max(0, alphaVal) / 100;
      clip.x -= (clip.x - d) / acc;
      if (alphaVal < 0) {
        if (clip.parent) {
          clip.parent.remove();
        }
      }
    },
  };
}

/**
 * Builds the "frame_5 particle" for DefineSprite_23_feux.
 * AS: DefineSprite_23_feux/frame_5/PlaceObject2_14_1 CLIPACTIONRECORD
 * A spinning, shrinking ember that drifts to target X.
 */
function buildFeux_Frame5_ParticleSym(): SymbolDefinition {
  return {
    name: "__feux_p5__",
    totalFrames: 1,
    frames: [],
    anchorX: 0.5,
    anchorY: 0.5,
    // AS DefineSprite_23_feux/frame_5/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load).as
    onLoad: (clip) => {
      // _parent._rotation = random(360)
      if (clip.parent) {
        clip.parent.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      }
      clip.vars.g = 0.6 * Math.random();
      clip.vars.t = 200 + Math.floor(Math.random() * 100);
      const t = clip.vars.t as number;
      clip.scaleX = t / 100;
      clip.scaleY = t / 100;
      clip.vars.d = 100 - Math.floor(Math.random() * 70);
      clip.vars.acc = 1.67 + Math.random() * 5;
      clip.x = 10 + Math.floor(Math.random() * 20);
    },
    // AS DefineSprite_23_feux/frame_5/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    onEnterFrame: (clip) => {
      const g = clip.vars.g as number;
      let t = clip.vars.t as number;
      const d = clip.vars.d as number;
      const acc = clip.vars.acc as number;

      // _rotation += t / 6 (degrees per frame)
      clip.rotation += ((t / 6) * Math.PI) / 180;
      t--;
      clip.vars.t = t;
      clip.scaleX = Math.max(0, t / 3) / 100;
      clip.scaleY = Math.max(0, t / 3) / 100;
      // _parent._y += g
      if (clip.parent) {
        clip.parent.y += g;
      }
      clip.x -= (clip.x - d) / acc;
      if (t < 0) {
        if (clip.parent) {
          clip.parent.remove();
        }
      }
    },
  };
}

/**
 * Builds the "frame_8 particle" for DefineSprite_23_feux.
 * AS: DefineSprite_23_feux/frame_8/PlaceObject2_12_1 CLIPACTIONRECORD
 * Randomly spawns minifeux2 children, then removes itself when t<0.
 */
function buildFeux_Frame8_ParticleSym(
  minifeux2Sym: SymbolDefinition,
): SymbolDefinition {
  return {
    name: "__feux_p8__",
    totalFrames: 1,
    frames: [],
    anchorX: 0.5,
    anchorY: 0.5,
    // AS DefineSprite_23_feux/frame_8/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
    onLoad: (clip) => {
      clip.vars.g = 0.67 * Math.random();
      clip.vars.t = 100 + Math.floor(Math.random() * 100);
      const t = clip.vars.t as number;
      clip.scaleX = t / 100;
      clip.scaleY = t / 100;
      clip.vars.d = 100 - Math.floor(Math.random() * 70);
      clip.vars.acc = 1.67 + Math.random() * 5;
      clip.vars.vacc = 1 + 1 * Math.random();
      clip.vars.vx = 10 * (-0.5 + Math.random());
      clip.vars.vy = 10 * (-0.5 + Math.random());
      clip.vars.accx = 0.8 + 0.1 * Math.random();
      clip.vars.accy = 0.8 + 0.1 * Math.random();
      clip.vars.c = 0;
      clip.vars.compte = Math.floor(Math.random() * 200000);
    },
    // AS DefineSprite_23_feux/frame_8/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    onEnterFrame: (clip, ctx) => {
      const g = clip.vars.g as number;
      let t = clip.vars.t as number;
      let vx = clip.vars.vx as number;
      let vy = clip.vars.vy as number;
      const accx = clip.vars.accx as number;
      const accy = clip.vars.accy as number;
      let c = clip.vars.c as number;

      if (Math.floor(Math.random() * 15) === 1) {
        // attachMovie("minifeux2", ...) on _parent._parent
        // _parent is the feux clip, _parent._parent is outerMc
        const outerMc = clip.parent?.parent;
        if (outerMc) {
          const compte = Math.floor(Math.random() * 200000);
          clip.vars.compte = compte;
          const mf = outerMc.attach(minifeux2Sym, "minifeux2" + compte, compte, ctx);
          mf.x = clip.x;
          mf.y = clip.y + (clip.parent?.y ?? 0);
          mf.alpha = Math.max(0, (100 - c)) / 100;
          c++;
          clip.vars.c = c;
        }
      }

      // _rotation += t / 3 (degrees)
      clip.rotation += ((t / 3) * Math.PI) / 180;
      t--;
      clip.vars.t = t;
      clip.scaleX = Math.max(0, t / 3) / 100;
      clip.scaleY = Math.max(0, t / 3) / 100;
      // _parent._y += g
      if (clip.parent) {
        clip.parent.y += g;
      }
      vx *= accx;
      vy *= accy;
      clip.vars.vx = vx;
      clip.vars.vy = vy;
      clip.x += vx;
      clip.y += vy;
      if (t < 0) {
        if (clip.parent) {
          clip.parent.remove();
        }
      }
    },
  };
}

/**
 * Builds the "frame_11 particle" for DefineSprite_23_feux.
 * AS: DefineSprite_23_feux/frame_11/PlaceObject2_19_1 CLIPACTIONRECORD
 * When t<135 spawns a burst of minifeux3, then removes parent.
 */
function buildFeux_Frame11_ParticleSym(
  minifeux3Sym: SymbolDefinition,
): SymbolDefinition {
  return {
    name: "__feux_p11__",
    totalFrames: 1,
    frames: [],
    anchorX: 0.5,
    anchorY: 0.5,
    // AS DefineSprite_23_feux/frame_11/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(load).as
    onLoad: (clip) => {
      clip.stop();
      clip.vars.g = 0.67 * Math.random();
      clip.vars.t = 100 + Math.floor(Math.random() * 100);
      const t = clip.vars.t as number;
      clip.scaleX = t / 100;
      clip.scaleY = t / 100;
      clip.vars.vx = 20 * (-0.5 + Math.random());
      clip.vars.vy = 20 * (-0.5 + Math.random());
      clip.vars.accx = 0.8 + 0.1 * Math.random();
      clip.vars.accy = 0.8 + 0.1 * Math.random();
      clip.vars.c = 0;
      clip.x = -10 + Math.floor(Math.random() * 20);
    },
    // AS DefineSprite_23_feux/frame_11/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    onEnterFrame: (clip, ctx) => {
      const g = clip.vars.g as number;
      let t = clip.vars.t as number;
      let vx = clip.vars.vx as number;
      let vy = clip.vars.vy as number;
      const accx = clip.vars.accx as number;
      const accy = clip.vars.accy as number;
      let c = clip.vars.c as number;

      if (t < 150) {
        clip.play();
      }
      if (t < 135) {
        // Spawn 9 minifeux3 at current position on _parent._parent
        const outerMc = clip.parent?.parent;
        if (outerMc) {
          for (let nbr = 1; nbr < 10; nbr++) {
            const compte = Math.floor(Math.random() * 200000);
            const mf = outerMc.attach(minifeux3Sym, "minifeux3" + compte, compte, ctx);
            mf.x = clip.x;
            mf.y = clip.y + (clip.parent?.y ?? 0);
            mf.alpha = Math.max(0, 100 - c) / 100;
            c++;
          }
          clip.vars.c = c;
        }
        if (clip.parent) {
          clip.parent.remove();
        }
        return;
      }

      // _rotation += t / 3
      clip.rotation += ((t / 3) * Math.PI) / 180;
      t--;
      clip.vars.t = t;
      clip.scaleX = Math.max(0, t / 3) / 100;
      clip.scaleY = Math.max(0, t / 3) / 100;
      // _parent._y += g
      if (clip.parent) {
        clip.parent.y += g;
      }
      vx *= accx;
      vy *= accy;
      clip.vars.vx = vx;
      clip.vars.vy = vy;
      clip.x += vx;
      clip.y += vy;
    },
  };
}

/**
 * Builds the "frame_14 particle" for DefineSprite_23_feux.
 * AS: DefineSprite_23_feux/frame_14/PlaceObject2_22_1 CLIPACTIONRECORD
 * On load spawns minifeux4 and initialises ballistic motion.
 * When t<90 spawns burst of minifeux3 and removes parent.
 */
function buildFeux_Frame14_ParticleSym(
  minifeux3Sym: SymbolDefinition,
  minifeux4Sym: SymbolDefinition,
): SymbolDefinition {
  return {
    name: "__feux_p14__",
    totalFrames: 1,
    frames: [],
    anchorX: 0.5,
    anchorY: 0.5,
    // AS DefineSprite_23_feux/frame_14/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(load).as
    onLoad: (clip, ctx) => {
      // Spawn 1 minifeux4 on _parent._parent
      const outerMc = clip.parent?.parent;
      if (outerMc) {
        for (let nbr = 1; nbr < 2; nbr++) {
          const compte = Math.floor(Math.random() * 200000);
          const mf = outerMc.attach(minifeux4Sym, "minifeux4" + compte, compte, ctx);
          mf.x = clip.x;
          mf.y = clip.y + (clip.parent?.y ?? 0);
        }
      }
      clip.vars.angle = -1.1415 + 0.2 * (-0.5 + Math.random());
      clip.vars.vit = 6 + 10 * Math.random();
      clip.stop();
      clip.vars.frein = 0.9 + 0.05 * Math.random();
      clip.vars.vr = 0;
      clip.vars.sz = 240 + Math.floor(Math.random() * 120);
      clip.vars.frangle = 1.2;
      clip.vars.c = 0;
      clip.vars.t = 100 + Math.floor(Math.random() * 100);
    },
    // AS DefineSprite_23_feux/frame_14/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    onEnterFrame: (clip, ctx) => {
      let angle = clip.vars.angle as number;
      let vit = clip.vars.vit as number;
      const frein = clip.vars.frein as number;
      let vr = clip.vars.vr as number;
      let sz = clip.vars.sz as number;
      let frangle = clip.vars.frangle as number;
      let c = clip.vars.c as number;
      let t = clip.vars.t as number;

      // _rotation = angle * 57.297... (angle in radians, result in degrees, applied as Flash _rotation)
      clip.rotation = angle; // already tracking as radians-equivalent

      // _alpha = 50 + random(60)
      clip.alpha = (50 + Math.floor(Math.random() * 60)) / 100;

      sz *= frein + 0.02;
      clip.vars.sz = sz;
      clip.scaleX = sz / 100;
      clip.scaleY = sz / 100;

      if (Math.floor(Math.random() * 16) === 1) {
        vr = 1 * (-0.5 + Math.random());
        clip.vars.vr = vr;
      }

      angle += vr * frangle;
      frangle *= frein;
      clip.vars.angle = angle;
      clip.vars.frangle = frangle;

      const vx = vit * Math.cos(angle);
      const vy = vit * Math.sin(angle);
      clip.x += vx;
      clip.y += vy;

      vit *= frein;
      clip.vars.vit = vit;

      if (t < 100) {
        clip.play();
      }
      if (t < 90) {
        // Spawn 9 minifeux3
        const outerMc = clip.parent?.parent;
        if (outerMc) {
          for (let nbr = 1; nbr < 10; nbr++) {
            const compte = Math.floor(Math.random() * 200000);
            const mf = outerMc.attach(minifeux3Sym, "minifeux3" + compte, compte, ctx);
            mf.x = clip.x;
            mf.y = clip.y + (clip.parent?.y ?? 0);
            mf.alpha = Math.max(0, 100 - c) / 100;
            c++;
          }
          clip.vars.c = c;
        }
        if (clip.parent) {
          clip.parent.remove();
        }
        return;
      }

      t--;
      clip.vars.t = t;
    },
  };
}
