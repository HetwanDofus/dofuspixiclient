import {
  DOMAdapter,
  ExtensionType,
  extensions,
  ImageSource,
  type Loader,
  type LoaderParser,
  type ResolvedAsset,
  Texture,
  type TextureSourceOptions,
} from "pixi.js";

// ---------------------------------------------------------------------------
// Concurrency throttle — only kicks in during extreme bulk loads (stress test)
// to prevent the browser from queueing hundreds of createImageBitmap at once.
// ---------------------------------------------------------------------------

const CONCURRENCY_LIMIT = 32;

let activeCount = 0;
const waitQueue: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (activeCount < CONCURRENCY_LIMIT) {
    activeCount++;
    return;
  }
  await new Promise<void>((resolve) => waitQueue.push(resolve));
  activeCount++;
}

function releaseSlot(): void {
  activeCount--;
  const next = waitQueue.shift();
  if (next) next();
}

// ---------------------------------------------------------------------------
// PixiJS LoaderParser
// ---------------------------------------------------------------------------

/**
 * Custom PixiJS LoaderParser for SVG spritesheets.
 *
 * __RESOLUTION__ placeholder replacement is handled server-side by the Vite
 * middleware (svgResolutionPlugin). This loader fetches SVG text once,
 * decodes via Blob URL + <img>, rasterizes at target resolution via
 * createImageBitmap, and wraps the result in a PixiJS Texture.
 */
export const svgStrokeLoader: LoaderParser<Texture, TextureSourceOptions> = {
  extension: {
    type: ExtensionType.LoadParser,
    priority: 110,
    name: "loadSvgStroke",
  },

  id: "loadSvgStroke",
  name: "loadSvgStroke",

  test(url: string): boolean {
    return url.endsWith(".svg");
  },

  async load(
    url: string,
    asset?: ResolvedAsset<TextureSourceOptions>,
    _loader?: Loader
  ): Promise<Texture> {
    const resolution = asset?.data?.resolution ?? 1;

    // Single fetch — read SVG text for dimensions, then decode from Blob URL
    const response = await DOMAdapter.get().fetch(url);
    const svgContent = await response.text();

    const widthMatch = svgContent.match(/\bwidth="(\d+(?:\.\d+)?)"/);
    const heightMatch = svgContent.match(/\bheight="(\d+(?:\.\d+)?)"/);
    const width = widthMatch ? parseFloat(widthMatch[1]) : 256;
    const height = heightMatch ? parseFloat(heightMatch[1]) : 256;

    const outputWidth = Math.ceil(width * resolution);
    const outputHeight = Math.ceil(height * resolution);

    const enhancedSvg = svgContent.replace(
      "<svg ",
      '<svg shape-rendering="geometricPrecision" '
    );

    const blob = new Blob([enhancedSvg], { type: "image/svg+xml" });
    const blobUrl = URL.createObjectURL(blob);
    const image = DOMAdapter.get().createImage();
    image.src = blobUrl;

    try {
      await image.decode();
    } finally {
      URL.revokeObjectURL(blobUrl);
    }

    await acquireSlot();

    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(image as ImageBitmapSource, {
        resizeWidth: outputWidth,
        resizeHeight: outputHeight,
        resizeQuality: "high",
        colorSpaceConversion: "none",
      });
    } finally {
      releaseSlot();
    }

    const source = new ImageSource({
      resource: bitmap,
      alphaMode: "premultiply-alpha-on-upload",
      resolution,
      ...asset?.data,
    });

    return new Texture({ source });
  },

  unload(texture: Texture): void {
    texture.destroy(true);
  },
};

/**
 * Register the SVG stroke loader with PixiJS.
 * Call this before loading any SVG assets.
 */
export function registerSvgStrokeLoader(): void {
  extensions.add(svgStrokeLoader);
}
