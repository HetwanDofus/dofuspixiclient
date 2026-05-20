// Af — New queue info (Account.as:1237 in / 162 out, DataProcessor.as:247)

import { F, WireIn, WireOut } from "../../wire";

@WireIn({ opcode: "Af", bodyOffset: 2 })
export class Af {
  @F.int(0) position: number;
  @F.int(1) totalSubscriber: number;
  @F.int(2) totalNonSubscriber: number;
  @F.bool(3) isSubscriber: boolean;
  @F.int(4) queueId: number;
}

/** Outbound `Af` — `getQueuePosition` request. Empty body. */
@WireOut({ opcode: "Af" })
export class AfOut {}
