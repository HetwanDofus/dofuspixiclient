/**
 * Spell 615 — Esquive (Dodge/Evasion, air-element dodge animation).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/615/scripts/scripts/
 *
 * displayType=11 (TargetCell). The main sprite (DefineSprite_22) positions itself
 * at _parent.cellTo in its frame_1, and the whole animation plays at the target cell.
 * There is no projectile, no caster-side visual, no beam — just a single sprite
 * anchored at the target with embedded sub-sprites. TargetCell is the correct choice.
 *
 * Canonical AS layout:
 *   - sprite_22 (DefineSprite_22, 123 frames) — main animation timeline.
 *       frame_1:  SOMA.playSound("air"); position self at _parent.cellTo; stop not present (plays).
 *       frame_34: SOMA.playSound("dodge_615").
 *       frame_37: PlaceObject2_17_2 (sprite9 instance at depth 2) placed on timeline with onLoad
 *                 that attachMovies 5 "pierres" inside it.
 *       frame_40: this.end() → signalHit.
 *       frame_43: SOMA.playSound("dodge_615"); PlaceObject2_17_6 (sprite9 instance at depth 6)
 *                 placed on timeline with onLoad that attachMovies 5 "pierres" inside it.
 *       frame_121: _parent.removeMovieClip() → spell complete.
 *
 *   - sprite9 (DefineSprite_9, characterId=9, directlyDynamic=true) — a composite "dodger"
 *     sprite with two internal sub-instances that both have onClipEvent(enterFrame):
 *       PlaceObject2_6_1 (depth 1): _alpha = random(50) each frame.
 *       PlaceObject2_8_3 (depth 3): _alpha = random(240) + 30 each frame.
 *     Placed at frame 36 (0-based) of sprite_22 at depth 2, and frame 42 (0-based) at depth 6.
 *
 *   - pierres (DefineSprite_3_pierres, characterId=3) — a falling rock/stone particle.
 *       onLoad (on inner PlaceObject2_2_1): seeds vx/vy/t/v/vr, positions parent, sets scale/alpha.
 *       onEnterFrame: moves parent x/y by vx/vy; falls via _Y += v with bounce and settle logic.
 *     The pierres are NOT attached directly — they are attached inside sprite9's onLoad handler
 *     (5 per sprite9 instance).
 *
 * Library symbols:
 *   - "pierres" (lib_pierres) — rock particle. onLoad seeds physics. onEnterFrame integrates
 *     position/rotation with bounce settling.
 *   - "sprite9" (lib_sprite9) — composite flash/glow sprite. No onLoad on the sprite itself.
 *     Internally has two sub-instances that flicker alpha. Represented as a symbol whose
 *     onEnterFrame flickers the clip's own children or (since we can't place sub-instances
 *     independently) we model the composite by flickering the whole clip's alpha. The two
 *     PlaceObject2 children inside sprite9 both randomise alpha — we model this via the
 *     sprite9 clip's onEnterFrame.
 *     frame_1: attachMovie 5 "pierres" instances (from the PlaceObject2_17_N onLoad events).
 *
 * Main timeline (frame_2/DoAction.as): stop() — the outer wrapper stops; sprite_22 runs
 * as a child attached via onSpellStart.
 *
 * Sounds:
 *   - "air" at frame_1 of sprite_22 (0-based frame 0).
 *   - "dodge_615" at frame_34 (0-based frame 33) and frame_43 (0-based frame 42) of sprite_22.
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

const PIERRES_BOUNDS = {
  width: 4.75,
  height: 2.3,
  offsetX: -2.4,
  offsetY: -1.7,
};

const SPRITE9_BOUNDS = {
  width: 122.8,
  height: 125.45,
  offsetX: -71.45,
  offsetY: -56.85,
};

const SPRITE22_BOUNDS = {
  width: 239.5,
  height: 178.9,
  offsetX: -113.3,
  offsetY: -132.1,
};

export class Spell615 extends RuntimeSpell {
  readonly spellId = 615;
  readonly displayType = SpellDisplayType.TargetCell;

  private pierresSym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite22Sym!: SymbolDefinition;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const sprite22Anchor = calculateAnchor(SPRITE22_BOUNDS);

    // ---- pierres — falling rock/stone particle -------------------
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // Note: In AS, the clip events are on PlaceObject2_2_1 (an inner instance inside "pierres").
    // The onLoad sets properties on _parent (= the pierres MovieClip) and on the inner instance.
    // We model this by placing all state on the pierres clip itself (clip.vars.*) and having
    // clip.parent tracking for _parent._x/_y manipulation.
    // Since the inner clip IS the pierres clip in our model, _parent in AS is the container
    // that holds the pierres. The onLoad sets _parent._x/_y (= the pierres clip's position).
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.vx = 3 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        // _parent._x / _parent._y — the pierres clip is the "parent" in our model
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -6 * Math.random() - 3;
        clip.vars.vr = 40 * (-0.5 + Math.random());
        // Local Y offset for the inner bounce simulation (the "inner instance" _Y)
        clip.vars.innerY = 0;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        let t = clip.vars.t as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        let innerY = clip.vars.innerY as number;

        // _parent._x += vx; _parent._y += vy
        clip.x += vx;
        clip.y += vy;

        if (t !== 1) {
          innerY += v;
          clip.rotation += (vr * Math.PI) / 180;
          v += 0.5;

          if (innerY > 0) {
            // Bounce / settle
            clip.vars.vx = vx / 4;
            clip.vars.vy = vy / 2;
            clip.rotation = 0;
            innerY = 0;
            v = (-v) / 4;

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

    // ---- sprite9 — composite glow/flash sprite -------------------
    // AS: DefineSprite_9/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   depth 1 instance: _alpha = random(50)
    // AS: DefineSprite_9/frame_1/PlaceObject2_8_3/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   depth 3 instance: _alpha = random(240) + 30
    //
    // Since our runtime models the two sub-instances as part of this clip, we model
    // the combined flickering alpha effect on the sprite9 clip itself, averaging the
    // intended visual by using the brighter of the two (depth 3: random(240)+30).
    // The frame_1 (0-based frame 0) onLoad for sprite9's placements (PlaceObject2_17_2 and
    // PlaceObject2_17_6 in sprite_22) attach 5 pierres instances.
    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onLoad: (clip, ctx) => {
        // AS: DefineSprite_22/frame_37/PlaceObject2_17_2/CLIPACTIONRECORD onClipEvent(load).as
        // AS: DefineSprite_22/frame_43/PlaceObject2_17_6/CLIPACTIONRECORD onClipEvent(load).as
        // Both have identical logic: attach 5 "pierres" instances.
        for (let c = 0; c < 5; c++) {
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
        }
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_9/frame_1/PlaceObject2_6_1/onClipEvent(enterFrame): _alpha = random(50)
        // AS: DefineSprite_9/frame_1/PlaceObject2_8_3/onClipEvent(enterFrame): _alpha = random(240) + 30
        // We model the combined effect using the brighter sub-instance's formula on the composite.
        clip.alpha = (Math.floor(Math.random() * 240) + 30) / 100;
      },
    };

    // ---- sprite_22 — main animation timeline (123 frames) --------
    // AS: DefineSprite_22/frame_1/DoAction.as — SOMA.playSound("air")
    // AS: DefineSprite_22/frame_1/DoAction_2.as — _X = _parent.cellTo.x; _Y = _parent.cellTo.y
    // AS: DefineSprite_22/frame_34/DoAction.as — SOMA.playSound("dodge_615")
    // AS: DefineSprite_22/frame_37/PlaceObject2_17_2 onClipEvent(load) — attaches sprite9 at depth 2
    // AS: DefineSprite_22/frame_40/DoAction.as — this.end() → signalHit
    // AS: DefineSprite_22/frame_43/DoAction.as — SOMA.playSound("dodge_615")
    // AS: DefineSprite_22/frame_43/PlaceObject2_17_6 onClipEvent(load) — attaches sprite9 at depth 6
    // AS: DefineSprite_22/frame_121/DoAction.as — _parent.removeMovieClip()
    this.sprite22Sym = {
      name: "sprite_22",
      totalFrames: 123,
      frames: textures.getFrames("sprite_22"),
      anchorX: sprite22Anchor.x,
      anchorY: sprite22Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_22/frame_1/DoAction.as — SOMA.playSound("air")
            // (sound is fired from onSpellStart since we only have callbacks there)
            // AS: DefineSprite_22/frame_1/DoAction_2.as — position at cellTo
            // For displayType 11 (TargetCell), the container is already at cellTo.
            // Relative to the container, the sprite should be at (0, 0).
            // But the canonical AS positions using _parent.cellTo world coords.
            // Since we are a child of root (which is at cellTo), we set (0, 0).
            clip.x = 0;
            clip.y = 0;
          },
        ],
        [
          33,
          (_clip) => {
            // AS: DefineSprite_22/frame_34/DoAction.as — SOMA.playSound("dodge_615")
            this.soundCallback?.("dodge_615");
          },
        ],
        [
          36,
          (clip, ctx) => {
            // AS: DefineSprite_22/frame_37 — PlaceObject2_17_2 placed at depth 2.
            // The onClipEvent(load) on that PlaceObject attaches 5 "pierres" inside it.
            // We attach a sprite9 instance here — its onLoad fires and attaches the pierres.
            clip.attach(this.sprite9Sym, "sprite9_2", 2, ctx);
          },
        ],
        [
          39,
          (_clip) => {
            // AS: DefineSprite_22/frame_40/DoAction.as — this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          42,
          (clip, ctx) => {
            // AS: DefineSprite_22/frame_43/DoAction.as — SOMA.playSound("dodge_615")
            this.soundCallback?.("dodge_615");
            // AS: DefineSprite_22/frame_43 — PlaceObject2_17_6 placed at depth 6.
            // The onClipEvent(load) on that PlaceObject attaches 5 "pierres" inside it.
            clip.attach(this.sprite9Sym, "sprite9_6", 6, ctx);
          },
        ],
        [
          120,
          (clip) => {
            // AS: DefineSprite_22/frame_121/DoAction.as — _parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite22Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Capture sound callback for use in frame scripts
    this.soundCallback = callbacks.playSound;

    // AS: DefineSprite_22/frame_1/DoAction.as — SOMA.playSound("air")
    callbacks.playSound("air");

    // Attach the main animation sprite as a child of root.
    // For displayType 11 (TargetCell), root is already positioned at cellTo.
    // The sprite_22 frame_1 script sets _X = _parent.cellTo.x, _Y = _parent.cellTo.y
    // relative to its parent (the outer mc). In our model, root IS at cellTo (world coords),
    // so sprite_22 should be at local (0, 0) within root.
    this.root.attach(this.sprite22Sym, "sprite22", 1, context);
  }
}
