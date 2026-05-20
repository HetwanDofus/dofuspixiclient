// HS — Character Switch Ticket (Aks.as:752)

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "HS", bodyOffset: 2 })
export class HS {
  @F.str(0) ticket: string;
}
