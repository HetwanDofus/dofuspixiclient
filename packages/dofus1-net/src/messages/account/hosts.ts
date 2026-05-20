// AH — Hosts (Account.as:534, DataProcessor.as:232)
// Wire: <id;status;completion;canCreate>|<…>|…

import { Composite, F, WireIn } from "../../wire";

@Composite({ separator: ";" })
export class HostStatus {
  @F.int(0) id: number;
  @F.int(1) status: number;
  @F.int(2) completion: number;
  @F.bool(3) canCreate: boolean;
}

@WireIn({ opcode: "AH", bodyOffset: 2 })
export class AH {
  @F.trailing(0, HostStatus) hosts: HostStatus[];
}
