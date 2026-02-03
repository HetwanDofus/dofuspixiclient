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

/**
 * Custom PixiJS LoaderParser that transforms SVG stroke-width placeholders
 * based on the resolution parameter.
 *
 * Replaces __RESOLUTION__ placeholders with 1/resolution to ensure
 * stroke widths appear consistent at any scale.
 */
export const svgStrokeLoader: LoaderParser<Texture, TextureSourceOptions> = {
  extension: {
    type: ExtensionType.LoadParser,
    priority: 110, // Higher priority than default SVG loader (Low = 0)
    name: "loadSvgStroke",
  },

  id: "loadSvgStroke",
  name: "loadSvgStroke",

  test(url: string): boolean {
    // Only handle SVG files from our spritesheets path
    return url.includes("/spritesheets/") && url.endsWith(".svg");
  },

  async load(
    url: string,
    asset?: ResolvedAsset<TextureSourceOptions>,
    _loader?: Loader
  ): Promise<Texture> {
    const response = await DOMAdapter.get().fetch(url);
    let svgContent = await response.text();

    // Get resolution from asset data (defaults to 1)
    const resolution = asset?.data?.resolution ?? 1;

    // Replace __RESOLUTION__ placeholders with inverse of resolution
    // This ensures strokes appear at consistent visual width regardless of scale
    const strokeScale = (1 / resolution).toString();
    svgContent = svgContent.replace(/__RESOLUTION__/g, strokeScale);

    // Create Blob URL from SVG content
    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    const blobUrl = URL.createObjectURL(blob);

    // Create image from Blob URL
    const image = DOMAdapter.get().createImage();
    image.src = blobUrl;

    try {
      await image.decode();
    } finally {
      // Clean up Blob URL after image is loaded
      URL.revokeObjectURL(blobUrl);
    }

    // Get dimensions
    const width = asset?.data?.width ?? image.width;
    const height = asset?.data?.height ?? image.height;

    // Ensure canvas dimensions are integers to prevent edge trimming
    const canvasWidth = Math.ceil(width * resolution);
    const canvasHeight = Math.ceil(height * resolution);

    // Create canvas and render SVG at scaled size
    const canvas = DOMAdapter.get().createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      throw new Error("Failed to get canvas context");
    }

    // Improve rendering quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Draw image with exact scaled dimensions
    ctx.drawImage(
      image as CanvasImageSource,
      0,
      0,
      width * resolution,
      height * resolution
    );

    // Create texture source with proper settings
    const source = new ImageSource({
      resource: canvas,
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
 * Register the SVG stroke loader with PixiJS
 * Call this before loading any SVG assets
 */
export function registerSvgStrokeLoader(): void {
  extensions.add(svgStrokeLoader);
}
