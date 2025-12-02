/**
 * Supported output image formats.
 */
export const ImageFormat = {
  Svg: 'svg',
  Png: 'png',
  Jpeg: 'jpeg',
  Gif: 'gif',
  Webp: 'webp',
} as const;

export type ImageFormatValue = (typeof ImageFormat)[keyof typeof ImageFormat];

/**
 * Get the file extension for an image format.
 */
export function getExtension(format: ImageFormatValue): string {
  switch (format) {
    case ImageFormat.Svg:
      return 'svg';
    case ImageFormat.Png:
      return 'png';
    case ImageFormat.Jpeg:
      return 'jpg';
    case ImageFormat.Gif:
      return 'gif';
    case ImageFormat.Webp:
      return 'webp';
    default:
      return 'bin';
  }
}

/**
 * Get the MIME type for an image format.
 */
export function getMimeType(format: ImageFormatValue): string {
  switch (format) {
    case ImageFormat.Svg:
      return 'image/svg+xml';
    case ImageFormat.Png:
      return 'image/png';
    case ImageFormat.Jpeg:
      return 'image/jpeg';
    case ImageFormat.Gif:
      return 'image/gif';
    case ImageFormat.Webp:
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Check if format is a raster format (requires conversion from SVG).
 */
export function isRasterFormat(format: ImageFormatValue): boolean {
  return format !== ImageFormat.Svg;
}

/**
 * Parse format from string.
 */
export function parseFormat(str: string): ImageFormatValue | null {
  const lower = str.toLowerCase();
  switch (lower) {
    case 'svg':
      return ImageFormat.Svg;
    case 'png':
      return ImageFormat.Png;
    case 'jpg':
    case 'jpeg':
      return ImageFormat.Jpeg;
    case 'gif':
      return ImageFormat.Gif;
    case 'webp':
      return ImageFormat.Webp;
    default:
      return null;
  }
}

