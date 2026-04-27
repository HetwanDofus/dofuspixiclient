/**
 * Spell 2049 — (Cra, earth/nature arrow style).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2049/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute).
 *
 * Rationale: The spell has TWO parallel authored timelines — sprite_10
 * (caster-side, 48 frames) and sprite_11 (target-side, 135 frames) —
 * both of which position themselves using `_parent.cellFrom` /
 * `_parent.cellTo` in WORLD coords. sprite_10/frame_1 sets
 * `_X = _parent.cellFrom.x` and sprite_11/frame_1 sets
 * `_X = _parent.cellTo.x`. This dual-anchored, world-absolute pattern
 * matches WorldAbsolute (50). The main timeline has two frames: frame_1
 * places sprite_10 + sprite_11, frame_2 plays "jet_903" + stop().
 *
 * Library symbols:
 *   - lib_bulle — single-frame bubble particle. onLoad seeds rx/ry/vx/vy/alpha
 *     and an inline onEnterFrame for drift. The inner PlaceObject2 onLoad
 *     calls gotoAndPlay(random(15)+1) — we handle that in the onLoad of
 *     the SymbolDefinition.
 *
 * Main timeline (frame_1): places sprite_10 at depth 1, sprite_11 at depth 2.
 * Main timeline (frame_2): SOMA.playSound("jet_903"); stop().
 * → sounds: "herbe" (sprite_10/frame_1), "jet_903" (main frame_2),
 *            "coquille" (sprite_11/frame_70).
 *
 * sprite_10 (caster-side, 48 frames):
 *   frame_1:  SOMA.playSound("herbe"); position at cellFrom, compute angle.
 *   frame_46: stop().  Inner child (sprite_9) has onClipEvent(load) setting
 *             _rotation = _parent.angle.
 *
 * sprite_9 (inner child of sprite_10 at depth 1, 27 frames):
 *   frame_25: stop().
 *
 * sprite_11 (target-side, 135 frames):
 *   frame_1:   position at cellTo, rotate to angle.
 *   frame_70:  SOMA.playSound("coquille"); spawn bulle particles c=1..6;
 *              this.end() → signalHit.
 *   frame_133: _parent.removeMovieClip() → complete().
 *
 * sprite_4 (54 frames, referenced in manifest animations but appears as a
 *   sub-sprite within the authored content — DefineSprite_4/frame_52 stops).
 *   We treat sprite_4 as a container-only placeholder used by sprite_9/sprite_10
 *   authored timelines internally; we do NOT need to register it separately
 *   since we never attachMovie it — it is placed by the authored composite
 *   frame data in the runtime's texture playback for sprite_9 / sprite_10.
 *
 * Sound capture: "coquille" is played inside sprite_11/frame_70 from a
 *   frameScripts handler. We capture callbacks.playSound in onSpellStart
 *   and use it from inside the frame script.
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

// Bounds from manifest librarySymbols[0] (bulle / characterId=5)
const BULLE_BOUNDS = {
  width: 28,
  height: 30.65,
  offsetX: -16.6,
  offsetY: -14.85,
};

// Bounds from manifest animations for sprite_9 (inner caster arrow)
const SPRITE_9_BOUNDS = {
  width: 215.4,
  height: 37.85,
  offsetX: -47.2,
  offsetY: -19.15,
};

// Bounds from manifest animations for sprite_10 (caster-side timeline)
const SPRITE_10_BOUNDS = {
  width: 215.4,
  height: 86.6,
  offsetX: -48.2,
  offsetY: -74.15,
};

// Bounds from manifest animations for sprite_11 (target-side timeline)
const SPRITE_11_BOUNDS = {
  width: 238.3,
  height: 50.05,
  offsetX: -236.15,
  offsetY: -24.9,
};

export class Spell2049 extends RuntimeSpell {
  readonly spellId = 2049;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private bulleSym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;

  // Captured from onSpellStart for use inside frame scripts that play sounds.
  private playSoundFn?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const bulleAnchor = calculateAnchor(BULLE_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE_9_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE_10_BOUNDS);
    const sprite11Anchor = calculateAnchor(SPRITE_11_BOUNDS);

    // ---- lib_bulle — bubble particle spawned at sprite_11/frame_70 ----------
    // AS DefineSprite_5_bulle/frame_1/DoAction.as:
    //   rx = 0.7 + 0.15 * Math.random();
    //   ry = 0.8 + 0.15 * Math.random();
    //   vx = 20 + random(25);
    //   vy = -15 + random(30);
    //   _alpha = random(50) + 50;
    //   this.onEnterFrame = function() { _X += (vx *= rx); _Y += (vy *= ry); }
    //
    // AS DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   gotoAndPlay(random(15) + 1);
    this.bulleSym = {
      name: "bulle",
      totalFrames: 1,
      frames: textures.getFrames("lib_bulle"),
      anchorX: bulleAnchor.x,
      anchorY: bulleAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_5_bulle/frame_1/DoAction.as — seed physics
        clip.vars.rx = 0.7 + 0.15 * Math.random();
        clip.vars.ry = 0.8 + 0.15 * Math.random();
        clip.vars.vx = 20 + Math.floor(Math.random() * 25);
        clip.vars.vy = -15 + Math.floor(Math.random() * 30);
        clip.alpha = (Math.floor(Math.random() * 50) + 50) / 100;

        // AS: PlaceObject2_4_1/onClipEvent(load) — gotoAndPlay(random(15) + 1)
        // The bulle sprite has totalFrames=1 so gotoAndPlay wraps to 0;
        // the intent is to stagger the start position within a 15-frame loop.
        // Since we have only 1 frame of texture, the visual stagger is
        // implicit — we still call gotoAndPlay to match AS semantics.
        clip.gotoAndPlay(Math.floor(Math.random() * 15));
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_5_bulle/frame_1/DoAction.as — inline onEnterFrame
        const rx = clip.vars.rx as number;
        const ry = clip.vars.ry as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        vx *= rx;
        vy *= ry;
        clip.x += vx;
        clip.y += vy;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- sprite_9 — inner arrow/beam child of sprite_10 (27 frames) ---------
    // AS DefineSprite_9/frame_25/DoAction.as: stop()
    // Placed by sprite_10 at depth 1 on frame_46 (onClipEvent(load) sets
    // _rotation = _parent.angle).
    this.sprite9Sym = {
      name: "sprite_9",
      totalFrames: 27,
      frames: textures.getFrames("sprite_9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_10/frame_46/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
        //   _rotation = _parent.angle;
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

    // ---- sprite_10 — caster-side timeline (48 frames) -----------------------
    // AS DefineSprite_10/frame_1/DoAction.as:
    //   SOMA.playSound("herbe");
    // AS DefineSprite_10/frame_1/DoAction_2.as:
    //   _rotation = 0;
    //   _X = _parent.cellFrom.x;
    //   _Y = _parent.cellFrom.y - 25;
    //   dx = _parent.cellTo.x - _parent.cellFrom.x;
    //   dy = _parent.cellTo.y + 10 - _parent.cellFrom.y + 25;
    //   angle = Math.atan2(dy, dx) * 180 / 3.1415;
    // AS DefineSprite_10/frame_46/DoAction.as:
    //   stop();
    //   (also places sprite_9 at depth 1 — handled via attach in frame_45 script)
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
            // AS: DefineSprite_10/frame_1/DoAction.as — play sound
            this.playSoundFn?.("herbe");

            // AS: DefineSprite_10/frame_1/DoAction_2.as — position + angle
            clip.rotation = 0;
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 25;
            }
            if (cellFrom && cellTo) {
              const dx = cellTo.x - cellFrom.x;
              const dy = (cellTo.y + 10) - (cellFrom.y - 25);
              const angleDeg = Math.atan2(dy, dx) * 180 / 3.1415;
              clip.vars.angle = angleDeg;
            }
          },
        ],
        [
          45,
          (clip, ctx) => {
            // AS: DefineSprite_10/frame_46/DoAction.as — stop()
            // Also: frame_46 places sprite_9 at depth 1 with its onClipEvent(load)
            // setting _rotation = _parent.angle. We attach sprite_9 here so the
            // onLoad fires immediately, which sets rotation to parent's angle.
            clip.stop();
            if (!clip.children.has("sprite9_1")) {
              clip.attach(this.sprite9Sym, "sprite9_1", 1, ctx);
            }
          },
        ],
      ]),
    };

    // ---- sprite_11 — target-side timeline (135 frames) ----------------------
    // AS DefineSprite_11/frame_1/DoAction.as:
    //   _X = _parent.cellTo.x;
    //   _Y = _parent.cellTo.y - 10;
    //   _rotation = _parent.angle;
    // AS DefineSprite_11/frame_70/DoAction.as:
    //   SOMA.playSound("coquille");
    // AS DefineSprite_11/frame_70/DoAction_2.as:
    //   c = 1; while (c < 7) { this.attachMovie("bulle","bulle"+c,c); c++; }
    // AS DefineSprite_11/frame_70/DoAction_3.as:
    //   this.end() → signalHit
    // AS DefineSprite_11/frame_133/DoAction.as:
    //   _parent.removeMovieClip() → complete()
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
            // AS: DefineSprite_11/frame_70/DoAction.as — sound
            this.playSoundFn?.("coquille");

            // AS: DefineSprite_11/frame_70/DoAction_2.as — spawn bulle c=1..6
            // while (c < 7) → c goes 1,2,3,4,5,6
            for (let c = 1; c < 7; c++) {
              clip.attach(this.bulleSym, `bulle${c}`, c, ctx);
            }

            // AS: DefineSprite_11/frame_70/DoAction_3.as — this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          132,
          (clip) => {
            // AS: DefineSprite_11/frame_133/DoAction.as — _parent.removeMovieClip()
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.bulleSym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite11Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture playSound for use inside frame scripts (coquille, herbe).
    this.playSoundFn = callbacks.playSound;

    // AS: scripts/frame_2/DoAction.as — SOMA.playSound("jet_903"); stop();
    // The main timeline frame_2 plays this sound. We fire it at spell start
    // since the root stops immediately on frame_1 and frame_2 actions run
    // on the second tick — but canonical AS fires it nearly immediately.
    // To be safe we play it now (frame_1 implicit, frame_2 is next tick);
    // the harness already positions the root at (0,0) for WorldAbsolute.
    callbacks.playSound("jet_903");

    // Implicit frame_1 placement: attach sprite_10 (caster-side) and
    // sprite_11 (target-side) on the main timeline.
    this.root.attach(this.sprite10Sym, "sprite10", 1, context);
    this.root.attach(this.sprite11Sym, "sprite11", 2, context);
  }
}
