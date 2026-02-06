import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Image export result for a single image
 */
export interface ExportedImage {
  hash: string;
  filename: string;
  format: string;
  size: number;
}

/**
 * Global image registry for cross-animation deduplication
 */
export interface ImageRegistry {
  images: Map<string, ExportedImage>;
  outputDir: string;
  /** Web URL base path for loading images (e.g., "/assets/images"). If set, used instead of relative paths */
  webBasePath?: string;
}

/**
 * Create a new image registry
 * @param outputDir - Filesystem directory for writing images
 * @param webBasePath - Optional web URL base path for loading images (e.g., "/assets/images")
 */
export function createImageRegistry(outputDir: string, webBasePath?: string): ImageRegistry {
  fs.mkdirSync(outputDir, { recursive: true });
  return {
    images: new Map(),
    outputDir,
    webBasePath,
  };
}

/**
 * Load existing registry from disk if it exists
 * @param outputDir - Filesystem directory for writing images
 * @param webBasePath - Optional web URL base path for loading images (e.g., "/assets/images")
 */
export function loadImageRegistry(outputDir: string, webBasePath?: string): ImageRegistry {
  const registry = createImageRegistry(outputDir, webBasePath);
  const registryPath = path.join(outputDir, "registry.json");

  if (fs.existsSync(registryPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(registryPath, "utf-8"));

      if (data.images && Array.isArray(data.images)) {
        for (const img of data.images) {
          registry.images.set(img.hash, img);
        }
      }
    } catch {
      // Ignore parse errors, start fresh
    }
  }

  return registry;
}

/**
 * Save registry to disk
 */
export function saveImageRegistry(registry: ImageRegistry): void {
  const registryPath = path.join(registry.outputDir, "registry.json");
  const data = {
    version: 1,
    generatedAt: new Date().toISOString(),
    imageCount: registry.images.size,
    images: Array.from(registry.images.values()),
  };
  fs.writeFileSync(registryPath, JSON.stringify(data, null, 2));
}

/**
 * Parse a base64 data URI and extract format and raw data
 * Uses string operations instead of regex to handle very large base64 strings safely
 */
export function parseBase64DataUri(dataUri: string): {
  format: string;
  mimeType: string;
  data: Buffer;
} | null {
  // Check prefix
  const prefix = "data:image/";
  if (!dataUri.startsWith(prefix)) {
    return null;
  }

  // Find the semicolon that ends the MIME type
  const semicolonIndex = dataUri.indexOf(";", prefix.length);
  if (semicolonIndex === -1) {
    return null;
  }

  // Extract format (e.g., "png", "jpeg")
  const format = dataUri.slice(prefix.length, semicolonIndex);

  // Check for base64 marker
  const base64Marker = ";base64,";
  const markerIndex = dataUri.indexOf(base64Marker, semicolonIndex);
  if (markerIndex !== semicolonIndex) {
    return null;
  }

  // Extract base64 data (everything after the marker)
  const base64Data = dataUri.slice(markerIndex + base64Marker.length);

  const mimeType = `image/${format}`;
  const data = Buffer.from(base64Data, "base64");

  return { format, mimeType, data };
}

/**
 * Compute content hash for image data
 */
export function computeImageHash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex").substring(0, 16);
}

/**
 * Export a base64 image to the registry if not already present
 * Returns the exported image info with the hash for deduplication
 */
export function exportImage(
  registry: ImageRegistry,
  base64DataUri: string
): ExportedImage | null {
  const parsed = parseBase64DataUri(base64DataUri);
  if (!parsed) {
    return null;
  }

  const hash = computeImageHash(parsed.data);

  // Check if already exported
  const existing = registry.images.get(hash);
  if (existing) {
    return existing;
  }

  // Determine file extension
  const ext = getExtensionForFormat(parsed.format);
  const filename = `${hash}.${ext}`;
  const filepath = path.join(registry.outputDir, filename);

  // Write image file
  fs.writeFileSync(filepath, parsed.data);

  const exported: ExportedImage = {
    hash,
    filename,
    format: parsed.format,
    size: parsed.data.length,
  };

  registry.images.set(hash, exported);
  return exported;
}

/**
 * Get file extension for image format
 */
function getExtensionForFormat(format: string): string {
  switch (format.toLowerCase()) {
    case "jpeg":
      return "jpg";
    case "svg+xml":
      return "svg";
    default:
      return format.toLowerCase();
  }
}

/**
 * Generate a relative path from SVG to image
 */
export function getRelativeImagePath(
  svgDir: string,
  imageRegistry: ImageRegistry,
  hash: string
): string {
  const image = imageRegistry.images.get(hash);
  if (!image) {
    return "";
  }

  // Calculate relative path from SVG directory to images directory
  const relativePath = path.relative(svgDir, imageRegistry.outputDir);
  return path.join(relativePath, image.filename).replace(/\\/g, "/");
}

/**
 * Replace base64 data URI in content with file reference
 * Uses string split/join instead of regex to handle very large base64 strings safely
 */
export function replaceBase64WithFileRef(
  content: string,
  base64DataUri: string,
  fileRef: string
): string {
  // Use split/join for safe replacement without regex
  return content.split(base64DataUri).join(fileRef);
}
