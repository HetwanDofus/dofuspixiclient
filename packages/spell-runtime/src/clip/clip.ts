/**
 * SpellClip — Pixi-Container-backed node in the spell composition
 * tree. Replaces both `BaseSpell.container` and the per-particle
 * sprite tracking that hand-ported spells used to manage themselves.
 *
 * Each clip:
 *   - Owns one Pixi `Container` for transform inheritance.
 *   - Optionally owns one Pixi `Sprite` for displaying the symbol's
 *     current frame texture (skipped for container-only symbols).
 *   - Holds a child map keyed by AS instance name (the depth from
 *     `attachMovie(name, instanceName, depth)` becomes Pixi's
 *     `zIndex`; we keep the name → child map separately so AS-style
 *     `this.children["baton" + c]` lookups stay O(1)).
 *   - Tracks a 0-indexed timeline + frame scripts.
 *
 * The `vars` bag mirrors AS-2's "any unqualified assignment in a clip
 * event becomes a property of the clip" semantic. The compiler emits
 * `clip.vars.vx` etc.; hand-ported spells use the same convention.
 */

import { Container, Sprite, Texture } from "pixi.js";

import type { SpellContext } from "../spell-interface.ts";

import type {
  ClipEventHandler,
  FrameScript,
  SymbolDefinition,
} from "./types.ts";

export interface SpellClipInit {
  symbol: SymbolDefinition | null;
  name: string;
  parent: SpellClip | null;
}

export class SpellClip {
  readonly container: Container;
  readonly sprite: Sprite | null;
  /** AS dynamic locals — every unqualified `foo = …` assignment lands here. */
  readonly vars: Record<string, unknown> = {};
  readonly children = new Map<string, SpellClip>();

  readonly symbolName: string | null;
  readonly name: string;
  parent: SpellClip | null;

  // --- Timeline state ---------------------------------------------
  totalFrames: number;
  /** 0-indexed (`frame_1` in AS = 0 here). */
  currentFrame: number;
  isPlaying: boolean;
  private readonly frameScripts: ReadonlyMap<number, FrameScript>;
  private readonly framesArr: readonly Texture[];

  // --- Clip-event handlers ----------------------------------------
  onEnterFrame: ClipEventHandler | null;

  // --- Lifecycle --------------------------------------------------
  private destroyed = false;
  /** Set when `removeMovieClip` is called from a script — picked up by the runtime to dispose after the current tick completes. */
  pendingRemoval = false;

  constructor(init: SpellClipInit) {
    this.symbolName = init.symbol?.name ?? null;
    this.name = init.name;
    this.parent = init.parent;
    this.container = new Container();
    this.container.label = `clip:${init.name}`;
    this.totalFrames = init.symbol?.totalFrames ?? 1;
    this.currentFrame = 0;
    this.isPlaying = true;
    this.frameScripts = init.symbol?.frameScripts ?? new Map();
    this.framesArr = init.symbol?.frames ?? [];
    this.onEnterFrame = init.symbol?.onEnterFrame ?? null;

    if (this.framesArr.length > 0) {
      this.sprite = new Sprite(this.framesArr[0] ?? Texture.EMPTY);
      this.sprite.anchor.set(
        init.symbol?.anchorX ?? 0.5,
        init.symbol?.anchorY ?? 0.5
      );
      this.container.addChild(this.sprite);
    } else {
      this.sprite = null;
    }
  }

  // ============================================================
  // Idiomatic TS transform — backed by Pixi
  // ============================================================

  get x(): number {
    return this.container.position.x;
  }
  set x(v: number) {
    this.container.position.x = v;
  }
  get y(): number {
    return this.container.position.y;
  }
  set y(v: number) {
    this.container.position.y = v;
  }

  /** Decimal scale (1 = 100%). NOT Flash percent. */
  get scaleX(): number {
    return this.container.scale.x;
  }
  set scaleX(v: number) {
    this.container.scale.x = v;
  }
  get scaleY(): number {
    return this.container.scale.y;
  }
  set scaleY(v: number) {
    this.container.scale.y = v;
  }

  /** Radians. NOT Flash degrees. Compiler emits `* Math.PI / 180`. */
  get rotation(): number {
    return this.container.rotation;
  }
  set rotation(v: number) {
    this.container.rotation = v;
  }

  /** 0-1. NOT Flash 0-100. */
  get alpha(): number {
    return this.container.alpha;
  }
  set alpha(v: number) {
    this.container.alpha = v;
  }

  get visible(): boolean {
    return this.container.visible;
  }
  set visible(v: boolean) {
    this.container.visible = v;
  }

  // ============================================================
  // Timeline control
  // ============================================================

  stop(): void {
    this.isPlaying = false;
  }
  play(): void {
    this.isPlaying = true;
  }
  /** AS `gotoAndPlay(N)` — N is 1-based in AS, 0-based here. */
  gotoAndPlay(frameZeroBased: number): void {
    this.currentFrame = clampFrame(frameZeroBased, this.totalFrames);
    this.isPlaying = true;
    this.refreshSpriteFrame();
  }
  gotoAndStop(frameZeroBased: number): void {
    this.currentFrame = clampFrame(frameZeroBased, this.totalFrames);
    this.isPlaying = false;
    this.refreshSpriteFrame();
  }

