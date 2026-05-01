/**
 * Spell 112 — Flèche de Glace / Ice Arrow (Cra).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/112/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Two parallel authored timelines:
 *   - sprite_10 (DefineSprite_10): caster-side arrow launch, 48 frames.
 *       frame_1: plays "herbe" sound, positions self at cellFrom (y-80),
 *                computes angle to target, sets _rotation=0.
 *       frame_46: stop(). Child sprite_9 (placed at frame_46 via
 *                PlaceObject2) has onClipEvent(load) that copies _parent.angle.
 *   - sprite_11 (DefineSprite_11): target-side impact, 135 frames.
 *       frame_1:  position at cellTo (y-10), rotate to angle.
 *       frame_70: play "coquille" sound, spawn 6 "bulle" particles,
 *                 signalHit (this.end()).
 *       frame_87: attach sprite5 instance at depth 5 with matrix/alpha.
 *       frame_99: attach sprite5 instance at depth 1 with matrix/alpha.
 *       frame_133: _parent.removeMovieClip() → spell complete.
 *
 * Additionally:
 *   - sprite_9 (DefineSprite_9): an arrow/bolt sub-clip placed inside
 *     sprite_10 at frame_46 (depth 1). Its onClipEvent(load) sets
 *     _rotation = _parent.angle. It has a frame_25 stop().
 *   - lib_bulle (DefineSprite_5_bulle): bubble/ice shard particle.
 *       frame_1 DoAction: seeds rx,ry,vx,vy,_alpha, sets onEnterFrame drift.
 *       frame_1 PlaceObject2 CLIPACTIONRECORD onClipEvent(load):
 *                gotoAndPlay(random(5)+1) — stagger animation phase.
 *   - lib_sprite5 (directlyDynamic clipEvent, same characterId=5 as bulle):
 *       Same physics/handlers as bulle but placed directly inside sprite_11
 *       at frames 87 and 99 with specific matrix transforms and alpha.
 *
 * Main timeline frame_2: SOMA.playSound("jet_903"); stop();
 *
 * displayType=50 chosen because:
 *   - sprite_10 reads _parent.cellFrom to position itself at world coords
 *   - sprite_11 reads _parent.cellTo to position itself at world coords
 *   - The harness stores cellFrom/cellTo/angle on root.vars and places
 *     the container at world (0,0).
 *
 * Library symbols:
 *   - bulle     — ice bubble particle. frame_1 seeds physics + onEnterFrame.
 *                 onLoad staggers playhead by random(5)+1.
 *   - sprite5   — directlyDynamic clipEvent symbol (same characterId=5 as
 *                 bulle). Identical physics. Placed inside sprite_11 at
 *                 frames 87 (depth 5) and 99 (depth 1) with specific
 *                 matrix transforms and alphaMult.
 *   - sprite9   — arrow sub-clip inside sprite_10. onLoad sets rotation
 *                 to parent angle. frame_25: stop().
 *   - sprite10  — caster-side launch container (48 frames). frame_1
 *                 positions at cellFrom, computes angle. frame_46: stop()
 *                 + places sprite9.
 *   - sprite11  — target-side impact container (135 frames). frame_1
 *                 positions at cellTo. frame_70: sound + bulle particles
 *                 + signalHit. frame_87/99: sprite5 placements.
 *                 frame_133: removal + complete().
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

// Manifest bounds for librarySymbols entries
const BULLE_BOUNDS = {
  width: 28,
  height: 30.65,
  offsetX: -16.6,
  offsetY: -14.85,
};

// sprite5 shares the same characterId=5 bounds as bulle
const SPRITE5_BOUNDS = {
  width: 28,
  height: 30.65,
  offsetX: -16.6,
  offsetY: -14.85,
};

// sprite_9 bounds from animations[] entry
const SPRITE9_BOUNDS = {
  width: 227.85,
  height: 48.85,
  offsetX: -48.55,
  offsetY: -24.75,
};

// sprite_10 bounds from animations[] entry
const SPRITE10_BOUNDS = {
  width: 227.85,
  height: 131.15,
  offsetX: -49.55,
  offsetY: -123,
};

// sprite_11 bounds from animations[] entry
const SPRITE11_BOUNDS = {
  width: 250.55,
  height: 50.05,
  offsetX: -236.15,
  offsetY: -24.9,
};

export class Spell112 extends RuntimeSpell {
  readonly spellId = 112;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private bulleSym!: SymbolDefinition;
  private sprite5Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;

  // Stash callbacks so frame scripts inside sprite10/sprite11 can play sounds.
  private soundCallbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const bulleAnchor = calculateAnchor(BULLE_BOUNDS);
    const sprite5Anchor = calculateAnchor(SPRITE5_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE10_BOUNDS);
    const sprite11Anchor = calculateAnchor(SPRITE11_BOUNDS);

    // ---- lib_bulle — ice bubble/shard particle -------------------
    // Canonical sources:
    //   scripts/DefineSprite_5_bulle/frame_1/DoAction.as
    //   scripts/DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //
    // onLoad ports the PlaceObject2 CLIPACTIONRECORD:
    //   gotoAndPlay(random(5) + 1);
    //
    // frameScripts[0] ports frame_1/DoAction.as which seeds physics vars
    // and installs the per-tick onEnterFrame handler.
    this.bulleSym = {
      name: "bulle",
      totalFrames: 1,
      frames: textures.getFrames("lib_bulle"),
      anchorX: bulleAnchor.x,
      anchorY: bulleAnchor.y,

      onLoad: (clip) => {
        // AS: scripts/DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/
        //     CLIPACTIONRECORD onClipEvent(load).as
        //   gotoAndPlay(random(5) + 1);
        const startFrame = Math.floor(Math.random() * 5); // random(5) → 0..4; gotoAndPlay(1..5) → 0-based 0..4
        clip.gotoAndPlay(startFrame);
      },

      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: scripts/DefineSprite_5_bulle/frame_1/DoAction.as
            //   rx = 0.7 + 0.15 * Math.random();
            //   ry = 0.8 + 0.15 * Math.random();
            //   vx = 20 + random(25);
            //   vy = -15 + random(30);
            //   _alpha = random(50) + 50;
            //   this.onEnterFrame = function() {
            //     _X = _X + (vx *= rx);
            //     _Y = _Y + (vy *= ry);
            //   };
            clip.vars.rx = 0.7 + 0.15 * Math.random();
            clip.vars.ry = 0.8 + 0.15 * Math.random();
            clip.vars.vx = 20 + Math.floor(Math.random() * 25);
            clip.vars.vy = -15 + Math.floor(Math.random() * 30);
            clip.alpha = (Math.floor(Math.random() * 50) + 50) / 100;

            clip.onEnterFrame = (self) => {
              // AS: _X = _X + (vx *= rx);  _Y = _Y + (vy *= ry);
              let vx = self.vars.vx as number;
              let vy = self.vars.vy as number;
              const rx = self.vars.rx as number;
              const ry = self.vars.ry as number;
              vx *= rx;
              vy *= ry;
              self.x += vx;
              self.y += vy;
              self.vars.vx = vx;
              self.vars.vy = vy;
            };
          },
        ],
      ]),
    };

    // ---- lib_sprite5 — directlyDynamic clipEvent particle --------
    // Canonical sources (same DefineSprite_5 characterId as bulle):
    //   scripts/DefineSprite_5_bulle/frame_1/DoAction.as
    //   scripts/DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //
    // sprite5 is a directlyDynamic clipEvent symbol placed inside sprite_11
    // at frame_87 (depth 5) and frame_99 (depth 1) per manifest placements[].
    // It shares the same physics as bulle (same characterId=5 / same AS source).
    //
    // Placement transforms from manifest:
    //   frame_87 (0-based: 86), depth 5:
    //     scaleX=1.1988, scaleY=1.1988, translateX=-80.8, translateY=-0.9
    //     alphaMult=46 (out of 256) → alpha = 46/256 ≈ 0.18
    //   frame_99 (0-based: 98), depth 1:
    //     scaleX=1.6329, scaleY=1.6329, translateX=-36, translateY=-0.65
    //     alphaMult=46 → alpha = 46/256 ≈ 0.18
    //
    // These are applied after attach() in the parent sprite11 frameScripts.
    this.sprite5Sym = {
      name: "sprite5",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,

      onLoad: (clip) => {
        // AS: scripts/DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/
        //     CLIPACTIONRECORD onClipEvent(load).as
        //   gotoAndPlay(random(5) + 1);
        const startFrame = Math.floor(Math.random() * 5);
        clip.gotoAndPlay(startFrame);
      },

      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: scripts/DefineSprite_5_bulle/frame_1/DoAction.as
            //   rx = 0.7 + 0.15 * Math.random();
            //   ry = 0.8 + 0.15 * Math.random();
            //   vx = 20 + random(25);
            //   vy = -15 + random(30);
            //   _alpha = random(50) + 50;
            //   this.onEnterFrame = function() {
            //     _X = _X + (vx *= rx);
            //     _Y = _Y + (vy *= ry);
            //   };
            clip.vars.rx = 0.7 + 0.15 * Math.random();
            clip.vars.ry = 0.8 + 0.15 * Math.random();
            clip.vars.vx = 20 + Math.floor(Math.random() * 25);
            clip.vars.vy = -15 + Math.floor(Math.random() * 30);
            // Note: _alpha set here is overridden by the placement's
            // colorTransform.alphaMult (46/256 ≈ 0.18), applied after
            // attach() in the parent frameScript. The DoAction _alpha
            // is the "natural" per-particle variation; the placement
            // alphaMult is the scene-level multiplier. We apply the
            // placement alphaMult in the parent frameScript post-attach,
            // so this sets the particle's own random alpha first.
            clip.alpha = (Math.floor(Math.random() * 50) + 50) / 100;

            clip.onEnterFrame = (self) => {
              // AS: _X = _X + (vx *= rx);  _Y = _Y + (vy *= ry);
              let vx = self.vars.vx as number;
              let vy = self.vars.vy as number;
              const rx = self.vars.rx as number;
              const ry = self.vars.ry as number;
              vx *= rx;
              vy *= ry;
              self.x += vx;
              self.y += vy;
              self.vars.vx = vx;
              self.vars.vy = vy;
            };
          },
        ],
      ]),
    };

    // ---- sprite9 — arrow/bolt sub-clip inside sprite_10 ----------
    // Canonical sources:
    //   scripts/DefineSprite_9/frame_25/DoAction.as  → stop()
    //   scripts/DefineSprite_10/frame_46/PlaceObject2_9_1/
    //     CLIPACTIONRECORD onClipEvent(load).as → _rotation = _parent.angle;
    //
    // sprite_9 is the visual arrow animation (27 frames from animations[]).
    // It is placed inside sprite_10 at frame_46 (depth 1).
    // Its onClipEvent(load) reads _parent.angle (= sprite_10's computed angle
    // stored in clip.vars.angle).
    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 27,
      frames: textures.getFrames("sprite_9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,

      onLoad: (clip) => {
        // AS: scripts/DefineSprite_10/frame_46/PlaceObject2_9_1/
        //     CLIPACTIONRECORD onClipEvent(load).as
        //   _rotation = _parent.angle;
        // _parent here is sprite_10; vars.angle was set in its frame_1 script.
        const angleDeg = (clip.parent?.vars.angle as number) ?? 0;
        clip.rotation = (angleDeg * Math.PI) / 180;
      },

      frameScripts: new Map([
        [
          24,
          (clip) => {
            // AS: scripts/DefineSprite_9/frame_25/DoAction.as
            //   stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite10 — caster-side launch container, 48 frames ------
    // Canonical sources:
    //   scripts/DefineSprite_10/frame_1/DoAction.as
    //   scripts/DefineSprite_10/frame_1/DoAction_2.as
    //   scripts/DefineSprite_10/frame_46/DoAction.as
    //
    // frame_1 (index 0):
    //   SOMA.playSound("herbe");
    //   _rotation = 0;
    //   _X = _parent.cellFrom.x;
    //   _Y = _parent.cellFrom.y - 80;
    //   dx = _parent.cellTo.x - _parent.cellFrom.x;
    //   dy = _parent.cellTo.y + 10 - _parent.cellFrom.y + 80;
    //   angle = Math.atan2(dy, dx) * 180 / 3.1415;
    //
    // frame_46 (index 45):
    //   stop();
    //   (PlaceObject2 places sprite_9 at depth 1 — we attach it explicitly
    //    so its CLIPACTIONRECORD onLoad fires)
    this.sprite10Sym = {
      name: "sprite10",
      totalFrames: 48,
      frames: textures.getFrames("sprite_10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: scripts/DefineSprite_10/frame_1/DoAction.as
            //   SOMA.playSound("herbe");
            if (this.soundCallbacks) {
              this.soundCallbacks.playSound("herbe");
            }

            // AS: scripts/DefineSprite_10/frame_1/DoAction_2.as
            //   _rotation = 0;
            //   _X = _parent.cellFrom.x;
            //   _Y = _parent.cellFrom.y - 80;
            //   dx = _parent.cellTo.x - _parent.cellFrom.x;
            //   dy = _parent.cellTo.y + 10 - _parent.cellFrom.y + 80;
            //   angle = Math.atan2(dy, dx) * 180 / 3.1415;
            clip.rotation = 0;
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 80;
            }
            if (cellFrom && cellTo) {
              const dx = cellTo.x - cellFrom.x;
              const dy = cellTo.y + 10 - cellFrom.y + 80;
              const angleDeg = Math.atan2(dy, dx) * 180 / 3.1415;
              clip.vars.angle = angleDeg;
            }
          },
        ],
        [
          45,
          (clip, ctx) => {
            // AS: scripts/DefineSprite_10/frame_46/DoAction.as
            //   stop();
            clip.stop();
            // PlaceObject2_9_1 places sprite_9 at depth 1 at this frame.
            // We attach it explicitly so its CLIPACTIONRECORD onLoad fires,
            // setting _rotation = _parent.angle.
            if (!clip.children.has("sprite9_arrow")) {
              clip.attach(this.sprite9Sym, "sprite9_arrow", 1, ctx);
            }
          },
        ],
      ]),
    };

    // ---- sprite11 — target-side impact container, 135 frames -----
    // Canonical sources:
    //   scripts/DefineSprite_11/frame_1/DoAction.as
    //   scripts/DefineSprite_11/frame_70/DoAction.as
    //   scripts/DefineSprite_11/frame_70/DoAction_2.as
    //   scripts/DefineSprite_11/frame_70/DoAction_3.as
    //   scripts/DefineSprite_11/frame_133/DoAction.as
    //
    // frame_1 (index 0):
    //   _X = _parent.cellTo.x;
    //   _Y = _parent.cellTo.y - 10;
    //   _rotation = _parent.angle;
    //
    // frame_70 (index 69):
    //   SOMA.playSound("coquille");
    //   c = 1; while (c < 7) { this.attachMovie("bulle","bulle"+c,c); c++ }
    //   this.end();  ← signalHit
    //
    // frame_87 (index 86):
    //   PlaceObject2 places sprite5 at depth 5 with matrix/colorTransform.
    //   (manifest placements[0]: frame=87 → 0-based 86, depth=5,
    //    translateX=-80.8, translateY=-0.9, scaleX=1.1988, alphaMult=46)
    //
    // frame_99 (index 98):
    //   PlaceObject2 places sprite5 at depth 1 with matrix/colorTransform.
    //   (manifest placements[1]: frame=99 → 0-based 98, depth=1,
    //    translateX=-36, translateY=-0.65, scaleX=1.6329, alphaMult=46)
    //
    // frame_133 (index 132):
    //   _parent.removeMovieClip();  ← spell complete
    this.sprite11Sym = {
      name: "sprite11",
      totalFrames: 135,
      frames: textures.getFrames("sprite_11"),
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: scripts/DefineSprite_11/frame_1/DoAction.as
            //   _X = _parent.cellTo.x;
            //   _Y = _parent.cellTo.y - 10;
            //   _rotation = _parent.angle;
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
            // AS: scripts/DefineSprite_11/frame_70/DoAction.as
            //   SOMA.playSound("coquille");
            if (this.soundCallbacks) {
              this.soundCallbacks.playSound("coquille");
            }

            // AS: scripts/DefineSprite_11/frame_70/DoAction_2.as
            //   c = 1;
            //   while (c < 7) {
            //     this.attachMovie("bulle", "bulle" + c, c);
            //     c++;
            //   }
            for (let c = 1; c < 7; c++) {
              clip.attach(this.bulleSym, `bulle${c}`, c, ctx);
            }

            // AS: scripts/DefineSprite_11/frame_70/DoAction_3.as
            //   this.end();  ← damage popup / signalHit
            this.runtime.signalHit();
          },
        ],
        [
          86,
          (clip, ctx) => {
            // manifest librarySymbols sprite5 placements[0]:
            //   parentSpriteId=11, frame=87 (0-based: 86), depth=5, kind="place"
            //   matrix: scaleX=1.1988, scaleY=1.1988, rotateSkew0=0, rotateSkew1=0
            //           translateX=-80.8, translateY=-0.9
            //   colorTransform: alphaMult=46 (out of 256)
            const inst = clip.attach(this.sprite5Sym, "sprite5_d5", 5, ctx);
            inst.x = -80.8;
            inst.y = -0.9;
            inst.scaleX = 1.1988372802734375;
            inst.scaleY = 1.1988372802734375;
            inst.alpha = 46 / 256;
          },
        ],
        [
          98,
          (clip, ctx) => {
            // manifest librarySymbols sprite5 placements[1]:
            //   parentSpriteId=11, frame=99 (0-based: 98), depth=1, kind="place"
            //   matrix: scaleX=1.6329, scaleY=1.6329, rotateSkew0=0, rotateSkew1=0
            //           translateX=-36, translateY=-0.65
            //   colorTransform: alphaMult=46 (out of 256)
            const inst = clip.attach(this.sprite5Sym, "sprite5_d1", 1, ctx);
            inst.x = -36;
            inst.y = -0.65;
            inst.scaleX = 1.632904052734375;
            inst.scaleY = 1.632904052734375;
            inst.alpha = 46 / 256;
          },
        ],
        [
          132,
          (clip) => {
            // AS: scripts/DefineSprite_11/frame_133/DoAction.as
            //   _parent.removeMovieClip();
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
    context: SpellContext,
  ): void {
    // Cache for use in frameScripts (sprite_10 frame_1 plays "herbe",
    // sprite_11 frame_70 plays "coquille").
    this.soundCallbacks = callbacks;

    // AS: scripts/frame_2/DoAction.as
    //   SOMA.playSound("jet_903");
    //   stop();
    // Main timeline frame_2 — play the launch sound at spell start.
    callbacks.playSound("jet_903");

    // For displayType 50 (WorldAbsolute) the harness does NOT attach
    // any children. We must attach sprite10 and sprite11 explicitly,
    // mirroring the implicit main-timeline PlaceObject2 placements.
    // sprite_10 is placed at main timeline frame_1 (depth 1).
    // sprite_11 is placed at main timeline frame_1 (depth 2).
    this.root.attach(this.sprite10Sym, "sprite10", 1, context);
    this.root.attach(this.sprite11Sym, "sprite11", 2, context);
  }
}
