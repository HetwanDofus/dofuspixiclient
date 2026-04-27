/**
 * Spell 2046 — (Cra-class fire arrow variant, likely "Flèche Explosive" or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2046/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single top-level authored
 * timeline (DefineSprite_36) that plays at the target cell. It contains:
 *   - A "shoot" animation (159 frames, isComposite, in animations[]).
 *   - A "fumee" smoke particle symbol (DefineSprite_21_fumee, 36 frames).
 *   - A "cercle" library symbol (DefineSprite_24_cercle) spawned from frame_7
 *     of DefineSprite_36 inside itself.
 *
 * There is no projectile motion (no "move" symbol), no caster-side content,
 * and no dual-anchored placement. The outer sprite (DefineSprite_36) is placed
 * at the target cell, plays through 139 frames, and then calls
 * `_parent.removeMovieClip()` to end the spell.
 *
 * AS layout:
 *   - frame_1/DoAction.as: SOMA.playSound("jet_903") on main timeline.
 *   - DefineSprite_36/frame_1: SOMA.playSound("vol").
 *   - DefineSprite_36/frame_7: spawn 5 cercle particles.
 *   - DefineSprite_36/frame_67: this.end() → signalHit.
 *   - DefineSprite_36/frame_139: _parent.removeMovieClip() → complete.
 *   - DefineSprite_17_shoot/frame_157: _parent.removeMovieClip() (shoot
 *     symbol removes itself — the outer mc removal at frame_139 of
 *     DefineSprite_36 is the authoritative completion signal).
 *
 * Library symbols:
 *   - lib_cercle — single-frame orange spark particle. onLoad seeds physics:
 *     d (distance based on level), accx, x start pos, sr (side), t (scale
 *     accumulator), va, vr, vt, vx. onEnterFrame integrates rotation decay,
 *     X drift, scale growth via vt; removes when t < 0.
 *
 * Container symbols (no authored frame textures, drive logic only):
 *   - shoot  — 159-frame composite animation at target. frame_157 removes self.
 *   - fumee  — 36-frame smoke puff composite. frame_1 seeds physics (vx/vy/
 *              deceleration from parent rotate._rotation). Inner sprite_20
 *              has onLoad/onEnterFrame for rotation + alpha fade. frame_31
 *              removes self.
 *   - sprite_36 — outer container for the whole spell at target. Drives
 *                 sound, cercle spawning, signalHit, and completion.
 *
 * Note on DefineSprite_32 / DefineSprite_33: these are internal sub-symbols
 * within the fumee composite (a rotating smoke sprite with random scale).
 * DefineSprite_33 is the inner smoke shape (onLoad sets a=20). DefineSprite_32
 * has an inner clip with random _xscale on load, and stops at frame_34. These
 * are authored into the fumee frames themselves and are not separately
 * attachMovie'd by our spell scripts, so they are handled implicitly by the
 * fumee composite frame textures.
 *
 * Main timeline: SOMA.playSound("jet_903"); (no stop — DefineSprite_36 runs).
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

const CERCLE_BOUNDS = {
  width: 17.4,
  height: 17.45,
  offsetX: -8.8,
  offsetY: -8.9,
};

const SHOOT_BOUNDS = {
  width: 174.3,
  height: 155.4,
  offsetX: -89.35,
  offsetY: -92.8,
};

const FUMEE_BOUNDS = {
  width: 32.35,
  height: 33,
  offsetX: -14.35,
  offsetY: -18.65,
};

export class Spell2046 extends RuntimeSpell {
  readonly spellId = 2046;
  readonly displayType = SpellDisplayType.TargetCell;

  private cercleSym!: SymbolDefinition;
  private fumeeSym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;
  private sprite36Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- lib_cercle — orange spark particle at target ---------------
    // AS: DefineSprite_24_cercle/frame_1/PlaceObject2_23_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_24_cercle/frame_1/PlaceObject2_23_1/onClipEvent(load).as
        // _parent._parent._parent.level — cercle's _parent is sprite_36 (the
        // outer container attached at root). Walk: clip → sprite_36 → root.
        const root = clip.parent?.parent ?? clip.parent;
        const level = (root?.vars.level as number) ?? 1;
        const d = 120 + (level - 1) * 32;
        clip.vars.d = d;
        clip.vars.accx = 0.8 + 0.12 * Math.random();
        const xStart = d * Math.random();
        clip.vars.x = xStart;
        let yStart: number;
        let sr: number;
        if (Math.floor(Math.random() * 2) === 1) {
          yStart = 5;
          sr = -1;
        } else {
          sr = 1;
          yStart = -5;
        }
        clip.scaleX = 0;
        clip.scaleY = 0;
        clip.vars.t = 5;
        clip.x = xStart;
        clip.y = yStart;
        clip.vars.va = 5 + 10 * Math.random();
        clip.vars.vr = (20 + 40 * Math.random()) * sr;
        // Note: canonical AS uses `vt = (0.3 + random(1)) * ((d - x) / d)`
        // random(1) always returns 0, so the range is always [0.3, 0.3].
        clip.vars.vt = (0.3 + Math.floor(Math.random() * 1)) * ((d - xStart) / d);
        clip.vars.vx = 5 + 10 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_24_cercle/frame_1/PlaceObject2_23_1/onClipEvent(enterFrame).as
        let vr = clip.vars.vr as number;
        let vx = clip.vars.vx as number;
        let vt = clip.vars.vt as number;
        let t = clip.vars.t as number;
        const accx = clip.vars.accx as number;

        vr *= 0.97;
        // AS: _rotation = _rotation - vr (degrees) → subtract vr converted to radians
        clip.rotation -= (vr * Math.PI) / 180;
        vx *= accx;
        clip.x += vx;
        vt -= 0.03;
        t += vt;
        // AS: _xscale = t; _yscale = t (percent → decimal)
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;

        clip.vars.vr = vr;
        clip.vars.vx = vx;
        clip.vars.vt = vt;
        clip.vars.t = t;

        if (t < 0) {
          // AS: _parent.removeMovieClip()
          clip.remove();
        }
      },
    };

    // ---- fumee — 36-frame smoke puff composite ----------------------
    // AS: DefineSprite_21_fumee/frame_1/DoAction.as
    //     DefineSprite_21_fumee/frame_1/PlaceObject2_20_2/onClipEvent(load).as
    //     DefineSprite_21_fumee/frame_1/PlaceObject2_20_2/onClipEvent(enterFrame).as
    //     DefineSprite_21_fumee/frame_31/DoAction.as
    //
    // The fumee symbol reads `_parent._parent._parent.rotate._rotation` to
    // get the launch angle. In the canonical AS, fumee is attached inside
    // sprite_36 (the outer container). So:
    //   fumee._parent = sprite_36
    //   fumee._parent._parent = root
    //   fumee._parent._parent._parent = ??? (would be the outer mc above root)
    // In practice for displayType=11, root IS the container; there is no
    // outer parent above root that has a "rotate" child. The canonical AS
    // reads the rotation of a "rotate" sub-clip. For this runtime we fall
    // back gracefully: if the rotate reference is unavailable we use angle
    // from root.vars (the caster-to-target angle stored by the harness).
    this.fumeeSym = {
      name: "fumee",
      totalFrames: 36,
      frames: textures.getFrames("fumee"),
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_21_fumee/frame_1/DoAction.as
            // a = _parent._parent._parent.rotate._rotation * 0.017453...
            // Walk up: clip → sprite_36 → root; read angle from root.vars.
            const root = clip.parent?.parent ?? clip.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            const a = angleDeg * 0.017453292519943295;
            const t = 80 * Math.random() + 50;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.x = 20 * (Math.random() - 0.5);
            clip.y = 20 * (Math.random() - 0.5);
            clip.vars.vx = 20 * Math.cos(a);
            clip.vars.vy = 20 * Math.sin(a);
            clip.vars.deceleration = 1.2 + Math.random();
          },
        ],
        [
          30,
          (clip) => {
            // AS DefineSprite_21_fumee/frame_31/DoAction.as
            // this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS DefineSprite_21_fumee/frame_1/DoAction.as inline onEnterFrame:
        // _X += vx; _Y += vy; vx /= deceleration; vy /= deceleration;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const deceleration = clip.vars.deceleration as number;
        clip.x += vx;
        clip.y += vy;
        vx /= deceleration;
        vy /= deceleration;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- shoot — 159-frame composite animation at target ------------
    // AS: DefineSprite_17_shoot/frame_157/DoAction.as
    //   _parent.removeMovieClip()  → shoot removes its own parent
    //   However, the authoritative completion is sprite_36/frame_139.
    //   We register shoot's frame_157 to remove itself only (not complete).
    this.shootSym = {
      name: "shoot",
      totalFrames: 159,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          156,
          (clip) => {
            // AS DefineSprite_17_shoot/frame_157/DoAction.as
            // _parent.removeMovieClip() — shoot removes itself
            clip.remove();
          },
        ],
      ]),
    };

    // ---- sprite_36 — outer container driving the whole spell --------
    // AS: DefineSprite_36/frame_1, frame_7, frame_67, frame_139
    // This is an unnamed sprite placed on the main timeline. It is NOT in
    // librarySymbols[] (no attachMovie for it). We attach it from onSpellStart
    // at depth 1 on the root.
    this.sprite36Sym = {
      name: "sprite_36",
      totalFrames: 139,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_36/frame_1/DoAction.as
            // SOMA.playSound("vol") — played via stored callbacks ref
            this.soundCallback?.("vol");
            // Also attach the shoot animation at depth 1 inside sprite_36
            clip.attach(this.shootSym, "shoot", 1, ctx);
          },
        ],
        [
          6,
          (clip, ctx) => {
            // AS DefineSprite_36/frame_7/DoAction.as
            // nb = 5; c = 1; while (c < nb) { attachMovie("cercle",...) }
            // Note: c starts at 1 and loops while c < 5, so spawns cercle1..4
            // (4 particles). The canonical AS sets c=0 then c=1 before the
            // loop, so the effective range is c in [1,4].
            const nb = 5;
            for (let c = 1; c < nb; c++) {
              clip.attach(this.cercleSym, `cercle${c}`, c, ctx);
            }
          },
        ],
        [
          66,
          () => {
            // AS DefineSprite_36/frame_67/DoAction.as
            // this.end() → signalHit (damage popup at target)
            this.runtime.signalHit();
          },
        ],
        [
          138,
          (clip) => {
            // AS DefineSprite_36/frame_139/DoAction.as
            // this._parent.removeMovieClip() → spell complete
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.cercleSym);
    this.registry.register(this.fumeeSym);
    this.registry.register(this.shootSym);
    this.registry.register(this.sprite36Sym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("jet_903")
    callbacks.playSound("jet_903");
    // Store sound callback so sprite_36's frame_1 script can fire "vol"
    this.soundCallback = callbacks.playSound;
    // Attach the outer sprite_36 container at root depth 1; it drives
    // everything from here — shoot, cercle, signalHit, and completion.
    this.root.attach(this.sprite36Sym, "sprite36", 1, context);
  }
}
