import type { SwfReader } from '@/parser/swf-reader.ts';

/**
 * Exported asset entry.
 */
export interface ExportedAsset {
  readonly id: number;
  readonly name: string;
}

/**
 * ExportAssets tag.
 */
export interface ExportAssets {
  readonly assets: readonly ExportedAsset[];
}

/**
 * Read ExportAssets tag.
 */
export function readExportAssets(reader: SwfReader): ExportAssets {
  const count = reader.readUI16();
  const assets: ExportedAsset[] = [];

  for (let i = 0; i < count; i++) {
    const id = reader.readUI16();
    const name = reader.readNullTerminatedString();
    assets.push({ id, name });
  }

  return { assets };
}

