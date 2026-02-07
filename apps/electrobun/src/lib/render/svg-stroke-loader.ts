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
    // Handle SVG files from spritesheets and banner icons
    return (url.includes("/spritesheets/") || url.includes("/hud/banner/")) && url.endsWith(".svg");
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

    // Create Blob URL and decode via Image (Chromium can't createImageBitmap from SVG blobs)
    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    const blobUrl = URL.createObjectURL(blob);
    const image = DOMAdapter.get().createImage();
    image.src = blobUrl;

    try {
      await image.decode();
    } finally {
      URL.revokeObjectURL(blobUrl);
    }

    // Extract dimensions from SVG attributes, falling back to decoded image size
    const widthMatch = svgContent.match(/\bwidth="(\d+(?:\.\d+)?)"/);
    const heightMatch = svgContent.match(/\bheight="(\d+(?:\.\d+)?)"/);
    const width = widthMatch ? parseFloat(widthMatch[1]) : image.width;
    const height = heightMatch ? parseFloat(heightMatch[1]) : image.height;

    // Ensure output dimensions are integers to prevent edge trimming
    const outputWidth = Math.ceil(width * resolution);
    const outputHeight = Math.ceil(height * resolution);

    // Use createImageBitmap for rasterization at target size (avoids canvas intermediate)
    const bitmap = await createImageBitmap(image as ImageBitmapSource, {
      resizeWidth: outputWidth,
      resizeHeight: outputHeight,
      resizeQuality: "low",
    });

    // Create texture source directly from ImageBitmap
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
 * Register the SVG stroke loader with PixiJS
 * Call this before loading any SVG assets
 */
export function registerSvgStrokeLoader(): void {
  extensions.add(svgStrokeLoader);
}
