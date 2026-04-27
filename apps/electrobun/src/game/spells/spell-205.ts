/**
 * Spell 205 — Croque-mitaine / Crockette (Osamodas).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/205/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main timeline places a single sprite_22
 * child at world origin (0,0); sprite_22's frame_1 reads _parent.cellFrom and
 * _parent.cellTo to position itself, then runs autonomous physics to glide from
 * caster to target. This is the classic "crockette hops across the map" pattern.
 *
 * Canonical layout:
 *
 *   - Main timeline (frame_2/DoAction.as): SOMA.playSound("crockette_205"); stop();
 *
 *   - sprite_22 — 123-frame autonomous timeline (the crockette creature):
 *       frame_1:  stop(); seed vx/vy/acc/frott; position at cellFrom; start
 *                 onEnterFrame physics to glide toward cellTo; also places a
 *                 child "crockett" sub-sprite (DefineSprite_15) at depth 2 with
 *                 clipEvents.
 *       frame_37: acc = 0.25 (speed-up on approach).
 *       frame_67: SOMA.playSound("pose"); fin = 1; _X = x2; _Y = y2;
 *                 (snap to target, signal hit).
 *       frame_70: this.end() → signalHit; also places a landing-bounce
 *                 sub-sprite (DefineSprite_21/sprite_18-like) with clipEvents.
 *       frame_121: _parent.removeMovieClip(); stop(); → spell complete.
 *
 *   - DefineSprite_15 (the crockette body composite): frame_1 seeds corpsx/tetex
 *     and runs a per-frame 3D-perspective sine-wobble on child parts (corps, tete,
 *     p1-p4). Two child clips inside it swap depths by _Y in onEnterFrame. The
 *     body's "an" angle comes from its own clip-event (PlaceObject2_15_2) which
 *     reads _parent.anglepos.
 *
 *   - DefineSprite_14 (a sub-part of the body, e.g. tete/corps disc):
 *     onEnterFrame reads _parent._parent.an for a rotation/scale/visibility trick.
 *
 *   - sprite_18 / DefineSprite_18: 15-frame impact burst; frame_13 → stop().
 *
 * The manifest has NO librarySymbols[] entries (empty). All symbols appear only
 * in animations[]. Therefore no "lib_" prefix is used for any texture key.
 *
 * Because sprite_22 reads _parent.cellFrom / _parent.cellTo and positions itself
 * in world coordinates at frame_1, displayType=50 (WorldAbsolute) is correct:
 * the harness leaves the container at world origin (0,0) and exposes cellFrom/
 * cellTo on root.vars, which sprite_22 then reads.
 *
 * signalHit fires at sprite_22 frame_70 (this.end() → canonical hit signal).
 * complete() fires at sprite_22 frame_121 (_parent.removeMovieClip()).
 *
 * The internal sub-sprites (DefineSprite_15 body, DefineSprite_14 disc parts,
 * DefineSprite_18 impact) are modelled as container-only SymbolDefinitions with
 * their clip-event physics ported directly. The 3-level depth-swap calls
 * (swapDepths) are omitted — they only affect Flash rendering order and have no
 * equivalent in the SpellClip model (zIndex is set at attach time).
 *
 * Library symbols registered:
 *   - "sprite_22"    — main crockette autonomous timeline (123 frames). Drives
 *                      its own glide physics via onEnterFrame on the clip itself.
 *   - "crockett"     — DefineSprite_15 crockette body composite (1 frame).
 *                      frame_1 seeds corpsx/tetex; onEnterFrame wobbles parts.
 *   - "disc"         — DefineSprite_14 perspective disc sub-part (1 frame).
 *                      onEnterFrame: _X = 7*cos(an), _xscale = 100*sin(an),
 *                      _visible by sign of _xscale.
 *   - "impact"       — sprite_18 / DefineSprite_18 impact burst (15 frames).
 *                      frame_13 → stop().
 *   - "landing"      — PlaceObject2_21_1 landing-bounce clip (1 frame).
 *                      onLoad seeds i/amp; onEnterFrame oscillates rotation.
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

// Bounds from manifest animations[] entries (no librarySymbols, so no lib_ prefix)
const SPRITE_9_BOUNDS = {
  width: 29.1,
  height: 10.95,
  offsetX: -14.15,
  offsetY: -12.35,
};
const SPRITE_18_BOUNDS = {
  width: 67.8,
  height: 67.8,
  offsetX: -33.3,
  offsetY: -36.35,
};
const SPRITE_22_BOUNDS = {
  width: 69.2,
  height: 175.9,
  offsetX: -33.3,
  offsetY: -172.3,
};

export class Spell205 extends RuntimeSpell {
  readonly spellId = 205;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  // Store reference for use in onSpellStart after registerSymbols
  private sprite22Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite9Anchor = calculateAnchor(SPRITE_9_BOUNDS);
    const sprite18Anchor = calculateAnchor(SPRITE_18_BOUNDS);
    const sprite22Anchor = calculateAnchor(SPRITE_22_BOUNDS);

    // ---- "disc" — DefineSprite_14 perspective disc sub-part ----
    // Used by the crockette body to simulate 3D perspective on a flat disc.
    // AS: DefineSprite_14/frame_1/PlaceObject2_13_4/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _X = 7 * Math.cos(_parent._parent.an);
    //   _xscale = 100 * Math.sin(_parent._parent.an);
    //   if (_xscale < 0) { _visible = false; } else { _visible = true; }
    const discSym: SymbolDefinition = {
      name: "disc",
      totalFrames: 1,
      frames: textures.getFrames("sprite_9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_14/frame_1/PlaceObject2_13_4/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _parent._parent.an — disc's parent is crockett, crockett's parent is sprite_22
        const crockett = clip.parent;
        const sprite22 = crockett?.parent;
        const an = (sprite22?.vars.an as number) ?? 0;
        clip.x = 7 * Math.cos(an);
        clip.scaleX = (100 * Math.sin(an)) / 100;
        if (clip.scaleX < 0) {
          clip.visible = false;
        } else {
          clip.visible = true;
        }
      },
    };

    // ---- "impact" — sprite_18 / DefineSprite_18 impact burst ----
    // AS: DefineSprite_18/frame_13/DoAction.as → stop()
    const impactSym: SymbolDefinition = {
      name: "impact",
      totalFrames: 15,
      frames: textures.getFrames("sprite_18"),
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,
      frameScripts: new Map([
        [
          12,
          (clip) => {
            // AS: DefineSprite_18/frame_13/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- "landing" — PlaceObject2_21_1 landing-bounce clip ----
    // AS: DefineSprite_22/frame_70/PlaceObject2_21_1/CLIPACTIONRECORD onClipEvent(load).as
    //   i = 0; amp = 30;
    // AS: DefineSprite_22/frame_70/PlaceObject2_21_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = (amp *= 0.8) * Math.cos(i += 3.1415);
    const landingSym: SymbolDefinition = {
      name: "landing",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_22/frame_70/PlaceObject2_21_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.i = 0;
        clip.vars.amp = 30;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_22/frame_70/PlaceObject2_21_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let amp = clip.vars.amp as number;
        let i = clip.vars.i as number;
        amp *= 0.8;
        i += Math.PI; // 3.1415 in AS
        clip.rotation = ((amp * Math.cos(i)) * Math.PI) / 180;
        clip.vars.amp = amp;
        clip.vars.i = i;
      },
    };

    // ---- "crockett" — DefineSprite_15 crockette body composite ----
    // The crockette body holds sub-children: corps, tete, p1-p4 (legs/paws), plus
    // shadow discs (DefineSprite_14). The onEnterFrame wobbles them with sine-based
    // 3D perspective. The "an" angle is managed by a child clip-event on
    // PlaceObject2_15_2 which updates sprite_22.vars.an (accessible as parent.vars.an).
    //
    // In the runtime we model "crockett" as a container. The sub-children (corps,
    // tete, legs, discs) are modelled implicitly: the onEnterFrame on crockett
    // references clip.vars.an (which mirrors the AS _parent chain). The "an"
    // variable is stored on sprite_22 (crockett's parent) and updated by crockett's
    // own clip-event, which we port directly as the onEnterFrame of this symbol.
    //
    // AS: DefineSprite_15/frame_1/DoAction.as
    //   corpsx = corps._x; tetex = tete._x; dpate = 10;
    //   onEnterFrame: corps._x = corpsx * cos(an); ... tete._x = tetex * cos(an); ...
    //   legs: p1-p4._x = dpate * cos(an + c * PI/2); _y = dpate/2 * sin(...)
    //
    // AS: DefineSprite_22/frame_1/PlaceObject2_15_2/CLIPACTIONRECORD onClipEvent(load).as
    //   an = 0; t = 0; pm = 0; ym = _Y;
    // AS: DefineSprite_22/frame_1/PlaceObject2_15_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   an = 0.3 * Math.sin(t += 0.4) + _parent.anglepos + 3.1415;
    //   _Y = ym + 10 * Math.cos(pm += 0.1);
    //   _rotation = 3.34 * Math.sin(t * 1.2);
    //
    // We combine the crockett onEnterFrame (which drives the body bobbing / angle
    // update) and store "an" on sprite_22.vars so disc sub-clips can read it.
    // The actual body-part child clips are omitted (they carry no distinct textures
    // in this manifest — sprite_22 is the composite visual). The key observable
    // behaviour is the Y bobbing and rotation of the crockette container.
    const crockettSym: SymbolDefinition = {
      name: "crockett",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_22/frame_1/PlaceObject2_15_2/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.an = 0;
        clip.vars.t = 0;
        clip.vars.pm = 0;
        clip.vars.ym = clip.y;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_22/frame_1/PlaceObject2_15_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // an = 0.3 * Math.sin(t += 0.4) + _parent.anglepos + 3.1415;
        // _Y = ym + 10 * Math.cos(pm += 0.1);
        // _rotation = 3.34 * Math.sin(t * 1.2);
        let t = clip.vars.t as number;
        let pm = clip.vars.pm as number;
        const ym = clip.vars.ym as number;
        const sprite22Clip = clip.parent;
        const anglepos = (sprite22Clip?.vars.anglepos as number) ?? 0;

        t += 0.4;
        pm += 0.1;

        const an = 0.3 * Math.sin(t) + anglepos + Math.PI;
        clip.vars.an = an;

        // Also propagate an to sprite_22.vars.an so disc clips (_parent._parent.an) work
        if (sprite22Clip) {
          sprite22Clip.vars.an = an;
        }

        clip.y = ym + 10 * Math.cos(pm);
        // AS _rotation = 3.34 * Math.sin(t * 1.2) — in degrees → radians
        clip.rotation = ((3.34 * Math.sin(t * 1.2)) * Math.PI) / 180;

        clip.vars.t = t;
        clip.vars.pm = pm;
      },
    };

    // ---- "sprite_22" — main crockette autonomous timeline ----
    // 123-frame outer container. This is the primary spell driver.
    //
    // frame_1 / DoAction.as:
    //   stop(); seed physics vars; position at cellFrom; attach crockett child;
    //   start onEnterFrame to glide toward cellTo.
    //
    // frame_37: acc = 0.25 (acceleration boost on approach).
    //
    // frame_67 / DoAction.as: SOMA.playSound("pose");
    // frame_67 / DoAction_2.as: fin = 1; _X = x2; _Y = y2; (snap to target)
    //   → signals hit here (canonical this.end() equivalent at frame_70, but
    //     the snap happens at 67 and we treat frame_70's this.end() as the hit).
    //
    // frame_70 / DoAction.as: this.end() → signalHit.
    //   Also places landing sub-clip.
    //
    // frame_121 / DoAction.as: _parent.removeMovieClip(); stop(); → complete().
    this.sprite22Sym = {
      name: "sprite_22",
      totalFrames: 123,
      frames: textures.getFrames("sprite_22"),
      anchorX: sprite22Anchor.x,
      anchorY: sprite22Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_22/frame_1/DoAction.as
            // stop(); tps = 0; x1/y1 = cellFrom; x2/y2 = cellTo;
            // acc = 0.17; frott = 0.96; vx/vy = random(10)-5; fin = 0;
            // start onEnterFrame glide physics.
            clip.stop();
            clip.vars.tps = 0;

            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;

            const x1 = cellFrom?.x ?? 0;
            const y1 = cellFrom?.y ?? 0;
            const x2 = cellTo?.x ?? 0;
            const y2 = cellTo?.y ?? 0;

            clip.vars.x1 = x1;
            clip.vars.y1 = y1;
            clip.vars.x2 = x2;
            clip.vars.y2 = y2;
            clip.vars.acc = 0.17;
            clip.vars.frott = 0.96;
            clip.vars.vx = Math.floor(Math.random() * 10) - 5;
            clip.vars.vy = Math.floor(Math.random() * 10) - 5;
            clip.vars.fin = 0;
            clip.vars.anglepos = 0;

            clip.x = x1;
            clip.y = y1;

            // Attach the crockett body child (PlaceObject2_15_2 = depth 2)
            clip.attach(crockettSym, "crockett", 2, ctx);

            // Set ym for the crockett child now that clip.y is positioned
            const crockettChild = clip.children.get("crockett");
            if (crockettChild) {
              crockettChild.vars.ym = crockettChild.y;
            }

            // Start glide onEnterFrame (AS inline function on sprite_22)
            clip.onEnterFrame = (c) => {
              // AS: DefineSprite_22/frame_1/DoAction.as → this.onEnterFrame
              const fin = c.vars.fin as number;
              if (fin !== 1) {
                let vx = c.vars.vx as number;
                let vy = c.vars.vy as number;
                const acc = c.vars.acc as number;
                const frott = c.vars.frott as number;
                const cx2 = c.vars.x2 as number;
                const cy2 = c.vars.y2 as number;

                if (c.x < cx2) {
                  vx += acc;
                } else {
                  vx -= acc;
                }
                vx *= frott;
                c.x = c.x + vx;

                if (c.y < cy2) {
                  vy += acc;
                } else {
                  vy -= acc;
                }
                vy *= frott;
                c.y = c.y + vy;

                c.vars.vx = vx;
                c.vars.vy = vy;

                const anglepos = Math.atan2(c.y - cy2, c.x - cx2);
                c.vars.anglepos = anglepos;

                let tps = c.vars.tps as number;
                if (tps === 90) {
                  // AS: gotoAndPlay(4) → 0-based = 3
                  c.gotoAndPlay(3);
                  c.vars.frott = 0.4;
                  c.vars.acc = 1;
                }
                c.vars.tps = tps + 1;
              }
            };
          },
        ],
        [
          36,
          (clip) => {
            // AS: DefineSprite_22/frame_37/DoAction.as
            // acc = 0.25;
            clip.vars.acc = 0.25;
          },
        ],
        [
          66,
          (clip, ctx) => {
            // AS: DefineSprite_22/frame_67/DoAction.as → SOMA.playSound("pose")
            // AS: DefineSprite_22/frame_67/DoAction_2.as → fin = 1; _X = x2; _Y = y2;
            // Sound is captured via callbacks stored at onSpellStart time.
            this.soundCallback?.("pose");

            clip.vars.fin = 1;
            const x2 = clip.vars.x2 as number;
            const y2 = clip.vars.y2 as number;
            clip.x = x2;
            clip.y = y2;
          },
        ],
        [
          69,
          (clip, ctx) => {
            // AS: DefineSprite_22/frame_70/DoAction.as → this.end() → signalHit
            // Also: PlaceObject2_21_1 placed at this frame → attach landing clip
            this.runtime.signalHit();
            clip.attach(landingSym, "landing", 1, ctx);
            // Also attach impact burst at target position
            clip.attach(impactSym, "impact", 3, ctx);
          },
        ],
        [
          120,
          (clip) => {
            // AS: DefineSprite_22/frame_121/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(discSym);
    this.registry.register(impactSym);
    this.registry.register(landingSym);
    this.registry.register(crockettSym);
    this.registry.register(this.sprite22Sym);
  }

  // Stored so frame scripts can invoke playSound for "pose" (frame 67)
  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: scripts/frame_2/DoAction.as → SOMA.playSound("crockette_205"); stop();
    callbacks.playSound("crockette_205");

    // Store for later use in frame scripts
    this.soundCallback = callbacks.playSound;

    // Main timeline implicitly places sprite_22 as the sole authored child.
    // displayType=50 means the container is at world origin (0,0); sprite_22
    // positions itself at cellFrom in its own frame_1.
    this.root.attach(this.sprite22Sym, "sprite22", 1, context);
  }
}
