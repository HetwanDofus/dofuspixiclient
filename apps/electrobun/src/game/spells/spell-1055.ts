/**
 * Spell 1055 — Vlad (unknown class, likely Sram/Xelor based on sound "vlad_804").
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1055/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Two parallel authored timelines placed on the
 * main timeline frame_2: sprite_8 (117-frame, caster-anchored spire burst with
 * particle system) and sprite_9 (27-frame, target-anchored impact). Both position
 * themselves via _parent.cellFrom / _parent.cellTo on their onLoad events,
 * which is the canonical WorldAbsolute pattern.
 *
 * Library symbols:
 *   - lib_spire — single-frame upward-drifting spike particle. onLoad seeds va
 *     (alpha decay rate), alpha, scale, velocity v, and frame variant (1 or 2
 *     based on parent.c parity). onEnterFrame scales up, drifts upward with
 *     friction, fades alpha; removes parent when alpha < 0.
 *
 * Main timeline (frame_2/DoAction.as): stop(). Two clips (sprite_8 at depth 1,
 * sprite_9 at depth 6) are placed on the main timeline with onLoad positioning.
 *
 * sprite_8 (DefineSprite_8):
 *   - frame_4/PlaceObject2_7_4/onClipEvent(load): spawns 10 spire particles
 *     at self's position with random Y offsets, copies rotation.
 *   - frame_4/DoAction.as: plays sound "vlad_804".
 *   - frame_115/DoAction.as: _parent.removeMovieClip() → spell complete.
 *
 * sprite_9 (DefineSprite_9):
 *   - frame_10/DoAction.as: this.end() → signalHit.
 *
 * Both sprite_8 and sprite_9 only appear in animations[] (not librarySymbols[]),
 * so their texture keys have NO lib_ prefix. lib_spire is in librarySymbols[] so
 * it uses the lib_ prefix.
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

const SPIRE_BOUNDS = {
  width: 12.65,
  height: 23.8,
  offsetX: -6.05,
  offsetY: -11.9,
};

export class Spell1055 extends RuntimeSpell {
  readonly spellId = 1055;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite8Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private spireSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const spireAnchor = calculateAnchor(SPIRE_BOUNDS);

    // ---- lib_spire — upward-drifting spike particle ---------------
    // AS: DefineSprite_3_spire/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_3_spire/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.spireSym = {
      name: "spire",
      totalFrames: 2,
      frames: textures.getFrames("lib_spire"),
      anchorX: spireAnchor.x,
      anchorY: spireAnchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   va = 1 + random(2.5)  → random(2.5) in AS = Math.floor(Math.random() * 2.5) = 0 or 1
        //   _alpha = 50 + random(50)
        //   _yscale = 80
        //   _xscale = 80 + random(80)
        //   v = 0.67 + 1.67 * Math.random()
        //   if (_parent.c % 2 == 0) gotoAndStop(2) else gotoAndStop(1)
        clip.vars.va = 1 + Math.floor(Math.random() * 2.5);
        clip.alpha = (50 + Math.floor(Math.random() * 50)) / 100;
        clip.scaleY = 80 / 100;
        clip.scaleX = (80 + Math.floor(Math.random() * 80)) / 100;
        clip.vars.v = 0.67 + 1.67 * Math.random();
        const parentC = (clip.parent?.vars.c as number) ?? 1;
        if (parentC % 2 === 0) {
          clip.gotoAndStop(1); // AS gotoAndStop(2) → 0-based index 1
        } else {
          clip.gotoAndStop(0); // AS gotoAndStop(1) → 0-based index 0
        }
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   _yscale = _yscale * 1.02
        //   _Y = _Y - (v *= 0.97)
        //   _alpha = _alpha - va
        //   if (_alpha < 0) _parent.removeMovieClip()
        clip.scaleY = clip.scaleY * 1.02;
        let v = clip.vars.v as number;
        v *= 0.97;
        clip.vars.v = v;
        clip.y -= v;
        const va = clip.vars.va as number;
        const newAlpha = clip.alpha * 100 - va;
        clip.alpha = newAlpha / 100;
        if (newAlpha < 0) {
          clip.parent?.remove();
        }
      },
    };

    // ---- sprite_8 — caster-side 117-frame timeline ---------------
    // Positions itself at cellFrom on load.
    // frame_4: spawns 10 spire particles + plays sound.
    // frame_115: _parent.removeMovieClip() → spell complete.
    this.sprite8Sym = {
      name: "sprite_8",
      totalFrames: 117,
      frames: textures.getFrames("sprite_8"),
      anchorX: calculateAnchor({
        width: 51.8,
        height: 207.35,
        offsetX: -27.45,
        offsetY: -182.45,
      }).x,
      anchorY: calculateAnchor({
        width: 51.8,
        height: 207.35,
        offsetX: -27.45,
        offsetY: -182.45,
      }).y,
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load).as:
        //   _X = _parent.cellFrom.x
        //   _Y = _parent.cellFrom.y
        const root = clip.parent;
        const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
        if (cellFrom) {
          clip.x = cellFrom.x;
          clip.y = cellFrom.y;
        }
      },
      frameScripts: new Map([
        [
          3,
          (clip, ctx) => {
            // AS DefineSprite_8/frame_4/PlaceObject2_7_4/CLIPACTIONRECORD onClipEvent(load).as
            // and DefineSprite_8/frame_4/DoAction.as
            //
            // The PlaceObject at frame_4 places a child MC at depth 4 (PlaceObject2_7_4),
            // whose onClipEvent(load) spawns 10 spire particles inside it using
            // eval("spire" + c) references (i.e. attaching to that child MC).
            // We model this by creating an intermediate container "spireContainer" and
            // attaching the spire children to it; the container inherits the clip's
            // position/rotation so eval("spire"+c)._x = _X etc. works correctly.
            //
            // The PlaceObject child itself is positioned at clip._X, clip._Y with
            // clip._rotation from the authored SWF — since sprite_8 was placed at
            // cellFrom in onLoad, the container's position is already the right
            // world position. The spires are attached TO the container at offsets
            // relative to the container (eval("spire"+c)._y = _Y - random(50) means
            // relative to the container's own registration, so Y offset = -random(50)).
            //
            // AS: c = 1; while (c <= 10) { attachMovie("spire","spire"+c,c); ... c++ }
            // Note: loop is 1-based c <= 10 (10 iterations)
            const containerSym: SymbolDefinition = {
              name: "_spireContainer",
              totalFrames: 1,
              frames: [],
              anchorX: 0.5,
              anchorY: 0.5,
              onLoad: (container, innerCtx) => {
                // AS DefineSprite_8/frame_4/PlaceObject2_7_4/CLIPACTIONRECORD onClipEvent(load).as:
                //   c = 1; while (c <= 10) { attachMovie("spire","spire"+c, c); set props; c++ }
                // eval("spire"+c)._x = _X and _y = _Y - random(50) are in the CONTAINER's
                // local coord space (_X/_Y of the PlaceObject MC, which is 0,0 locally).
                // _rotation = _rotation means copy the container's rotation.
                for (let c = 1; c <= 10; c++) {
                  const spireChild = container.attach(
                    this.spireSym,
                    `spire${c}`,
                    c,
                    innerCtx,
                  );
                  spireChild.x = 0; // eval("spire"+c)._x = _X (container's local X = 0)
                  spireChild.y = 0 - Math.floor(Math.random() * 50); // _Y - random(50)
                  spireChild.rotation = container.rotation; // _rotation = _rotation
                  spireChild.vars.c = c;
                }
              },
            };
            // Register the ephemeral container sym in registry so attach works
            this.registry.register(containerSym);
            clip.attach(containerSym, "_spireContainerInst", 4, ctx);

            // AS DefineSprite_8/frame_4/DoAction.as: SOMA.playSound("vlad_804")
            // Sound playback from a frame script — use the stored callback
            if (this.soundCallback) {
              this.soundCallback("vlad_804");
            }
          },
        ],
        [
          114,
          (clip) => {
            // AS DefineSprite_8/frame_115/DoAction.as: _parent.removeMovieClip()
            // This is the outer mc removal — signal completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- sprite_9 — target-side 27-frame impact timeline ---------
    // Positions itself at cellTo on load.
    // frame_10: this.end() → signalHit.
    this.sprite9Sym = {
      name: "sprite_9",
      totalFrames: 27,
      frames: textures.getFrames("sprite_9"),
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_8_6/CLIPACTIONRECORD onClipEvent(load).as:
        //   _X = _parent.cellTo.x
        //   _Y = _parent.cellTo.y
        const root = clip.parent;
        const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
        if (cellTo) {
          clip.x = cellTo.x;
          clip.y = cellTo.y;
        }
      },
      frameScripts: new Map([
        [
          9,
          () => {
            // AS DefineSprite_9/frame_10/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
      ]),
    };

    this.registry.register(this.spireSym);
    this.registry.register(this.sprite8Sym);
    this.registry.register(this.sprite9Sym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use in frame scripts
    this.soundCallback = callbacks.playSound.bind(callbacks);

    // AS frame_2/DoAction.as: stop()
    // The main timeline stops at frame 2 which has sprite_8 (depth 1) and
    // sprite_9 (depth 6) placed on it with onLoad positioning scripts.
    // We attach them here so they start ticking from the next runtime frame.
    this.root.attach(this.sprite8Sym, "sprite8", 1, context);
    this.root.attach(this.sprite9Sym, "sprite9", 6, context);
  }
}
