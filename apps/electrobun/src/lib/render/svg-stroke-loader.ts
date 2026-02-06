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

    // Use Image element to parse SVG (resolves internal refs like <use>, <clipPath>)
    const image = DOMAdapter.get().createImage();
    image.src = blobUrl;

    try {
      await image.decode();
    } finally {
      URL.revokeObjectURL(blobUrl);
    }

    // Get dimensions
    const width = asset?.data?.width ?? image.width;
    const height = asset?.data?.height ?? image.height;

    // Ensure output dimensions are integers to prevent edge trimming
    const outputWidth = Math.ceil(width * resolution);
    const outputHeight = Math.ceil(height * resolution);

    // Use createImageBitmap for rasterization at target size (avoids canvas intermediate)
    const bitmap = await createImageBitmap(image, {
      resizeWidth: outputWidth,
      resizeHeight: outputHeight,
      resizeQuality: "medium",
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
