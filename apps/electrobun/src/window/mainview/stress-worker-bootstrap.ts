/**
 * Worker DOM polyfill — must be imported FIRST in the worker entry
 * (before pixi.js / vello-wasm / anything that touches `document`
 * or `window`).
 *
 * Pixi v8 references `document` and `window` during Application
 * init even when an `OffscreenCanvas` is provided (event system
 * setup, layout extension probes, etc.). Workers don't have these
 * globals, so we stub them with no-op surfaces just rich enough to
 * keep Pixi from throwing. None of this code paths should actually
 * fire at runtime — they're satisfied at module-evaluation /
 * init-time and then ignored.
 *
 * Imported before everything else: ES modules evaluate side-effect
 * imports in source order, so `import "./stress-worker-bootstrap"`
 * at the top of the worker entry runs THIS file's top-level code
 * before any pixi.js module evaluates.
 */

const g = globalThis as unknown as {
  document?: unknown;
  window?: unknown;
  HTMLCanvasElement?: unknown;
  Image?: unknown;
};

if (typeof g.document === "undefined") {
  const noop = () => {
    /* no-op */
  };
  const fakeStyle = new Proxy(
    {},
    {
      get: () => "",
      set: () => true,
    },
  );
  const fakeElement = {
    style: fakeStyle,
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: (n: unknown) => n,
    removeChild: (n: unknown) => n,
    insertBefore: (n: unknown) => n,
    contains: () => false,
    setAttribute: noop,
    getAttribute: () => null,
    removeAttribute: noop,
    hasAttribute: () => false,
    getContext: () => null,
    getBoundingClientRect: () => ({
      x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
    }),
    dispatchEvent: () => true,
    cloneNode: () => fakeElement,
    parentNode: null,
    parentElement: null,
    children: [] as unknown[],
    childNodes: [] as unknown[],
    firstChild: null,
    nodeType: 1,
    nodeName: "DIV",
    width: 1,
    height: 1,
    clientWidth: 1,
    clientHeight: 1,
    offsetWidth: 1,
    offsetHeight: 1,
  };
  g.document = {
    createElement: () => fakeElement,
    createElementNS: () => fakeElement,
    documentElement: { ...fakeElement, style: fakeStyle },
    body: fakeElement,
    head: fakeElement,
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    fonts: { ready: Promise.resolve(), load: () => Promise.resolve() },
    visibilityState: "visible",
    hidden: false,
  };
}

if (typeof g.window === "undefined") {
  // Pixi sometimes does `window.devicePixelRatio` or
  // `window.addEventListener("resize", …)`. Point window at the
  // worker global so these no-op safely.
  g.window = self;
  const w = self as unknown as { devicePixelRatio?: number };
  if (typeof w.devicePixelRatio === "undefined") w.devicePixelRatio = 1;
}

// Pixi may probe `HTMLCanvasElement` for `instanceof` checks. In a
// worker we have `OffscreenCanvas`; alias the name to it so Pixi's
// "is this a canvas?" check passes.
if (typeof g.HTMLCanvasElement === "undefined") {
  g.HTMLCanvasElement = OffscreenCanvas;
}

// Pixi's image loaders sometimes reference `Image`. We don't load
// images in the stress test, but stub it so module-time references
// don't ReferenceError.
if (typeof g.Image === "undefined") {
  g.Image = class {
    onload: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    src = "";
  };
}

export {};
