// OR — Item Remove (Items.as#onRemove, DataProcessor.as:569)

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "OR", bodyOffset: 2 })
export class OR {
  @F.str(0) itemId: string;
}
