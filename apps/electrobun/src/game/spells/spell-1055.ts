/**
 * Spell 1055 — (Vladala / Sacrieur spike spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1055/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Two authored sprite timelines are placed on
 * the main timeline at frame_2 — one positioned at cellFrom (sprite_8, depth 1)
 * and one at cellTo (sprite_9, depth 6). The harness exposes cellFrom/cellTo
 * on root.vars; the per-sprite frame_1 scripts read those to position themselves
 * at world coords. This is the canonical WorldAbsolute dual-anchored pattern.
 *
 * Library symbols:
 *   - lib_spire — single-frame spike particle. onLoad seeds va, alpha, scale,
 *     velocity v, and frames to 1 or 2 based on parent.c % 2. onEnterFrame
 *     grows yscale by 1.02x, drifts up (v decays 0.97x), fades by va per tick,
 *     removes self when alpha < 0.
 *
 * Authored timelines (registered as container symbols):
 *   - sprite_8 — 117-frame caster-side composite. frame_4 plays sound
 *     "vlad_804" and spawns 10 spire particles from the PlaceObject2_7_4
 *     onClipEvent(load). frame_115 calls _parent.removeMovieClip → complete.
 *   - sprite_9 — 27-frame target-side timeline. frame_10 calls this.end()
 *     → signalHit.
 *
 * Main timeline (frame_2/DoAction.as): stop(). The two sprites are placed via
 * PlaceObject2_8_1 (depth 1 → cellFrom) and PlaceObject2_8_6 (depth 6 → cellTo).
 * Their onClipEvent(load) scripts position them at cellFrom/cellTo respectively.
 * We attach them explicitly in onSpellStart after registering symbols.
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
    _context: SpellContext
  ): void {
    const spireAnchor = calculateAnchor(SPIRE_BOUNDS);

    // ---- lib_spire — spike/spire particle ----------------------------------------
    // Canonical sources:
    //   DefineSprite_3_spire/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    //   DefineSprite_3_spire/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // The "spire" symbol itself (DefineSprite_3_spire) is a 2-frame sprite whose
    // frame is chosen on load based on parent.c % 2. PlaceObject2_2_1 is an inner
    // placed object inside spire; because the combat exporter exports the whole
    // symbol as lib_spire (including its 2 visual frames), we treat the CLIPACTION
    // handlers as belonging directly to the lib_spire SymbolDefinition.
    this.spireSym = {
      name: "spire",
      totalFrames: 2,
      frames: textures.getFrames("lib_spire"),
      anchorX: spireAnchor.x,
      anchorY: spireAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_3_spire/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.va = 1 + Math.floor(Math.random() * 2.5);
        clip.alpha = (50 + Math.floor(Math.random() * 50)) / 100;
        clip.scaleY = 80 / 100;
        clip.scaleX = (80 + Math.floor(Math.random() * 80)) / 100;
        clip.vars.v = 0.67 + 1.67 * Math.random();
        // Choose frame based on parent.c % 2
        const c = (clip.parent?.vars.c as number) ?? 1;
        if (c % 2 === 0) {
          clip.gotoAndStop(1); // gotoAndStop(2) → 0-based index 1
        } else {
          clip.gotoAndStop(0); // gotoAndStop(1) → 0-based index 0
        }
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3_spire/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let v = clip.vars.v as number;
        let alphaPct = clip.alpha * 100; // work in AS 0-100 units
        const va = clip.vars.va as number;

        clip.scaleY = clip.scaleY * 1.02;
        v *= 0.97;
        clip.y -= v;
        alphaPct -= va;
        clip.alpha = alphaPct / 100;
        clip.vars.v = v;

        if (alphaPct < 0) {
          // _parent.removeMovieClip() — removes the spire clip itself
          clip.remove();
        }
      },
    };

    // ---- sprite_8 — 117-frame caster-side composite ------------------------------------
    // Canonical sources:
    //   DefineSprite_8/frame_4/DoAction.as  → playSound("vlad_804")
    //   DefineSprite_8/frame_4/PlaceObject2_7_4/CLIPACTIONRECORD onClipEvent(load).as
    //     → spawn 10 spire particles
    //   DefineSprite_8/frame_115/DoAction.as → _parent.removeMovieClip()
    //
    // The PlaceObject2_7_4 at frame_4 places a "spawner" container at (x,y) of self.
    // Its onClipEvent(load) immediately attachMovie 10 spire instances to itself.
    // We model this directly in frame_4's frameScript by attaching 10 spires to the
    // sprite_8 clip at appropriate y offsets, mirroring the canonical _X/_Y logic.
    // (The "PlaceObject2_7_4" wrapper has no further handlers of its own beyond the
    // one-shot load, so we fold the 10 attaches directly into sprite_8's frame_4 script.)
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
        // AS frame_2/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load).as
        // _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y;
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
            // AS DefineSprite_8/frame_4/DoAction.as: SOMA.playSound("vlad_804")
            // Sound is played from the callbacks captured in onSpellStart;
            // the manifest lists this sound at frame 3 (0-based = frame_4 in AS).
            // We capture callbacks via the soundCallback field set in onSpellStart.
            if (this.soundCallback) {
              this.soundCallback("vlad_804");
            }

            // AS DefineSprite_8/frame_4/PlaceObject2_7_4/CLIPACTIONRECORD onClipEvent(load).as
            // c = 1; while (c <= 10) {
            //   this.attachMovie("spire","spire"+c,c);
            //   eval("spire"+c)._x = _X;  ← position at self's current x
            //   eval("spire"+c)._y = _Y - random(50);
            //   eval("spire"+c)._rotation = _rotation;
            //   eval("spire"+c).c = c;
            //   c++;
            // }
            // The spawner object (_X, _Y) is positioned AT clip's own world position
            // (already set by onLoad to cellFrom). Within clip-local coords, the
            // spawner sits at (0, 0) relative to the clip. So spires get x=0,
            // y = -random(50) in clip-local coords, with clip.rotation passed through.
            for (let c = 1; c <= 10; c++) {
              const spireClip = clip.attach(this.spireSym, `spire${c}`, c, ctx);
              spireClip.x = 0;
              spireClip.y = -Math.floor(Math.random() * 50);
              spireClip.rotation = clip.rotation;
              // Pass c so spire's onLoad can read _parent.c
              spireClip.vars.c = c;
            }
          },
        ],
        [
          114,
          (clip) => {
            // AS DefineSprite_8/frame_115/DoAction.as: _parent.removeMovieClip()
            // This is the outermost mc removal → spell complete.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- sprite_9 — 27-frame target-side timeline --------------------------------
    // Canonical sources:
    //   frame_2/PlaceObject2_8_6/CLIPACTIONRECORD onClipEvent(load).as
    //     → _X = _parent.cellTo.x; _Y = _parent.cellTo.y
    //   DefineSprite_9/frame_10/DoAction.as → this.end() → signalHit
    this.sprite9Sym = {
      name: "sprite_9",
      totalFrames: 27,
      frames: textures.getFrames("sprite_9"),
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_8_6/CLIPACTIONRECORD onClipEvent(load).as
        // _X = _parent.cellTo.x; _Y = _parent.cellTo.y
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
    context: SpellContext
  ): void {
    // Capture sound callback so frame scripts inside sprite_8 can play sounds.
    this.soundCallback = callbacks.playSound;

    // AS frame_2/DoAction.as: stop()
    // The main timeline stops at frame_2. We attach the two authored timelines
    // that are placed on the main timeline at frame_2:
    //   PlaceObject2_8_1 (depth 1) → sprite_8, positioned at cellFrom
    //   PlaceObject2_8_6 (depth 6) → sprite_9, positioned at cellTo
    // Their onLoad handlers perform the world-coordinate positioning.
    this.root.attach(this.sprite8Sym, "sprite8_1", 1, context);
    this.root.attach(this.sprite9Sym, "sprite9_6", 6, context);
  }
}
