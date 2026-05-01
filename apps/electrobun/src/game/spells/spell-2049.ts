/**
 * Spell 2049 — (Cra / earth arrow variant).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2049/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Two parallel authored timelines:
 *   - sprite_10 (DefineSprite_10): caster-side launch timeline (48 frames).
 *     Positions itself at cellFrom, computes angle to cellTo, plays the
 *     launch animation. On frame_46: stops, and a sub-sprite (sprite_9 /
 *     DefineSprite_9) is placed whose onLoad sets its _rotation = _parent.angle.
 *   - sprite_11 (DefineSprite_11): target-side impact timeline (135 frames).
 *     Positions itself at cellTo on frame_1. On frame_70: plays "coquille" sound,
 *     spawns 6 "bulle" particles, fires signalHit. On frame_87 and frame_99:
 *     attaches "sprite5" clips (same character as bulle, directlyDynamic) with
 *     their specific transforms and alpha. On frame_133: removes parent →
 *     spell complete.
 *
 * Library symbols:
 *   - bulle (characterId=5) — single-frame bubble particle. onLoad seeds
 *     rx/ry friction + vx/vy velocity + alpha + gotoAndPlay offset.
 *     onEnterFrame applies friction-decayed velocity to position.
 *   - sprite5 (characterId=5, directlyDynamic=true) — same visual/physics as
 *     bulle but placed by DefineSprite_11 at frames 87 and 99 with specific
 *     scale/translation/alpha transforms from the manifest placements[].
 *     onLoad: gotoAndPlay(random(15)); seeds rx/ry/vx/vy/alpha.
 *     onEnterFrame: same friction+velocity physics as bulle.
 *   - sprite_9 (DefineSprite_9, 27 frames) — container inside sprite_10,
 *     placed at frame_46, stopped at frame_25. onLoad sets rotation = _parent.angle.
 *   - sprite_10 (DefineSprite_10, 48 frames) — caster-side container.
 *   - sprite_11 (DefineSprite_11, 135 frames) — target-side container.
 *   - sprite_4 (DefineSprite_4, 54 frames) — standalone animated sprite
 *     stopped at frame_52.
 *
 * Main timeline frame_2/DoAction.as: SOMA.playSound("jet_903"); stop();
 * Both sprite_10 and sprite_11 are placed on the main timeline (attached in
 * onSpellStart).
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

// Bounds from manifest librarySymbols[] for "bulle" (characterId=5)
const BULLE_BOUNDS = {
  width: 28,
  height: 30.65,
  offsetX: -16.6,
  offsetY: -14.85,
};

// Bounds from manifest librarySymbols[] for "sprite5" (characterId=5, same bounds as bulle)
const SPRITE5_BOUNDS = {
  width: 28,
  height: 30.65,
  offsetX: -16.6,
  offsetY: -14.85,
};

// Bounds from manifest animations[] for sprite_9
const SPRITE9_BOUNDS = {
  width: 215.4,
  height: 37.85,
  offsetX: -47.2,
  offsetY: -19.15,
};

// Bounds from manifest animations[] for sprite_10
const SPRITE10_BOUNDS = {
  width: 215.4,
  height: 86.6,
  offsetX: -48.2,
  offsetY: -74.15,
};

// Bounds from manifest animations[] for sprite_11
const SPRITE11_BOUNDS = {
  width: 238.3,
  height: 50.05,
  offsetX: -236.15,
  offsetY: -24.9,
};

// Bounds from manifest animations[] for sprite_4
const SPRITE4_BOUNDS = {
  width: 19.5,
  height: 21.35,
  offsetX: -11.55,
  offsetY: -10.35,
};

export class Spell2049 extends RuntimeSpell {
  readonly spellId = 2049;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private bulleSym!: SymbolDefinition;
  private sprite5Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;
  private sprite4Sym!: SymbolDefinition;

  private soundCallback?: SpellCallbacks["playSound"];

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const bulleAnchor = calculateAnchor(BULLE_BOUNDS);
    const sprite5Anchor = calculateAnchor(SPRITE5_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE10_BOUNDS);
    const sprite11Anchor = calculateAnchor(SPRITE11_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE4_BOUNDS);

    // ---- bulle — bubble particle spawned at target impact (frame_70) ----
    // AS: DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
    //     gotoAndPlay(random(15) + 1)
    // AS: DefineSprite_5_bulle/frame_1/DoAction.as
    //     rx/ry/vx/vy/alpha seeds + onEnterFrame physics
    this.bulleSym = {
      name: "bulle",
      totalFrames: 1,
      frames: textures.getFrames("lib_bulle"),
      anchorX: bulleAnchor.x,
      anchorY: bulleAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndPlay(random(15) + 1) — AS 1-based → 0-based: random(15)
        clip.gotoAndPlay(Math.floor(Math.random() * 15));

        // AS: DefineSprite_5_bulle/frame_1/DoAction.as
        clip.vars.rx = 0.7 + 0.15 * Math.random();
        clip.vars.ry = 0.8 + 0.15 * Math.random();
        clip.vars.vx = 20 + Math.floor(Math.random() * 25);
        clip.vars.vy = -15 + Math.floor(Math.random() * 30);
        clip.alpha = (Math.floor(Math.random() * 50) + 50) / 100;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_5_bulle/frame_1/DoAction.as — this.onEnterFrame
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const rx = clip.vars.rx as number;
        const ry = clip.vars.ry as number;
        vx *= rx;
        vy *= ry;
        clip.x += vx;
        clip.y += vy;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- sprite5 — directlyDynamic bubble clip placed by sprite_11 ----
    // Same character (characterId=5) and same physics as bulle.
    // Placed by DefineSprite_11 at frames 87 and 99 (manifest placements[]).
    //
    // AS: DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
    //     gotoAndPlay(random(15) + 1)
    // AS: DefineSprite_5_bulle/frame_1/DoAction.as
    //     rx/ry/vx/vy/alpha seeds + onEnterFrame physics
    //
    // The manifest placements[] entries carry specific transforms that are
    // applied when attaching (translateX/Y, scaleX/Y, alphaMult/256).
    this.sprite5Sym = {
      name: "sprite5",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndPlay(random(15) + 1) — AS 1-based → 0-based: random(15)
        clip.gotoAndPlay(Math.floor(Math.random() * 15));

        // AS: DefineSprite_5_bulle/frame_1/DoAction.as
        clip.vars.rx = 0.7 + 0.15 * Math.random();
        clip.vars.ry = 0.8 + 0.15 * Math.random();
        clip.vars.vx = 20 + Math.floor(Math.random() * 25);
        clip.vars.vy = -15 + Math.floor(Math.random() * 30);
        // Note: alpha is overridden by the placement colorTransform (alphaMult=46/256 ≈ 0.18)
        // but we still seed it per canonical AS — the placement alpha will be applied
        // via the attach() transform after onLoad runs (canonical order: transform → onLoad).
        // Since attach() applies the caller transform BEFORE onLoad, the placement alpha
        // from the attach() call already set clip.alpha; we overwrite here per canonical AS.
        clip.alpha = (Math.floor(Math.random() * 50) + 50) / 100;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_5_bulle/frame_1/DoAction.as — this.onEnterFrame
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const rx = clip.vars.rx as number;
        const ry = clip.vars.ry as number;
        vx *= rx;
        vy *= ry;
        clip.x += vx;
        clip.y += vy;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- sprite_9 (sub-clip inside sprite_10, placed at frame_46) ----
    // AS: DefineSprite_9/frame_25/DoAction.as → stop()
    // AS: DefineSprite_10/frame_46/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
    //     onLoad: _rotation = _parent.angle
    this.sprite9Sym = {
      name: "sprite_9",
      totalFrames: 27,
      frames: textures.getFrames("sprite_9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_10/frame_46/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
        // _rotation = _parent.angle  (degrees → radians)
        const parent = clip.parent;
        const angleDeg = (parent?.vars.angle as number) ?? 0;
        clip.rotation = (angleDeg * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          24,
          (clip) => {
            // AS: DefineSprite_9/frame_25/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_10 — caster-side launch animation ----------------
    // AS: DefineSprite_10/frame_1/DoAction.as   → SOMA.playSound("herbe")
    // AS: DefineSprite_10/frame_1/DoAction_2.as → position at cellFrom, compute angle
    // AS: DefineSprite_10/frame_46/DoAction.as  → stop()
    //     PlaceObject2_9_1 at frame_46 places sprite_9 which sets rotation on load
    this.sprite10Sym = {
      name: "sprite_10",
      totalFrames: 48,
      frames: textures.getFrames("sprite_10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_10/frame_1/DoAction.as
            this.soundCallback?.("herbe");

            // AS: DefineSprite_10/frame_1/DoAction_2.as
            // _rotation = 0
            clip.rotation = 0;

            // _X = _parent.cellFrom.x
            // _Y = _parent.cellFrom.y - 25
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;

            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 25;
            }

            // dx = _parent.cellTo.x - _parent.cellFrom.x
            // dy = _parent.cellTo.y + 10 - _parent.cellFrom.y + 25
            // angle = Math.atan2(dy, dx) * 180 / 3.1415
            if (cellFrom && cellTo) {
              const dx = cellTo.x - cellFrom.x;
              const dy = cellTo.y + 10 - cellFrom.y + 25;
              const angleDeg = Math.atan2(dy, dx) * (180 / 3.1415);
              clip.vars.angle = angleDeg;
            }
          },
        ],
        [
          45,
          (clip, ctx) => {
            // AS: DefineSprite_10/frame_46/DoAction.as → stop()
            clip.stop();

            // PlaceObject2_9_1 at frame_46 attaches sprite_9 whose onLoad
            // sets _rotation = _parent.angle
            clip.attach(this.sprite9Sym, "sprite9_1", 1, ctx);
          },
        ],
      ]),
    };

    // ---- sprite_11 — target-side impact animation ----------------
    // AS: DefineSprite_11/frame_1/DoAction.as
    //     _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 10; _rotation = _parent.angle
    // AS: DefineSprite_11/frame_70/DoAction.as   → SOMA.playSound("coquille")
    // AS: DefineSprite_11/frame_70/DoAction_2.as → spawn 6 bulle particles (c=1..6)
    // AS: DefineSprite_11/frame_70/DoAction_3.as → this.end() → signalHit
    // Manifest placements[] for sprite5:
    //   frame 87, depth 5: scale=1.1988, translate=(-80.8, -0.9), alphaMult=46/256
    //   frame 99, depth 1: scale=1.6329, translate=(-36, -0.65), alphaMult=46/256
    // AS: DefineSprite_11/frame_133/DoAction.as → _parent.removeMovieClip()
    this.sprite11Sym = {
      name: "sprite_11",
      totalFrames: 135,
      frames: textures.getFrames("sprite_11"),
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_11/frame_1/DoAction.as
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;

            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y - 10;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          69,
          (clip, ctx) => {
            // AS: DefineSprite_11/frame_70/DoAction.as
            this.soundCallback?.("coquille");

            // AS: DefineSprite_11/frame_70/DoAction_2.as
            // c = 1; while (c < 7) { this.attachMovie("bulle","bulle"+c, c); c++; }
            for (let c = 1; c < 7; c++) {
              clip.attach(this.bulleSym, `bulle${c}`, c, ctx);
            }

            // AS: DefineSprite_11/frame_70/DoAction_3.as → this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          86,
          (clip, ctx) => {
            // Manifest placements[] for sprite5, parentSpriteId=11, frame=87 (0-based: 86)
            // depth=5, matrix: scaleX=1.1988, scaleY=1.1988, translateX=-80.8, translateY=-0.9
            // colorTransform: alphaMult=46/256 ≈ 0.18
            const inst = clip.attach(this.sprite5Sym, "sprite5_depth5", 5, ctx, {
              x: -80.8,
              y: -0.9,
            });
            inst.scaleX = 1.1988372802734375;
            inst.scaleY = 1.1988372802734375;
            inst.alpha = 46 / 256;
          },
        ],
        [
          98,
          (clip, ctx) => {
            // Manifest placements[] for sprite5, parentSpriteId=11, frame=99 (0-based: 98)
            // depth=1, matrix: scaleX=1.6329, scaleY=1.6329, translateX=-36, translateY=-0.65
            // colorTransform: alphaMult=46/256 ≈ 0.18
            const inst = clip.attach(this.sprite5Sym, "sprite5_depth1", 1, ctx, {
              x: -36,
              y: -0.65,
            });
            inst.scaleX = 1.632904052734375;
            inst.scaleY = 1.632904052734375;
            inst.alpha = 46 / 256;
          },
        ],
        [
          132,
          (clip) => {
            // AS: DefineSprite_11/frame_133/DoAction.as → _parent.removeMovieClip()
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- sprite_4 — standalone animated sprite (54 frames) -------
    // AS: DefineSprite_4/frame_52/DoAction.as → stop()
    this.sprite4Sym = {
      name: "sprite_4",
      totalFrames: 54,
      frames: textures.getFrames("sprite_4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      frameScripts: new Map([
        [
          51,
          (clip) => {
            // AS: DefineSprite_4/frame_52/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(this.bulleSym);
    this.registry.register(this.sprite5Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite11Sym);
    this.registry.register(this.sprite4Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Capture callbacks for use in frame scripts (sounds fired mid-timeline)
    this.soundCallback = callbacks.playSound;

    // AS: frame_2/DoAction.as → SOMA.playSound("jet_903"); stop();
    callbacks.playSound("jet_903");

    // Place both parallel timelines on the root.
    // sprite_10 (caster-side) and sprite_11 (target-side) are placed on the
    // main timeline implicitly — attach them here so they tick from the start.
    // Root is at world (0,0) for displayType WorldAbsolute; both sprites
    // position themselves in their own frame_1 scripts using cellFrom / cellTo.
    this.root.attach(this.sprite10Sym, "sprite10", 1, context);
    this.root.attach(this.sprite11Sym, "sprite11", 2, context);
  }
}
