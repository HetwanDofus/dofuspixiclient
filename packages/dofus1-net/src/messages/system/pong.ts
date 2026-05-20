// p — Pong (Aks.as:761, DataProcessor.as:50)

import { WireIn } from "../../wire";

@WireIn({ opcode: "p", bodyOffset: 1 })
export class Pong {}
