import { SwfFile, TagType } from "./src/index.ts";
import { readDefineBitsJpeg2 } from "@/parser/structure/tag/define-bits.ts";
import { writeFile } from "node:fs/promises";

async function main() {
  const file = await SwfFile.fromFile("../../assets/sources/clips/gfx/g1.swf");
  const swf = file.parser;

  const charId = 33;
  const tag = swf.getCharacter(charId);
  if (!tag) {
    console.log("No character with id", charId);
    return;
  }

  let typeName: string | null = null;
  for (const [key, value] of Object.entries(TagType)) {
    if (value === tag.type) {
      typeName = key;
      break;
    }
  }

  console.log("Character", charId, "tag type:", tag.type, "name:", typeName);

  const reader = swf.getTagReader(tag);
  const jpeg2 = readDefineBitsJpeg2(reader);
  console.log("read id:", jpeg2.id, "imageData length:", jpeg2.imageData.length);
  console.log("first 16 bytes:", Array.from(jpeg2.imageData.slice(0, 16)));

  // Dump raw JPEG data so we can compare decoding against PHP's PNG output.
  await writeFile("../../tmp/char33-from-swf.jpg", Buffer.from(jpeg2.imageData));
  console.log("Wrote ../../tmp/char33-from-swf.jpg");
}

void main();
