import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export interface FrameInfo {
  filename: string;
  hash: string;
  isDuplicate: boolean;
  duplicateOf?: string;
  size: number;
}

export interface DeduplicationResult {
  totalFrames: number;
  uniqueFrames: number;
  duplicateFrames: number;
  frames: Map<string, FrameInfo>;
  duplicateMap: Map<string, string>; // filename -> original filename
}

/**
 * Utility to deduplicate frames by comparing their content hashes
 */
export class FrameDeduplicator {
  /**
   * Calculate MD5 hash of a file
   */
  static hashFile(filePath: string): string {
    const content = fs.readFileSync(filePath);

    return createHash('md5').update(content).digest('hex');
  }

  /**
   * Deduplicate frames in a directory
   * @param framesDir Directory containing frame files
   * @returns Deduplication result with mapping of duplicates
   */
  static deduplicateFrames(framesDir: string): DeduplicationResult {
    const frames = new Map<string, FrameInfo>();
    const hashToOriginal = new Map<string, string>();
    const duplicateMap = new Map<string, string>();

    if (!fs.existsSync(framesDir)) {
      return {
        totalFrames: 0,
        uniqueFrames: 0,
        duplicateFrames: 0,
        frames,
        duplicateMap,
      };
    }

    const files = fs.readdirSync(framesDir)
      .filter(file => !fs.statSync(path.join(framesDir, file)).isDirectory())
      .sort();

    for (const filename of files) {
      const filePath = path.join(framesDir, filename);
      const stats = fs.statSync(filePath);
      const hash = this.hashFile(filePath);

      if (hashToOriginal.has(hash)) {
        const originalFile = hashToOriginal.get(hash)!;

        frames.set(filename, {
          filename,
          hash,
          isDuplicate: true,
          duplicateOf: originalFile,
          size: stats.size,
        });

        duplicateMap.set(filename, originalFile);

        continue;
      }

      frames.set(filename, {
        filename,
        hash,
        isDuplicate: false,
        size: stats.size,
      });

      hashToOriginal.set(hash, filename);
    }

    const uniqueFrames = Array.from(frames.values()).filter(f => !f.isDuplicate).length;
    const duplicateFrames = frames.size - uniqueFrames;

    return {
      totalFrames: files.length,
      uniqueFrames,
      duplicateFrames,
      frames,
      duplicateMap,
    };
  }

  /**
   * Save deduplication result to JSON
   */
  static saveDeduplicationResult(result: DeduplicationResult, outputPath: string): void {
    const data = {
      totalFrames: result.totalFrames,
      uniqueFrames: result.uniqueFrames,
      duplicateFrames: result.duplicateFrames,
      deduplicationRate: ((result.duplicateFrames / result.totalFrames) * 100).toFixed(2),
      frames: Array.from(result.frames.values()),
      duplicateMap: Object.fromEntries(result.duplicateMap),
    };

    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  }
}
