// WU — Waypoint use error (Waypoints.as:42, DataProcessor.as:992).
// Server rejected a teleport attempt; no body.

import { WireIn } from "../../wire";

@WireIn({ opcode: "WU", bodyOffset: 2 })
export class WU {}
