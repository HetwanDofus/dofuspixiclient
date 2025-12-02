import { Swf } from "@/parser/swf.ts";
import { createShapeDefinition } from "@/extractor/shape/shape-definition.ts";
import { TagType } from "@/parser/structure/tag-types.ts";
import { readDefineShape1, readDefineShape2, readDefineShape3, readDefineShape4 } from "@/parser/structure/tag/define-shape.ts";
import { readFileSync } from "fs";

const data = readFileSync("/Users/grandnainconnu/Work/personal/dofus/dofus1.29/dofuswebclient2/assets/sources/clips/gfx/o1.swf");
const swf = Swf.fromBuffer(data);

// Find shape 245
console.log("Total tags:", swf.tags.length);
let found = false;
for (const tag of swf.tags) {
  if (tag.id === 245) {
    console.log("Found tag with id 245, type:", tag.type);
    found = true;
    if (tag.type === TagType.DefineShape || tag.type === TagType.DefineShape2 || tag.type === TagType.DefineShape3 || tag.type === TagType.DefineShape4) {
      const reader = swf.getTagReader(tag);
      const defineShape = tag.type === TagType.DefineShape ? readDefineShape1(reader) :
                          tag.type === TagType.DefineShape2 ? readDefineShape2(reader) :
                          tag.type === TagType.DefineShape3 ? readDefineShape3(reader) :
                          readDefineShape4(reader);
      const shape = createShapeDefinition(defineShape);
      console.log("Total paths:", shape.paths.length);

      // Count paths with lineStyle
      let linePathCount = 0;
      let lineWithAlpha0 = 0;
      for (const path of shape.paths) {
        if (path.lineStyle) {
          linePathCount++;
          if ("color" in path.lineStyle && path.lineStyle.color && path.lineStyle.color.a === 0) {
            lineWithAlpha0++;
            console.log("Found line with alpha=0:", path.lineStyle);
          }
        }
      }
      console.log("Paths with lineStyle:", linePathCount);
      console.log("Paths with lineStyle alpha=0:", lineWithAlpha0);
    }
    break;
  }
}
if (!found) {
  console.log("Tag 245 not found");
}
