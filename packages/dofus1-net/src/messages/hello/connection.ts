// HC — Hello Connection Server (Aks.as:682)
// First frame after TCP accept. Body is the connexion hash key the
// client XORs the password against.

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "HC", bodyOffset: 2 })
export class HC {
  @F.str(0) hashKey: string;
}
