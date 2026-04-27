/**
 * Spell 112 — Herbe Vive (Osamodas / Cra grass arrow).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/112/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute).
 *
 * Why WorldAbsolute: The spell has TWO parallel authored timelines —
 * DefineSprite_10 (sprite_10, caster-side) and DefineSprite_11
 * (sprite_11, target-side) — that both position themselves using
 * `_parent.cellFrom` / `_parent.cellTo` in WORLD coords. This
 * matches the WorldAbsolute / WorldAbsoluteAlt pattern exactly.
 * Because the canonical main timeline frame_2 plays "jet_903" and
 * stops (same 2-frame structure as spell 909), we use WorldAbsoluteAlt
 * (51) to match the Alt variant.
 *
 * Library symbols:
 *   - lib_bulle — single-frame bubble particle. onLoad seeds vx/vy
 *     and alpha; onEnterFrame drifts with rx/ry friction. Attached in
 *     batches of 6 inside DefineSprite_11 at frame_70.
 *
 * Authored timelines (container-only, no lib_ prefix):
 *   - sprite_10 (DefineSprite_10): 48 frames, caster-side.
 *       frame_1:  play "herbe" sound; position at cellFrom (-80 y);
 *                 compute angle to target.
 *       frame_46: stop(). Contains an inner sprite_9 (DefineSprite_9)
 *                 placed at frame_46 whose onClipEvent(load) sets
 *                 its own rotation to _parent.angle.
 *   - sprite_11 (DefineSprite_11): 135 frames, target-side.
 *       frame_1:  position at cellTo (-10 y); set rotation to angle.
 *       frame_70: play "coquille"; spawn 6 bulle particles; signalHit.
 *       frame_133: _parent.removeMovieClip → spell complete.
 *
 *   - sprite_9 (DefineSprite_9): inner child of sprite_10, placed at
 *     depth 1 on frame_46. frame_25 → stop(). Its onClipEvent(load)
 *     sets _rotation = _parent.angle. We register this as a
 *     container-only symbol; the harness parent for load is sprite_10.
 *
 * Main timeline (frame_2/DoAction.as): SOMA.playSound("jet_903"); stop();
 * The sounds list also shows frame_0="herbe" and frame_69="coquille"
 * (those come from the sub-sprite frame scripts, not the main timeline).
 *
 * Signal/complete wiring:
 *   - signalHit: DefineSprite_11/frame_70/DoAction_3: `this.end()`
 *   - complete:  DefineSprite_11/frame_133: `_parent.removeMovieClip()`
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

const BULLE_BOUNDS = {
  width: 28,
  height: 30.65,
  offsetX: -16.6,
  offsetY: -14.85,
};

export class Spell112 extends RuntimeSpell {
  readonly spellId = 112;
  readonly displayType = SpellDisplayType.WorldAbsoluteAlt;

  private bulleSym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const bulleAnchor = calculateAnchor(BULLE_BOUNDS);

    // ---- lib_bulle — bubble particle spawned at target impact ----
    // AS DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   gotoAndPlay(random(5) + 1);
    // AS DefineSprite_5_bulle/frame_1/DoAction.as:
    //   rx = 0.7 + 0.15 * Math.random();
    //   ry = 0.8 + 0.15 * Math.random();
    //   vx = 20 + random(25);
    //   vy = -15 + random(30);
    //   _alpha = random(50) + 50;
    //   this.onEnterFrame = function() {
    //     _X = _X + (vx *= rx);
    //     _Y = _Y + (vy *= ry);
    //   };
    this.bulleSym = {
      name: "bulle",
      totalFrames: 1,
      frames: textures.getFrames("lib_bulle"),
      anchorX: bulleAnchor.x,
      anchorY: bulleAnchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/onClipEvent(load):
        // gotoAndPlay(random(5) + 1) — jumps to a random frame in [1,5]
        // (0-based: [0,4])
        const startFrame = Math.floor(Math.random() * 5);
        clip.gotoAndPlay(startFrame);
        void ctx; // ctx not used here
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_5_bulle/frame_1/DoAction.as
            const rx = 0.7 + 0.15 * Math.random();
            const ry = 0.8 + 0.15 * Math.random();
            const vx = 20 + Math.floor(Math.random() * 25);
            const vy = -15 + Math.floor(Math.random() * 30);
            const alpha = Math.floor(Math.random() * 50) + 50;
            clip.vars.rx = rx;
            clip.vars.ry = ry;
            clip.vars.vx = vx;
            clip.vars.vy = vy;
            clip.alpha = alpha / 100;
            clip.onEnterFrame = (c) => {
              // AS: _X = _X + (vx *= rx); _Y = _Y + (vy *= ry);
              let cvx = c.vars.vx as number;
              let cvy = c.vars.vy as number;
              const crx = c.vars.rx as number;
              const cry = c.vars.ry as number;
              cvx *= crx;
              cvy *= cry;
              c.x += cvx;
              c.y += cvy;
              c.vars.vx = cvx;
              c.vars.vy = cvy;
            };
          },
        ],
      ]),
    };

    // ---- sprite_9 (DefineSprite_9) — inner child of sprite_10 ----
    // Placed inside sprite_10 at frame_46 (depth 1).
    // AS DefineSprite_10/frame_46/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   _rotation = _parent.angle;
    // AS DefineSprite_9/frame_25/DoAction.as:
    //   stop();
    this.sprite9Sym = {
      name: "sprite_9",
      totalFrames: 27,
      frames: textures.getFrames("sprite_9"),
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_10/frame_46/PlaceObject2_9_1/onClipEvent(load):
        // _rotation = _parent.angle;
        const parent = clip.parent;
        const angleDeg = (parent?.vars.angle as number) ?? 0;
        clip.rotation = (angleDeg * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          24,
          (clip) => {
            // AS DefineSprite_9/frame_25/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_10 (DefineSprite_10) — caster-side timeline ------
    // 48 frames.
    // AS DefineSprite_10/frame_1/DoAction.as:
    //   SOMA.playSound("herbe");
    // AS DefineSprite_10/frame_1/DoAction_2.as:
    //   _rotation = 0;
    //   _X = _parent.cellFrom.x;
    //   _Y = _parent.cellFrom.y - 80;
    //   dx = _parent.cellTo.x - _parent.cellFrom.x;
    //   dy = _parent.cellTo.y + 10 - _parent.cellFrom.y + 80;
    //   angle = Math.atan2(dy,dx) * 180 / 3.1415;
    // AS DefineSprite_10/frame_46/DoAction.as:
    //   stop();
    // At frame_46, sprite_9 is placed (PlaceObject2_9_1 depth 1) with onClipEvent(load).
    this.sprite10Sym = {
      name: "sprite_10",
      totalFrames: 48,
      frames: textures.getFrames("sprite_10"),
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_10/frame_1/DoAction.as: SOMA.playSound("herbe");
            // (sound stored in onSpellStart via the sounds[] list at frame 0)
            // AS DefineSprite_10/frame_1/DoAction_2.as: position + angle
            clip.rotation = 0;
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 80;
            }
            // Compute angle to target and store on this clip's vars
            // so sprite_9's onLoad can read _parent.angle.
            if (cellFrom && cellTo) {
              const dx = cellTo.x - cellFrom.x;
              const dy = cellTo.y + 10 - cellFrom.y + 80;
              const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
              clip.vars.angle = angleDeg;
            }
            void ctx;
          },
        ],
        [
          45,
          (clip, ctx) => {
            // AS DefineSprite_10/frame_46/DoAction.as: stop();
            // Also: PlaceObject2_9_1 is placed here — attach sprite_9 as depth-1 child.
            clip.stop();
            // Attach sprite_9 at depth 1 — its onLoad reads clip.vars.angle
            clip.attach(this.sprite9Sym, "sprite_9_1", 1, ctx);
          },
        ],
      ]),
    };

    // ---- sprite_11 (DefineSprite_11) — target-side timeline ------
    // 135 frames.
    // AS DefineSprite_11/frame_1/DoAction.as:
    //   _X = _parent.cellTo.x;
    //   _Y = _parent.cellTo.y - 10;
    //   _rotation = _parent.angle;
    // AS DefineSprite_11/frame_70/DoAction.as:
    //   SOMA.playSound("coquille");
    // AS DefineSprite_11/frame_70/DoAction_2.as:
    //   c = 1; while(c < 7) { this.attachMovie("bulle","bulle" + c,c); c++; }
    // AS DefineSprite_11/frame_70/DoAction_3.as:
    //   this.end();  ← signalHit
    // AS DefineSprite_11/frame_133/DoAction.as:
    //   _parent.removeMovieClip();  ← spell complete
    this.sprite11Sym = {
      name: "sprite_11",
      totalFrames: 135,
      frames: textures.getFrames("sprite_11"),
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_11/frame_1/DoAction.as
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
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
            // AS DefineSprite_11/frame_70/DoAction.as: SOMA.playSound("coquille");
            // (sound triggered via onSpellStart captured callback — see below)
            this.soundCallback?.("coquille");
            // AS DefineSprite_11/frame_70/DoAction_2.as:
            // c = 1; while(c < 7) { this.attachMovie("bulle","bulle" + c,c); c++; }
            for (let c = 1; c < 7; c++) {
              clip.attach(this.bulleSym, `bulle${c}`, c, ctx);
            }
            // AS DefineSprite_11/frame_70/DoAction_3.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          132,
          (clip) => {
            // AS DefineSprite_11/frame_133/DoAction.as: _parent.removeMovieClip()
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

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback so frame scripts inside sprite_11 can fire it.
    this.soundCallback = callbacks.playSound;

    // AS frame_2/DoAction.as: SOMA.playSound("jet_903"); stop();
    callbacks.playSound("jet_903");

    // The "herbe" sound fires from DefineSprite_10/frame_1 — but since
    // we need it immediately when sprite_10 starts (frame_1 = frame index 0),
    // we play it here too to match the manifest sounds[] entry at frame 0.
    callbacks.playSound("herbe");

    // Attach the two parallel authored timelines to root.
    // They will position themselves via their frame_1 scripts using
    // root.vars.cellFrom / root.vars.cellTo / root.vars.angle.
    this.root.attach(this.sprite10Sym, "sprite10", 1, context);
    this.root.attach(this.sprite11Sym, "sprite11", 2, context);
  }
}
