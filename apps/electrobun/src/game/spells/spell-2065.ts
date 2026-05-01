/**
 * Spell 2065 — (Bwork Mage / Boufbowl spell, "boo_up" + "jet_903").
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2065/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Two parallel authored timelines:
 *   - sprite_10 (48 frames): caster-side; positions itself at _parent.cellFrom,
 *     plays "boo_up" sound, contains sprite_9 (a 27-frame sub-sprite that
 *     stops at frame 25 and has an onClipEvent(load) setting rotation to
 *     _parent._parent.angle).
 *   - sprite_11 (135 frames): target-side; positions itself at _parent.cellTo,
 *     rotates to face caster, at frame 70 spawns 6 "bulle" particles and
 *     signals hit, at frame 133 removes parent (spell complete). Also places
 *     two "sprite5" clipEvent instances at frames 87 and 99.
 *
 * Library symbols:
 *   - "bulle" (lib_bulle) — single-frame bubble particle. onLoad seeds
 *     rx, ry, vx, vy, alpha and installs onEnterFrame drift physics.
 *     Inner PlaceObject2_4_1 onClipEvent(load) calls gotoAndPlay(random(10)+1).
 *   - "sprite5" (lib_sprite5) — clipEvent, directlyDynamic. Same character
 *     as "bulle" (characterId 5). onLoad/onEnterFrame share the same physics
 *     as bulle (DefineSprite_5_bulle scripts). Placed inside sprite_11 at
 *     frames 87 (depth 5, translateX=-80.8, translateY=-0.9, scale=1.1988,
 *     alphaMult=46) and 99 (depth 1, translateX=-36, translateY=-0.65,
 *     scale=1.6329, alphaMult=46).
 *
 * Clip-event scripts ported at runtime:
 *   1. DefineSprite_10/frame_46/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load):
 *      Sets sprite_9's _rotation = _parent._parent.angle on load.
 *   2. DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load):
 *      Seeds bulle/sprite5 particle vars + drift physics.
 *
 * Main timeline frame_2: SOMA.playSound("jet_903"); stop();
 *
 * displayType=50 rationale: sprite_10 reads _parent.cellFrom and sprite_11
 * reads _parent.cellTo — both position at WORLD coords, matching WorldAbsolute
 * (harness sets container at (0,0) and exposes cellFrom/cellTo on root.vars).
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

// Bounds from manifest.json librarySymbols[] — "bulle" / "sprite5" share characterId 5
const BULLE_BOUNDS = {
  width: 28,
  height: 30.65,
  offsetX: -16.6,
  offsetY: -14.85,
};

// Bounds for sprite_9 from manifest.json animations[]
const SPRITE_9_BOUNDS = {
  width: 215.5,
  height: 37.6,
  offsetX: -47.1,
  offsetY: -18.8,
};

// Bounds for sprite_10 from manifest.json animations[]
const SPRITE_10_BOUNDS = {
  width: 215.5,
  height: 72.45,
  offsetX: -48.1,
  offsetY: -60,
};

// Bounds for sprite_11 from manifest.json animations[]
const SPRITE_11_BOUNDS = {
  width: 238.5,
  height: 50.05,
  offsetX: -236.15,
  offsetY: -24.9,
};

export class Spell2065 extends RuntimeSpell {
  readonly spellId = 2065;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private bulleSym!: SymbolDefinition;
  private sprite5Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const bulleAnchor = calculateAnchor(BULLE_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE_9_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE_10_BOUNDS);
    const sprite11Anchor = calculateAnchor(SPRITE_11_BOUNDS);

    // ---- "bulle" — bubble particle spawned at target impact ------
    // AS: DefineSprite_5_bulle/frame_1/DoAction.as
    // AS: DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
    //
    // onClipEvent(load): gotoAndPlay(random(10) + 1)
    //   — 1-frame symbol so the goto is clamped to frame 0; still ported
    //     faithfully for canonical correctness.
    //
    // frame_1/DoAction.as seeds physics vars and installs onEnterFrame:
    //   rx = 0.7 + 0.15 * Math.random()
    //   ry = 0.8 + 0.15 * Math.random()
    //   vx = 20 + random(25)
    //   vy = -15 + random(30)
    //   _alpha = random(50) + 50
    //   this.onEnterFrame = function() { _X += (vx *= rx); _Y += (vy *= ry); }
    this.bulleSym = {
      name: "bulle",
      totalFrames: 1,
      frames: textures.getFrames("lib_bulle"),
      anchorX: bulleAnchor.x,
      anchorY: bulleAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load)
        // gotoAndPlay(random(10) + 1) → 0-based = random(10), clamped to 0 for 1-frame symbol
        const gotoFrame = Math.floor(Math.random() * 10);
        clip.gotoAndPlay(gotoFrame);

        // AS: DefineSprite_5_bulle/frame_1/DoAction.as
        clip.vars.rx = 0.7 + 0.15 * Math.random();
        clip.vars.ry = 0.8 + 0.15 * Math.random();
        clip.vars.vx = 20 + Math.floor(Math.random() * 25);
        clip.vars.vy = -15 + Math.floor(Math.random() * 30);
        clip.alpha = (Math.floor(Math.random() * 50) + 50) / 100;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_5_bulle/frame_1/DoAction.as — onEnterFrame closure
        // _X = _X + (vx *= rx);
        // _Y = _Y + (vy *= ry);
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

    // ---- "sprite5" — clipEvent directlyDynamic, same physics as bulle --
    // AS: DefineSprite_5_bulle/frame_1/DoAction.as (characterId 5, shared)
    // AS: DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
    //
    // Placed inside sprite_11 at two frames:
    //   - frame 87 (0-based: 86), depth 5, translateX=-80.8, translateY=-0.9,
    //     scale=1.1988, alphaMult=46/256
    //   - frame 99 (0-based: 98), depth 1, translateX=-36, translateY=-0.65,
    //     scale=1.6329, alphaMult=46/256
    //
    // Per manifest: directlyDynamic=true — the CLIPACTIONRECORD handlers are
    // on the sprite itself. The onLoad seeds physics vars; onEnterFrame drifts.
    // The placement matrix/colorTransform is applied by the parent's frameScripts
    // (sprite_11) when attaching. The "ratio" field (87 / 99) is the placement
    // frame, not a phase offset in this context.
    this.sprite5Sym = {
      name: "sprite5",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite5"),
      anchorX: bulleAnchor.x,
      anchorY: bulleAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load)
        // gotoAndPlay(random(10) + 1) → 0-based = random(10), clamped to 0 for 1-frame symbol
        const gotoFrame = Math.floor(Math.random() * 10);
        clip.gotoAndPlay(gotoFrame);

        // AS: DefineSprite_5_bulle/frame_1/DoAction.as
        clip.vars.rx = 0.7 + 0.15 * Math.random();
        clip.vars.ry = 0.8 + 0.15 * Math.random();
        clip.vars.vx = 20 + Math.floor(Math.random() * 25);
        clip.vars.vy = -15 + Math.floor(Math.random() * 30);
        // alpha set by colorTransform.alphaMult=46 from placement — 46/256
        // but the DoAction.as also sets _alpha = random(50)+50; the placement
        // colorTransform multiplies on top. We apply the DoAction alpha here;
        // the parent applies the colorTransform alpha multiplier after attach
        // via the placement transform block (see sprite_11 frameScripts below).
        clip.alpha = (Math.floor(Math.random() * 50) + 50) / 100;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_5_bulle/frame_1/DoAction.as — onEnterFrame closure
        // _X = _X + (vx *= rx);
        // _Y = _Y + (vy *= ry);
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

    // ---- "sprite_9" — sub-sprite inside sprite_10 (caster side) --
    // AS: DefineSprite_9/frame_25/DoAction.as → stop()
    // AS: DefineSprite_10/frame_46/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load):
    //   _rotation = _parent._parent.angle;
    //   (_parent = sprite_10 clip, _parent._parent = root)
    this.sprite9Sym = {
      name: "sprite_9",
      totalFrames: 27,
      frames: textures.getFrames("sprite_9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_10/frame_46/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load)
        // _rotation = _parent._parent.angle  (degrees → radians)
        // clip.parent = sprite_10 clip; clip.parent.parent = root
        const root = clip.parent?.parent ?? clip.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
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

    // ---- "sprite_10" — caster-side timeline (48 frames) ----------
    // AS: DefineSprite_10/frame_1/DoAction.as   → SOMA.playSound("boo_up")
    // AS: DefineSprite_10/frame_1/DoAction_2.as → _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 25
    // AS: DefineSprite_10/frame_46/DoAction.as  → stop()
    // At frame 46 (0-based: 45), PlaceObject2_9_1 places sprite_9 with
    // onClipEvent(load) setting rotation. We attach sprite_9 here.
    // Sound "boo_up" is fired from onSpellStart (cannot call playSound inside frameScripts).
    this.sprite10Sym = {
      name: "sprite_10",
      totalFrames: 48,
      frames: textures.getFrames("sprite_10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_10/frame_1/DoAction_2.as
            // _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 25
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 25;
            }
          },
        ],
        [
          45,
          (clip, ctx) => {
            // AS: DefineSprite_10/frame_46/DoAction.as → stop()
            clip.stop();
            // PlaceObject2_9_1 places sprite_9 at this frame with
            // onClipEvent(load) → sets rotation to _parent._parent.angle.
            clip.attach(this.sprite9Sym, "sprite9_1", 1, ctx);
          },
        ],
      ]),
    };

    // ---- "sprite_11" — target-side timeline (135 frames) ---------
    // AS: DefineSprite_11/frame_1/DoAction.as
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 30; _rotation = _parent.angle
    // AS: DefineSprite_11/frame_70/DoAction.as
    //   c = 1; while(c < 7) { this.attachMovie("bulle","bulle"+c,c); c++; }
    // AS: DefineSprite_11/frame_70/DoAction_2.as
    //   this.end(); → signalHit
    // AS: DefineSprite_11/frame_133/DoAction.as
    //   _parent.removeMovieClip(); → spell complete
    //
    // manifest sprite5 placements inside sprite_11:
    //   frame 87 (0-based 86), depth 5: translateX=-80.8, translateY=-0.9,
    //     scaleX=scaleY=1.1988, alphaMult=46/256
    //   frame 99 (0-based 98), depth 1: translateX=-36, translateY=-0.65,
    //     scaleX=scaleY=1.6329, alphaMult=46/256
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
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 30; _rotation = _parent.angle
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y - 30;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          69,
          (clip, ctx) => {
            // AS: DefineSprite_11/frame_70/DoAction.as
            // c = 1; while(c < 7) { this.attachMovie("bulle","bulle"+c,c); c++; }
            for (let c = 1; c < 7; c++) {
              clip.attach(this.bulleSym, `bulle${c}`, c, ctx);
            }
            // AS: DefineSprite_11/frame_70/DoAction_2.as → this.end() = signalHit
            this.runtime.signalHit();
          },
        ],
        [
          86,
          (clip, ctx) => {
            // manifest: sprite5 placement at frame 87 (0-based 86) inside sprite_11
            // depth=5, translateX=-80.8, translateY=-0.9, scaleX=scaleY=1.1988,
            // colorTransform.alphaMult=46 → alpha = 46/256
            const s5a = clip.attach(this.sprite5Sym, "sprite5_87", 5, ctx, {
              x: -80.8,
              y: -0.9,
            });
            s5a.scaleX = 1.1988372802734375;
            s5a.scaleY = 1.1988372802734375;
            s5a.alpha = 46 / 256;
          },
        ],
        [
          98,
          (clip, ctx) => {
            // manifest: sprite5 placement at frame 99 (0-based 98) inside sprite_11
            // depth=1, translateX=-36, translateY=-0.65, scaleX=scaleY=1.6329,
            // colorTransform.alphaMult=46 → alpha = 46/256
            const s5b = clip.attach(this.sprite5Sym, "sprite5_99", 1, ctx, {
              x: -36,
              y: -0.65,
            });
            s5b.scaleX = 1.632904052734375;
            s5b.scaleY = 1.632904052734375;
            s5b.alpha = 46 / 256;
          },
        ],
        [
          132,
          (clip) => {
            // AS: DefineSprite_11/frame_133/DoAction.as
            // _parent.removeMovieClip() — outer mc removal = spell complete
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.bulleSym);
    this.registry.register(this.sprite5Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite11Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: frame_2/DoAction.as → SOMA.playSound("jet_903"); stop();
    // AS: DefineSprite_10/frame_1/DoAction.as → SOMA.playSound("boo_up")
    // Both sounds fired here since playSound is only available in onSpellStart.
    callbacks.playSound("boo_up");
    callbacks.playSound("jet_903");

    // Attach the two parallel authored timelines to the root.
    // displayType=50 (WorldAbsolute): root is at world (0,0); each sprite
    // positions itself at cellFrom/cellTo via its own frame_1 script.
    this.root.attach(this.sprite10Sym, "sprite10", 1, context);
    this.root.attach(this.sprite11Sym, "sprite11", 2, context);
  }
}
