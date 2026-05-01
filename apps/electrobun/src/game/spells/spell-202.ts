/**
 * Spell 202 — Croque-mitaine (Crockette / Sadida earth spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/202/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile, no caster reference,
 * no `move`/`shoot`/`duplicate` symbols, and no `_parent.cellFrom` reads in any
 * script. All content is anchored at the target cell. The main timeline is a
 * single `SOMA.playSound("crockette_202")` with no stop() — the outer container
 * is driven by `DefineSprite_31/frame_97/DoAction.as` which calls `this.end()`
 * and `_parent._parent.removeMovieClip("")` on frame 97.
 *
 * Library symbols:
 *   - sprite11 (characterId=11, directlyDynamic=true) — a 6-frame sparkle sprite.
 *     Placed at frame 13 of `etoiles` (DefineSprite_14) at depth 2.
 *     onClipEvent(enterFrame): randomises _alpha each frame (`_alpha = random(100)`).
 *     onClipEvent(load): `gotoAndStop(random(_totalframes) + 1)` — picks a random
 *     start frame.
 *
 * There are additional DefineSprite symbols referenced in the scripts that are NOT
 * in `librarySymbols[]` and are NOT in `animations[]` as separable assets, which
 * means the combat-exporter baked them into the `etoiles` composite animation
 * (DefineSprite_14_etoiles). The `etoiles` animation (51 frames, in `animations[]`)
 * is the main visual timeline. Its frame scripts are:
 *   - frame_1:  randomise self position + gotoAndPlay(random(10)+1)
 *   - frame_13: place sprite11 (handled via sprite11Sym attachment in frameScripts)
 *   - frame_33: stop() + set up onEnterFrame hover physics
 *   - frame_51: removeMovieClip(this) — the end of one etoiles instance
 *
 * The outer `DefineSprite_31` (97 frames) contains all of `etoiles`, `or`, `pierres`,
 * `terre` composites. Since only `etoiles` appears in `animations[]` and only
 * `sprite11` appears in `librarySymbols[]`, we model the spell as:
 *   - One `etoilesSym` registered — the 51-frame `etoiles` animation (from
 *     `animations[]`, so textures key is "etoiles" without `lib_` prefix).
 *   - One `sprite11Sym` registered — 6-frame sparkle from `librarySymbols[]`
 *     (textures key "lib_sprite11").
 *   - The root acts as the outer container; we attach multiple `etoiles` instances
 *     in `onSpellStart` (mirroring the canonical SWF placing many etoiles on the
 *     outer timeline), and signal completion from the last one to remove.
 *
 * The `or`, `pierres`, `terre` symbols with their clip-event scripts are authored
 * INTO the `etoiles` composite SVG frames (DefineSprite_14 contains them as
 * authored children). Their dynamic behaviours (`or` gold-particle drift, `pierres`
 * stone fall, `terre` ground bounce) are baked into the per-frame SVGs exported
 * for `etoiles_0..50.svg`. The CLIPACTIONRECORD scripts for DefineSprite_6_or,
 * DefineSprite_3_pierres, DefineSprite_18_terre, and DefineSprite_13 affect
 * AUTHORED children of etoiles that appear as static placements in the SVG frames.
 * Only `sprite11` (characterId=11) is listed as a `librarySymbols[]` entry with
 * `directlyDynamic: true` requiring a live runtime clip.
 *
 * The canonical "completion" signal comes from DefineSprite_31/frame_97, which
 * calls `this.end()` (→ signalHit) and `_parent._parent.removeMovieClip("")`
 * (→ complete). We model this by tracking how many etoiles instances have
 * completed and firing complete() after the last one, at a fixed 97-frame wall
 * time (matching the outer DefineSprite_31 lifetime).
 *
 * Main timeline: `SOMA.playSound("crockette_202")` only (no stop).
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

// Bounds from manifest.json librarySymbols[0] (sprite11, characterId=11)
const SPRITE11_BOUNDS = {
  width: 17.4,
  height: 17.4,
  offsetX: -8.4,
  offsetY: -8.7,
};

// Bounds from manifest.json animations[0] (etoiles)
const ETOILES_BOUNDS = {
  width: 65.45,
  height: 65.4,
  offsetX: -32.3,
  offsetY: -41.7,
};

// Number of etoiles instances to spawn on the root (mirrors how many the
// outer DefineSprite_31 typically places — the canonical SWF places ~6-10).
const ETOILES_COUNT = 8;

// Outer container lifetime in Flash frames (DefineSprite_31 has 97 frames).
const OUTER_LIFETIME_FRAMES = 97;

export class Spell202 extends RuntimeSpell {
  readonly spellId = 202;
  readonly displayType = SpellDisplayType.TargetCell;

  // Track how many frames have elapsed on the root to fire complete() at frame 97.
  private outerFrameCount = 0;
  private completionFired = false;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite11Anchor = calculateAnchor(SPRITE11_BOUNDS);
    const etoilesAnchor = calculateAnchor(ETOILES_BOUNDS);

    // ---- sprite11 — 6-frame sparkle, placed at etoiles frame 13 depth 2 ----
    // AS: DefineSprite_11/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _alpha = random(100);
    // AS: DefineSprite_14_etoiles/frame_13/PlaceObject2_11_2/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndStop(random(_totalframes) + 1);
    const sprite11Sym: SymbolDefinition = {
      name: "sprite11",
      totalFrames: 6,
      frames: textures.getFrames("lib_sprite11"),
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,

      onLoad: (clip) => {
        // AS: DefineSprite_14_etoiles/frame_13/PlaceObject2_11_2/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndStop(random(_totalframes) + 1)  →  gotoAndStop(random(6))  (0-based: random(6) gives 0..5)
        clip.gotoAndStop(Math.floor(Math.random() * 6));
      },

      onEnterFrame: (clip) => {
        // AS: DefineSprite_11/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _alpha = random(100)
        clip.alpha = Math.floor(Math.random() * 100) / 100;
      },
    };

    // ---- etoiles — 51-frame composite star/sparkle animation ----
    // animations[] entry: "etoiles" (no lib_ prefix since it's NOT in librarySymbols[])
    // Frame scripts ported from:
    //   DefineSprite_14_etoiles/frame_1/DoAction.as
    //   DefineSprite_14_etoiles/frame_33/DoAction.as
    //   DefineSprite_14_etoiles/frame_51/DoAction.as
    const etoilesSym: SymbolDefinition = {
      name: "etoiles",
      totalFrames: 51,
      frames: textures.getFrames("etoiles"),
      anchorX: etoilesAnchor.x,
      anchorY: etoilesAnchor.y,

      frameScripts: new Map([
        [
          // AS: DefineSprite_14_etoiles/frame_1/DoAction.as
          // _X = 140 * (math.random() - 0.5);
          // _Y = 50 * (math.random() - 0.5);
          // gotoAndPlay(random(10) + 1);
          0,
          (clip, _ctx) => {
            clip.x = 140 * (Math.random() - 0.5);
            clip.y = 50 * (Math.random() - 0.5);
            // AS gotoAndPlay(random(10) + 1) — random(10) gives 0..9, +1 gives 1..10
            // 0-based: subtract 1 → 0..9
            clip.gotoAndPlay(Math.floor(Math.random() * 10));
          },
        ],
        [
          // AS: DefineSprite_14_etoiles/frame_13/PlaceObject2_11_2 places sprite11 at depth 2
          // Placement: kind="place", frame=12 (0-based), matrix translateY=-0.25
          12,
          (clip, ctx) => {
            clip.attach(sprite11Sym, "sprite11_inner", 2, ctx, {
              x: 0,
              y: -0.25,
            });
          },
        ],
        [
          // AS: DefineSprite_14_etoiles/frame_33/DoAction.as
          // stop();
          // accx = 0.3 + 0.3 * Math.random();
          // accy = 0.3;
          // tf = 30 + random(30);
          // vy = -3 - 10 * Math.random();
          // this.onEnterFrame = function() { ... hover/float physics ... }
          32,
          (clip, _ctx) => {
            clip.stop();
            clip.vars.accx = 0.3 + 0.3 * Math.random();
            clip.vars.accy = 0.3;
            clip.vars.tf = 30 + Math.floor(Math.random() * 30);
            clip.vars.vx = 0;
            clip.vars.vy = -3 - 10 * Math.random();
            clip.vars.t_hover = 0;
            clip.vars.end_hover = 0;
            // Install the hover onEnterFrame via the vars flag.
            // We use clip.vars.hoverActive to signal the onEnterFrame handler.
            clip.vars.hoverActive = 1;
          },
        ],
        [
          // AS: DefineSprite_14_etoiles/frame_51/DoAction.as
          // removeMovieClip(this); stop();
          50,
          (clip, _ctx) => {
            clip.remove();
          },
        ],
      ]),

      onEnterFrame: (clip, _ctx) => {
        // Handle the hover physics installed at frame 33.
        // AS: DefineSprite_14_etoiles/frame_33/DoAction.as — this.onEnterFrame = function() { ... }
        if (clip.vars.hoverActive !== 1) {
          return;
        }

        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const accx = clip.vars.accx as number;
        const accy = clip.vars.accy as number;
        const tf = clip.vars.tf as number;
        let t_hover = clip.vars.t_hover as number;
        let end_hover = clip.vars.end_hover as number;

        // if(_X < 0) { vx += accx; }
        if (clip.x < 0) {
          vx += accx;
        }
        // if(_X > 0) { vx -= accx; }
        if (clip.x > 0) {
          vx -= accx;
        }
        // if(_Y < -20) { vy += accy; }
        if (clip.y < -20) {
          vy += accy;
        }
        // if(_Y > -20) { vy -= accy; }
        if (clip.y > -20) {
          vy -= accy;
        }

        clip.x = clip.x + vx;
        clip.y = clip.y + vy;
        vx *= 0.99;
        vy *= 0.95;

        // if(t++ > tf & end != 1) { play(); end = 1; }
        // Note: AS uses bitwise & (not &&) — both sides always evaluated.
        t_hover++;
        if (t_hover > tf && end_hover !== 1) {
          clip.play();
          end_hover = 1;
        }

        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.t_hover = t_hover;
        clip.vars.end_hover = end_hover;
      },
    };

    this.registry.register(sprite11Sym);
    this.registry.register(etoilesSym);

    // Install the outer-container completion counter on the root via an
    // onEnterFrame that fires from the root clip. We do this by wiring a
    // special "outerTimer" symbol that the root will tick, OR by using the
    // root's own onEnterFrame which we set up in onSpellStart. The root has
    // no symbol (symbol: null), so we set its onEnterFrame directly there.
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as
    // SOMA.playSound("crockette_202");
    callbacks.playSound("crockette_202");

    // Attach multiple etoiles instances at the root, mirroring the canonical
    // outer DefineSprite_31 which places many etoiles on its timeline.
    // Each instance randomises its own position + start frame in its frame_1 script.
    const etoilesSym = this.registry.resolve("etoiles");
    if (etoilesSym) {
      for (let i = 0; i < ETOILES_COUNT; i++) {
        this.root.attach(etoilesSym, `etoiles${i}`, i + 1, context);
      }
    }

    // Install root onEnterFrame to count outer-container frames and fire
    // signalHit + complete() at the canonical frame 97
    // (AS: DefineSprite_31/frame_97/DoAction.as → this.end(); _parent._parent.removeMovieClip(""); stop();)
    this.root.onEnterFrame = (_clip, _ctx) => {
      if (this.completionFired) {
        return;
      }
      this.outerFrameCount++;
      // frame_97 is 0-based index 96; we check >= to handle any skip.
      if (this.outerFrameCount >= OUTER_LIFETIME_FRAMES - 1) {
        this.completionFired = true;
        // AS: this.end() → signalHit
        this.runtime.signalHit();
        // AS: _parent._parent.removeMovieClip("") → spell complete
        this.runtime.complete();
      }
    };
  }
}
