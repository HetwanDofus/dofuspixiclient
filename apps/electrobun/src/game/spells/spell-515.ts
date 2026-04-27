/**
 * Spell 515 — (Sadida earth/rock spell, likely "Bouture" or similar earth impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/515/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single `shoot` animation anchored
 * at the target cell. There is no `move` symbol, no caster reference in the main
 * projectile logic (frame_4/DoAction_2.as sets _X/_Y to cellFrom — this is an
 * initial position correction on the shoot clip itself, executed as a frame script),
 * no `duplicate` symbol. The main timeline just has `stop()` on frame_2. The `shoot`
 * symbol (DefineSprite_55_shoot, 150 frames) is the primary content:
 *   - frame_4:  plays sound "many_501"; positions self at cellFrom.
 *   - frame_61: this.end() → signalHit.
 *   - frame_109: plays sound "many_502".
 *   - frame_148: _parent.removeMovieClip() + stop() → spell complete.
 *
 * The `shoot` symbol also contains a `DefineSprite_23` child (58-frame sub-sprite
 * with stop() at frame_58) and a `DefineSprite_41` child (a rotation/fade particle
 * with onEnterFrame), and spawns `DefineSprite_3_pierres` (falling rock particles
 * with bouncing physics). These are registered as library symbols.
 *
 * Library symbols:
 *   - shoot       — 150-frame main impact animation. Container with frame scripts.
 *                   frame_4 plays sound + positions at cellFrom.
 *                   frame_61 signals hit.
 *                   frame_109 plays sound.
 *                   frame_148 removes parent + completes spell.
 *   - pierres     — rock debris particle. onLoad seeds vx/vy/v/vr/t/scale/alpha;
 *                   parent positioned randomly. onEnterFrame bounces with gravity.
 *   - DefineSprite_41 — rotating/fading sub-particle. frame_1 seeds vr/va,
 *                       onEnterFrame fades alpha + rotates with decay.
 *   - DefineSprite_23 — 58-frame authored sub-sprite, stop() at frame_58.
 *
 * Main timeline: frame_2 DoAction.as → stop(). No explicit sound on main timeline.
 * Sounds are played from within the shoot symbol's frame scripts.
 *
 * NOTE: The manifest's `animations[]` has only "shoot" (no librarySymbols[]).
 * The shoot animation is the top-level content. The sub-symbols (pierres,
 * DefineSprite_41, DefineSprite_23) are referenced inside shoot's AS but do not
 * appear as separate manifest entries — they are embedded. We treat shoot as a
 * container-only symbol (the harness attaches it) and the sub-symbols as
 * container-only with frames: [] since they have no separate manifest texture entries.
 *
 * The `shoot` animation in `animations[]` has its own texture frames (150 frames).
 * Since it appears in `animations[]` (NOT `librarySymbols[]`), we use
 * textures.getFrames("shoot") (no lib_ prefix).
 *
 * For displayType=11 (TargetCell), the harness does NOT call signalHit automatically.
 * We call this.runtime.signalHit() from shoot's frame_61 script.
 * We call this.runtime.complete() from shoot's frame_148 script.
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

const SHOOT_BOUNDS = {
  width: 119.9,
  height: 116.7,
  offsetX: -72.15,
  offsetY: -81.35,
};

export class Spell515 extends RuntimeSpell {
  readonly spellId = 515;
  readonly displayType = SpellDisplayType.TargetCell;

  private callbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ---- DefineSprite_41 — rotating/fading sub-particle ----------
    // AS: DefineSprite_41/frame_1/DoAction.as
    //   vr = 5 * Math.random();
    //   va = 1 + 2.5 * Math.random();
    //   this.onEnterFrame = function() {
    //     _alpha = _alpha - va;
    //     _rotation = _rotation + (vr *= 0.9);
    //   };
    const sprite41Sym: SymbolDefinition = {
      name: "sprite_41",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_41/frame_1/DoAction.as
            clip.vars.vr = 5 * Math.random();
            clip.vars.va = 1 + 2.5 * Math.random();
            clip.onEnterFrame = (c) => {
              // AS: this.onEnterFrame — _alpha -= va; _rotation += (vr *= 0.9)
              const va = c.vars.va as number;
              let vr = c.vars.vr as number;
              c.alpha = Math.max(0, c.alpha - va / 100);
              vr *= 0.9;
              c.rotation += (vr * Math.PI) / 180;
              c.vars.vr = vr;
            };
          },
        ],
      ]),
    };

    // ---- DefineSprite_23 — 58-frame authored sub-sprite ----------
    // AS: DefineSprite_23/frame_58/DoAction.as → stop()
    const sprite23Sym: SymbolDefinition = {
      name: "sprite_23",
      totalFrames: 58,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          57,
          (clip) => {
            // AS: DefineSprite_23/frame_58/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_3_pierres — bouncing rock debris -----------
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // Note: The clip events are on a child placed INSIDE pierres (PlaceObject2_2_1).
    // The canonical AS sets _parent._x / _parent._y (= the pierres clip itself) in
    // onLoad for position scatter, and the inner clip's _Y / _rotation for the
    // bounce physics. We model the onLoad/onEnterFrame on the pierres clip directly
    // since we don't create a separate inner clip. All _parent._x/y references
    // become clip.x/y, and inner _Y/_rotation become clip-level vars.
    const pierresSym: SymbolDefinition = {
      name: "pierres",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
        //     CLIPACTIONRECORD onClipEvent(load).as
        //   var vx = 5 * (Math.random() - 0.5);
        //   var vy = 2 * (Math.random() - 0.5);
        //   _parent._x = 20 * (Math.random() - 0.5);
        //   _parent._y = 10 * (Math.random() - 0.5);
        //   var t = 60 + 40 * Math.random();
        //   _xscale = t; _yscale = t;
        //   _alpha = 20 + random(90);
        //   var v = -15 * Math.random() - 5;
        //   var vr = 140 * (-0.5 + Math.random());
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        const t = 60 + 40 * Math.random();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -15 * Math.random() - 5;
        clip.vars.vr = 140 * (-0.5 + Math.random());
        // localY tracks the inner clip's _Y for bounce simulation
        clip.vars.localY = 0;
        clip.vars.t = 0;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
        //     CLIPACTIONRECORD onClipEvent(enterFrame).as
        //   _parent._x += vx;
        //   _parent._y += vy;
        //   if(t != 1) {
        //     _Y = _Y + v;
        //     _rotation = _rotation + vr;
        //     v += 1.5;
        //     if(_Y > 0) {
        //       vx /= 2; vy /= 2;
        //       _rotation = 0; _Y = 0;
        //       v = (-v) / 4;
        //       if(Math.abs(v) < 1) { vx = 0; vy = 0; t = 1; }
        //     }
        //   }
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        clip.x += vx;
        clip.y += vy;
        const t = clip.vars.t as number;
        if (t !== 1) {
          let localY = clip.vars.localY as number;
          let v = clip.vars.v as number;
          let vr = clip.vars.vr as number;
          localY += v;
          clip.rotation += (vr * Math.PI) / 180;
          v += 1.5;
          if (localY > 0) {
            clip.vars.vx = vx / 2;
            clip.vars.vy = vy / 2;
            clip.rotation = 0;
            localY = 0;
            v = (-v) / 4;
            if (Math.abs(v) < 1) {
              clip.vars.vx = 0;
              clip.vars.vy = 0;
              clip.vars.t = 1;
            }
          }
          clip.vars.localY = localY;
          clip.vars.v = v;
          clip.vars.vr = vr;
        }
      },
    };

    // ---- shoot — 150-frame main impact animation -----------------
    // AS: DefineSprite_55_shoot — primary spell content.
    //   frame_4/DoAction.as:   SOMA.playSound("many_501")
    //   frame_4/DoAction_2.as: _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y
    //   frame_61/DoAction.as:  this.end() → signalHit
    //   frame_109/DoAction.as: SOMA.playSound("many_502")
    //   frame_148/DoAction.as: _parent.removeMovieClip(); stop()
    //
    // Texture frames come from animations[] entry "shoot" (no lib_ prefix).
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 150,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS: DefineSprite_55_shoot/frame_4/DoAction.as
            //   SOMA.playSound("many_501");
            this.callbacks?.playSound("many_501");

            // AS: DefineSprite_55_shoot/frame_4/DoAction_2.as
            //   _X = _parent.cellFrom.x;
            //   _Y = _parent.cellFrom.y;
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y;
            }
          },
        ],
        [
          60,
          (_clip) => {
            // AS: DefineSprite_55_shoot/frame_61/DoAction.as
            //   this.end() → signalHit (damage popup at target)
            this.runtime.signalHit();
          },
        ],
        [
          108,
          (_clip) => {
            // AS: DefineSprite_55_shoot/frame_109/DoAction.as
            //   SOMA.playSound("many_502");
            this.callbacks?.playSound("many_502");
          },
        ],
        [
          147,
          (clip) => {
            // AS: DefineSprite_55_shoot/frame_148/DoAction.as
            //   _parent.removeMovieClip();
            //   stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite41Sym);
    this.registry.register(sprite23Sym);
    this.registry.register(pierresSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: frame_2/DoAction.as → stop() (main timeline just stops)
    // Capture callbacks for use in frame scripts (sounds played from within shoot).
    this.callbacks = callbacks;

    // The harness for displayType=11 (TargetCell) attaches "shoot" automatically
    // if it's registered and the displayType expects it. However, for TargetCell,
    // the harness does NOT auto-attach shoot — it only positions the root at target.
    // We must attach shoot manually here as the main content.
    const shootSym = this.registry.resolve("shoot");
    if (shootSym) {
      this.root.attach(shootSym, "shoot", 1, context);
    }
  }
}
