// k — Server Will Disconnect (Aks.as:814, DataProcessor.as:82)

import { WireIn } from "../../wire";

@WireIn({ opcode: "k", bodyOffset: 1 })
export class ServerWillDisconnect {}
