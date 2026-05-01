/**
 * Spell 501 — Invocation de Bouftou (Enutrof / generic summon impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/501/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile motion (`move` symbol absent),
 * no caster-side content, no `_parent.cellFrom` references. The main impact
 * (`shoot`, 168 frames) lands at the target cell and contains a `duplicate`
 * sub-sprite that spawns `effet` particles and a `sprite7` clip that throws
 * 10 `pierres` stone fragments via clipEvents.
 *
 * Library symbols:
 *
 *   lib_pierres — single-frame stone fragment particle.
 *     PlaceObject2_12_1/onClipEvent(load): seeds vx/vy/v/vr/scale/alpha, positions
 *       parent (the pierres wrapper) at random scatter around origin.
 *     PlaceObject2_12_1/onClipEvent(enterFrame): bouncing-stone physics — Y gravity,
 *       vr rotation, bounce damping, tps slow-down at c==10 / speed-up at c==75.
 *
 *   lib_effet — 27-frame dust puff composite (librarySymbols entry "effet").
 *     frame_1: random X/Y scatter + gotoAndPlay(random(10)+1) for stagger.
 *     frame_25: stop().
 *
 *   lib_sprite7 — 285-frame "stone thrower" container, directlyDynamic, placed
 *     inside shoot at frame 6 (depth 2) at offset (0.45, -5.15). Its
 *     onClipEvent(load) spawns 10 pierres particles inside itself. It also has
 *     a gradual alpha fade encoded in `placements[]` from frame 145→162 which
 *     we port as per-frame frameScripts alpha mutations.
 *
 *   duplicate — 1-frame container (animations-only). frame_1: spawns 1 `effet`
 *     child. Attached by shoot/frame_1.
 *
 *   shoot — 168-frame main timeline (animations entry). frame_1: playSound +
 *     attach duplicate. frame_166: _parent.removeMovieClip + complete().
 *     frame_6 (inside shoot): attach sprite7 at (0.45, -5.15).
 *
 * Main timeline: sound "many_501" is played from DefineSprite_10_shoot/frame_1
 * (unusual — the sound is on the shoot clip, not the outer timeline). The outer
 * main timeline has no explicit frame scripts in the source listing.
 *
 * signalHit: fired at shoot/frame_1 (first frame of impact = hit moment).
 * complete: fired at shoot/frame_165 (AS frame_166 → `_parent.removeMovieClip()`).
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

// ---- Manifest bounds for librarySymbols entries ----

const PIERRES_BOUNDS = {
  width: 6.4,
  height: 4.55,
  offsetX: -3.2,
  offsetY: -2.2,
};

const EFFET_BOUNDS = {
  width: 39.45,
  height: 39.6,
  offsetX: -18.8,
  offsetY: -40.2,
};

const SPRITE7_BOUNDS = {
  width: 0.001, // declared 0×0 in manifest; use near-zero to avoid div-by-zero
  height: 0.001,
  offsetX: -0.5,
  offsetY: 5.05,
};

export class Spell501 extends RuntimeSpell {
  readonly spellId = 501;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold symbol refs so shoot's frameScripts can reference them
  private pierresSym!: SymbolDefinition;
  private effetSym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private duplicateSym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  // Capture sound callback for use from shoot/frame_1
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const effetAnchor = calculateAnchor(EFFET_BOUNDS);
    // sprite7 has 0×0 logical bounds; anchor is effectively (0,0) — centre
    const sprite7Anchor = { x: 0.5, y: 0.5 };

    // ----------------------------------------------------------------
    // lib_pierres — bouncing stone fragment particle
    // ----------------------------------------------------------------
    // The canonical layout:
    //   DefineSprite_13_pierres wraps a child placed at PlaceObject2_12_1.
    //   The child's onClipEvent(load) stores physics vars on ITSELF (_xscale,
    //   _alpha, vx, vy, v, vr, t, c, tps) but positions its PARENT via
    //   `_parent._x` / `_parent._y`.
    //
    // In our runtime, `pierres` IS the clip we attach (it corresponds to
    // DefineSprite_13_pierres). The inner PlaceObject2_12_1 is a static
    // graphic content — its clip-event handlers drive the whole sprite.
    // We collapse the two levels: onLoad seeds vars on the pierres clip
    // itself (which corresponds to what the inner child stored on itself)
    // and also sets clip.x/clip.y directly (which in AS was _parent._x/y,
    // i.e. the pierres clip's own position in its parent = sprite7).
    //
    // AS: DefineSprite_13_pierres/frame_1/PlaceObject2_12_1/onClipEvent(load)
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS: var c = 0; var tps = 1;
        clip.vars.c = 0;
        clip.vars.tps = 1;
        // AS: var vx = 5 * (Math.random() - 0.5);
        clip.vars.vx = 5 * (Math.random() - 0.5);
        // AS: var vy = 2 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        // AS: _parent._x = 20 * (Math.random() - 0.5);
        clip.x = 20 * (Math.random() - 0.5);
        // AS: _parent._y = 10 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        // AS: var t = 60 + 40 * Math.random(); _xscale = t; _yscale = t;
        const t = 60 + 40 * Math.random();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.t = t;
        // AS: _alpha = 20 + random(90);
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        // AS: var v = -15 * Math.random() - 5;
        clip.vars.v = -15 * Math.random() - 5;
        // AS: var vr = 140 * (-0.5 + Math.random());
        clip.vars.vr = 140 * (-0.5 + Math.random());
        // AS: (implicit) _Y = 0 initial; the inner child starts at its own Y=0
        clip.vars.innerY = 0;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_13_pierres/frame_1/PlaceObject2_12_1/onClipEvent(enterFrame)
        let c = clip.vars.c as number;
        let tps = clip.vars.tps as number;
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        let t = clip.vars.t as number; // reused as "landed" flag (t==1 means at rest)
        let innerY = clip.vars.innerY as number;

        // AS: if (c++ == 10) { tps = 0.15; }
        if (c === 10) {
          tps = 0.15;
        }
        c++;
        clip.vars.c = c;
        clip.vars.tps = tps;

        // AS: if (c == 75) { tps = 1; }
        if (c === 75) {
          tps = 1;
          clip.vars.tps = tps;
        }

        // AS: _parent._x += vx * tps; _parent._y += vy * tps;
        clip.x += (vx as number) * tps;
        clip.y += (vy as number) * tps;

        // AS: if (t != 1) { ... } — t==1 means stone has come to rest
        if (t !== 1) {
          // AS: _Y = _Y + v * tps;
          innerY = innerY + v * tps;
          // AS: _rotation = _rotation + vr * tps;
          clip.rotation += (vr * tps * Math.PI) / 180;
          // AS: v += 0.75 * tps;
          v += 0.75 * tps;

          if (innerY > 0) {
            // AS: _parent.vx /= 2; _parent.vy /= 5;
            // In canonical AS the inner child modifies _parent (the pierres clip).
            // Here vx/vy are vars on clip itself — divide in place.
            clip.vars.vx = (clip.vars.vx as number) / 2;
            clip.vars.vy = (clip.vars.vy as number) / 5;
            // AS: _rotation = 0;
            clip.rotation = 0;
            // AS: _Y = 0;
            innerY = 0;
            // AS: v = (-v) / 4;
            v = (-v) / 4;
            // AS: if (Math.abs(v) < 1) { vx = 0; vy = 0; t = 1; }
            if (Math.abs(v) < 1) {
              clip.vars.vx = 0;
              clip.vars.vy = 0;
              t = 1;
            }
          }

          clip.vars.v = v;
          clip.vars.vr = vr;
          clip.vars.t = t;
          clip.vars.innerY = innerY;
        }
      },
    };

    // ----------------------------------------------------------------
    // lib_effet — 27-frame dust puff
    // ----------------------------------------------------------------
    // AS: DefineSprite_3_effet/frame_1/DoAction.as
    //   _X = 30 * (-0.5 + Math.random());
    //   _Y = 10 * (-0.5 + Math.random());
    //   gotoAndPlay(random(10) + 1);
    // AS: DefineSprite_3_effet/frame_25/DoAction.as
    //   stop();
    this.effetSym = {
      name: "effet",
      totalFrames: 27,
      frames: textures.getFrames("lib_effet"),
      anchorX: effetAnchor.x,
      anchorY: effetAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_3_effet/frame_1/DoAction.as
            clip.x = 30 * (-0.5 + Math.random());
            clip.y = 10 * (-0.5 + Math.random());
            // AS: gotoAndPlay(random(10) + 1) → 0-based: random(10) + 0
            clip.gotoAndPlay(Math.floor(Math.random() * 10));
          },
        ],
        [
          24,
          (clip) => {
            // AS: DefineSprite_3_effet/frame_25/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_sprite7 — 285-frame stone-thrower container (directlyDynamic)
    // ----------------------------------------------------------------
    // Placed inside shoot at frame 6 (AS frame_7) at depth 2, offset (0.45, -5.15).
    // Its onClipEvent(load) (DefineSprite_7/frame_1/PlaceObject2_6_1/onClipEvent(load))
    // spawns 10 `pierres` particles.
    // The placements[] also encode a linear alpha fade from frame 145→162 on
    // this clip (alphaMult steps 243→23 over 18 frames). We port this as
    // per-frame frameScripts for those frames.
    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 285,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      onLoad: (clip, ctx) => {
        // AS: DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load)
        // c = 0; while (c < 10) { this.attachMovie("pierres","pierres"+c,c); c++; }
        // Note: "this" in AS refers to the PlaceObject2_6_1 child, which we
        // model as the sprite7 clip itself (collapsed hierarchy).
        let c = 0;
        while (c < 10) {
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
          c++;
        }
      },
      frameScripts: new Map([
        // Alpha fade: placements[] kind:"move" frames 145-162 on parentSpriteId=10 (shoot).
        // These are PlaceObject2 MOVE records applied to sprite7 (depth 2) inside shoot.
        // alphaMult values (out of 256): 243,230,217,204,191,178,165,152,140,127,114,101,88,75,62,49,36,23
        // AS frame indices (1-based): 145,146,...,162 → 0-based: 144..161
        [144, (clip) => { clip.alpha = 243 / 256; }],
        [145, (clip) => { clip.alpha = 230 / 256; }],
        [146, (clip) => { clip.alpha = 217 / 256; }],
        [147, (clip) => { clip.alpha = 204 / 256; }],
        [148, (clip) => { clip.alpha = 191 / 256; }],
        [149, (clip) => { clip.alpha = 178 / 256; }],
        [150, (clip) => { clip.alpha = 165 / 256; }],
        [151, (clip) => { clip.alpha = 152 / 256; }],
        [152, (clip) => { clip.alpha = 140 / 256; }],
        [153, (clip) => { clip.alpha = 127 / 256; }],
        [154, (clip) => { clip.alpha = 114 / 256; }],
        [155, (clip) => { clip.alpha = 101 / 256; }],
        [156, (clip) => { clip.alpha = 88 / 256; }],
        [157, (clip) => { clip.alpha = 75 / 256; }],
        [158, (clip) => { clip.alpha = 62 / 256; }],
        [159, (clip) => { clip.alpha = 49 / 256; }],
        [160, (clip) => { clip.alpha = 36 / 256; }],
        [161, (clip) => { clip.alpha = 23 / 256; }],
      ]),
    };

    // ----------------------------------------------------------------
    // duplicate — container-only, attaches 1 `effet` child
    // ----------------------------------------------------------------
    // AS: DefineSprite_14_duplicate/frame_1/DoAction.as
    //   c = 0; while (c < 1) { this.attachMovie("effet","effet"+c,c); c++; }
    this.duplicateSym = {
      name: "duplicate",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_14_duplicate/frame_1/DoAction.as
            let c = 0;
            while (c < 1) {
              clip.attach(this.effetSym, `effet${c}`, c, ctx);
              c++;
            }
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // shoot — 168-frame main impact timeline
    // ----------------------------------------------------------------
    // AS: DefineSprite_10_shoot/frame_1/DoAction.as → SOMA.playSound("many_501")
    // AS: shoot also has sprite7 placed at frame 6 (depth 2, offset 0.45/-5.15)
    //     via PlaceObject2 (manifest placements: parentSpriteId=10, frame=6, kind="place")
    // AS: DefineSprite_10_shoot/frame_166/DoAction.as → _parent.removeMovieClip(); stop()
    //
    // duplicate is attached at frame_1 per the canonical DoAction (this.attachMovie logic
    // is in duplicate's frame_1, but shoot drives when to spawn it — the manifest shows
    // `duplicate` in animations[], indicating it's placed on shoot's timeline at frame 1).
    this.shootSym = {
      name: "shoot",
      totalFrames: 168,
      frames: textures.getFrames("shoot"),
      anchorX: calculateAnchor({ width: 151.65, height: 106.55, offsetX: -76.3, offsetY: -68.1 }).x,
      anchorY: calculateAnchor({ width: 151.65, height: 106.55, offsetX: -76.3, offsetY: -68.1 }).y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_10_shoot/frame_1/DoAction.as
            // SOMA.playSound("many_501")
            this.soundCallback?.("many_501");
            // Signal hit at the first frame of impact
            this.runtime.signalHit();
            // Attach duplicate (which will spawn its own effet child)
            clip.attach(this.duplicateSym, "duplicate0", 0, ctx);
          },
        ],
        [
          5,
          (clip, ctx) => {
            // Manifest: placements[] kind:"place" parentSpriteId=10 frame=6 depth=2
            // matrix: translateX=0.45, translateY=-5.15, scaleX=1, scaleY=1
            // ratio=6 — AS frame 6 → 0-based frame 5
            clip.attach(this.sprite7Sym, "sprite7", 2, ctx, {
              x: 0.45,
              y: -5.15,
            });
          },
        ],
        [
          165,
          (clip) => {
            // AS: DefineSprite_10_shoot/frame_166/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.effetSym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.duplicateSym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture the sound callback for use from shoot/frame_1
    this.soundCallback = callbacks.playSound;
    // Attach shoot at the root — it is the outermost impact clip for
    // displayType=11 (TargetCell). The root is already anchored at target.
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
