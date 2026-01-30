import { parseSvgFiles } from './src/lib/parser.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';

const inputDir = '/Users/grandnainconnu/Work/personal/dofus/dofus1.29/dofus-client-recode/dofuswebclient3-vello-shared-test/assets/rasters/sprites/svg/10';

const svgFiles = fs.readdirSync(inputDir)
  .filter(f => f.endsWith('.svg'))
  .map(f => path.join(inputDir, f));

async function check() {
  const frames = await parseSvgFiles(svgFiles);

  const idToHashes = new Map<string, Set<string>>();

  for (const frame of frames) {
    for (const def of frame.definitions) {
      if (!idToHashes.has(def.originalId)) {
        idToHashes.set(def.originalId, new Set());
      }
      idToHashes.get(def.originalId)!.add(def.contentHash);
    }
  }

  console.log('Original IDs with multiple different contents:');
  let count = 0;
  const sorted = Array.from(idToHashes.entries()).sort((a,b) => b[1].size - a[1].size);
  for (const [id, hashes] of sorted) {
    if (hashes.size > 1) {
      console.log(`  ${id}: ${hashes.size} different versions`);
      count++;
      if (count >= 30) break;
    }
  }
  console.log(`Total IDs with multiple versions: ${count}`);
}

check();