  // ============================================================
  // Hierarchy
  // ============================================================

  /**
   * Spawn a child clip from a library symbol. Mirrors AS
   * `this.attachMovie(symbolName, instanceName, depth)` plus the
   * follow-up transform statements canonical callers issue:
   *
   *   var c = mc.attachMovie("shoot","shoot",2);
   *   c._x = xDest;
   *   c._y = yDest;
   *   c._rotation = Math.atan(vyi/vx) * 180/PI;
   *
   * In canonical Flash, all of those run on the same tick and the
   * playhead is then at the new clip's frame 1, where the frame
   * actions fire. Crucially: frame_1 actions run AFTER the caller's
   * transform setters, so a `_rotation = 0` inside frame_1 overrides
   * any rotation the caller just applied.
   *
   * Our `transform` parameter folds those transform statements into
   * `attach()` so the order is unambiguously canonical:
   *   1. Create clip + add to parent
   *   2. Apply `transform` (caller-supplied initial _x/_y/_rotation)
   *   3. Fire `onClipEvent(load)`
   *   4. Fire `frame_1/DoAction.as` (= frameScripts[0])
   *
   * Steps 3 + 4 may override transform — that's correct, it's what
   * canonical AS does (see DefineSprite_9_shoot/frame_1 line 2:
   * `_rotation = 0;` resets the velocity-angle rotation that
   * VisualEffectHandler.as:159 just applied).
   *
   * If a child already exists at the same `instanceName` it's removed
   * first (matches AS's "later attach replaces earlier at same name"
   * convention).
   */
  attach(
    symbol: SymbolDefinition,
    instanceName: string,
    depth: number,
    ctx: SpellContext,
    transform?: { x?: number; y?: number; rotation?: number }
  ): SpellClip {
    const existing = this.children.get(instanceName);
    if (existing) {
      // Synchronously dispose, not just `remove()` (which defers via
      // pendingRemoval). The map entry is about to be overwritten — if
      // we only set pendingRemoval, the prior child becomes unreachable
      // from `walk()` and `collectGarbage()` (both iterate
      // `this.children.values()`), so its container leaks into Pixi's
      // scene graph forever and any onEnterFrame handlers it owns keep
      // their captured state alive. That is exactly the failure mode
      // that turned looping-timeline spells (sprite9 wrap → re-attach
      // sprite7_d2 every ~1s with the same instanceName) into a
      // monotonic memory bomb that hangs the browser tab.
      existing.disposeInPlace();
    }
    const child = new SpellClip({ symbol, name: instanceName, parent: this });
    child.container.zIndex = depth;
    this.container.addChild(child.container);
    this.children.set(instanceName, child);

    // Step 2: apply caller transforms BEFORE clip events fire so any
    // frame_1 override (e.g. shoot's `_rotation = 0`) wins.
    if (transform) {
      if (transform.x !== undefined) child.x = transform.x;
      if (transform.y !== undefined) child.y = transform.y;
      if (transform.rotation !== undefined) child.rotation = transform.rotation;
    }

    // Step 3: onClipEvent(load).
    if (symbol.onLoad) {
      try {
        symbol.onLoad(child, ctx);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[SpellClip] onLoad threw for ${symbol.name}/${instanceName}: ${String(err)}`
        );
      }
    }

    // Step 4: frame_1 / DoAction.as actions (= frameScripts[0]).
    const entryScript = symbol.frameScripts?.get(0);
    if (entryScript) {
      try {
        entryScript(child, ctx);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[SpellClip] frame_1 script threw for ${symbol.name}/${instanceName}: ${String(err)}`
        );
      }
    }
    return child;
  }

  /**
   * Mark this clip for removal at the end of the current tick. We
   * defer the actual destruction so a frame script that calls
   * `_parent.removeMovieClip()` doesn't yank the rug out from under
   * its own iteration.
   */
  remove(): void {
    this.pendingRemoval = true;
  }

  /** Look up a descendant by `/` separated path. */
  find(path: string): SpellClip | null {
    if (path === "" || path === ".") return this;
    const [head, ...rest] = path.split("/");
    if (!head) return null;
    const child = this.children.get(head);
    if (!child) return null;
    return rest.length === 0 ? child : child.find(rest.join("/"));
  }

  // ============================================================
  // Tick — internal use by SpellRuntime
  // ============================================================

  /**
   * Advance one Flash frame:
   *   1. Run `onEnterFrame` (clip-event handler).
   *   2. If playing, advance `currentFrame`, run any frame script at
   *      the new index, refresh the displayed sprite texture.
   *
   * Frame scripts execute AFTER the index advances so AS-2 semantics
   * line up: in AS, `gotoAndStop(2)` then "frame_2 plays" because the
   * playhead is at 2 when the frame's actions run.
   */
  tickOneFrame(ctx: SpellContext): void {
    if (this.destroyed || this.pendingRemoval) return;
    // The pixi container can be destroyed out from under us when
    // `runtime.complete()` is called from a frame script earlier in
    // this same snapshot iteration: complete() → callbacks.onComplete()
    // → scene.remove() → actor.dispose() → spell.destroy() →
    // root.container.destroy({ children: true }). That cascade nulls
    // out every descendant container's _scale/_position without
    // touching our `destroyed` flag, so the next clip in the snapshot
    // (e.g. sprite6_main) would otherwise try `clip.scaleX = 1` on a
    // destroyed container and throw "Cannot set properties of null".
    if (this.container.destroyed) return;

    if (this.onEnterFrame) {
      try {
        this.onEnterFrame(this, ctx);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[SpellClip] onEnterFrame threw for ${this.symbolName}/${this.name}: ${String(err)}`
        );
      }
      // onEnterFrame may have called remove(); short-circuit so we
      // don't run frame scripts on a clip about to be torn down.
      if (this.pendingRemoval) return;
    }

    if (this.isPlaying) {
      // Advance, then run script at the new frame.
      const next = this.currentFrame + 1;
      if (next < this.totalFrames) {
        this.currentFrame = next;
      } else {
        // Loop — AS default for clips without `stop()`. The frame
        // scripts on first frame fire again on the wrap.
        this.currentFrame = 0;
      }
      this.refreshSpriteFrame();
      const script = this.frameScripts.get(this.currentFrame);
      if (script) {
        try {
          script(this, ctx);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[SpellClip] frame script threw for ${this.symbolName}/${this.name} @ frame ${this.currentFrame}: ${String(err)}`
          );
        }
      }
    }
  }

  /**
   * Recursively dispose clips marked `pendingRemoval` after a tick.
   * Walks bottom-up so children are torn down before their parents.
   */
  collectGarbage(): void {
    for (const child of [...this.children.values()]) {
      child.collectGarbage();
    }
    if (this.pendingRemoval) {
      this.dispose();
    }
  }

  /** Iterate self + all descendants in pre-order. */
  *walk(): IterableIterator<SpellClip> {
    if (this.destroyed) return;
    yield this;
    for (const child of this.children.values()) {
      yield* child.walk();
    }
  }

  /**
   * Run `onLoad` for THIS clip. Used by the runtime when bootstrapping
   * the root clip (which isn't created via `attach`, so its onLoad
   * has to be triggered separately).
   */
  fireLoad(symbol: SymbolDefinition, ctx: SpellContext): void {
    if (symbol.onLoad) {
      symbol.onLoad(this, ctx);
    }
  }

  // ============================================================
  // Internal
  // ============================================================

  /**
   * Synchronously tear down this clip + all descendants. Called by
   * `attach()` when overwriting a child at the same instanceName, so
   * the replaced subtree leaves the Pixi scene graph immediately
   * instead of relying on `collectGarbage()` (which iterates the parent's
   * children map — useless for a clip that's about to be evicted from
   * that map). The clip's destroyed flag short-circuits any stale
   * `tickOneFrame` invocations from the current-tick walk snapshot.
   */
  disposeInPlace(): void {
    this.dispose();
  }

  private refreshSpriteFrame(): void {
    if (!this.sprite || this.framesArr.length === 0) return;
    // Clamp to the last available texture when `currentFrame` runs past
    // `framesArr.length`. Vello dedupes identical trailing frames (e.g.
    // spell 108/110: 129 logical frames, only 88 unique because frames
    // 87-128 are the post-`_parent.removeMovieClip()` placeholder), and
    // returns frameCount = unique count. The clip's `totalFrames` still
    // reflects the LOGICAL timeline length (129) so frame_<stop> scripts
    // fire at the right frame, but `framesArr[currentFrame]` is
    // `undefined` past the unique-count boundary. Falling back to
    // `framesArr[0]` (the prior behaviour) made the animation appear to
    // "restart" at frame 0 for the remainder of the timeline; the
    // canonical SWF behaviour is to keep displaying the deduped trailing
    // frame, which is what clamping to `length - 1` gives us.
    const idx =
      this.currentFrame < this.framesArr.length
        ? this.currentFrame
        : this.framesArr.length - 1;
    const tex = this.framesArr[idx];
    if (tex) {
      this.sprite.texture = tex;
    }
  }

  private dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const child of this.children.values()) {
      child.dispose();
    }
    this.children.clear();
    if (this.parent) {
      this.parent.children.delete(this.name);
      this.parent.container.removeChild(this.container);
    }
    if (!this.container.destroyed) {
      this.container.destroy({ children: true });
    }
  }
}

function clampFrame(frame: number, total: number): number {
  if (total <= 0) return 0;
  if (frame < 0) return 0;
  if (frame >= total) return total - 1;
  return frame;
}
