// GDA — Adjacent Maps Data (AraknemuHorizon custom packet).
// Wire: <currentSeg>|<leftSeg>|<rightSeg>|<bottomSeg>
//
// Each segment is three semicolon-delimited fields:
//   <mapId>;<dateTime>;<decryptKey>
// A missing neighbour arrives as `;;` (three empty fields).
//
// Replaces GDM: the current map descriptor is the first segment, so
// the client only needs one inbound to load both the active map and
// the three adjacent maps used by the side-band preview.

import { F, WireIn } from "../../wire";

export interface NeighborSegment {
  mapId: string;
  dateTime: string;
  decryptKey: string;
}

export interface GDASegments {
  current: NeighborSegment;
  left: NeighborSegment | null;
  right: NeighborSegment | null;
  bottom: NeighborSegment | null;
}

function parseSegment(raw: string): NeighborSegment | null {
  const [mapId = "", dateTime = "", decryptKey = ""] = raw.split(";");
  if (mapId === "" && dateTime === "" && decryptKey === "") return null;
  return { mapId, dateTime, decryptKey };
}

@WireIn({ opcode: "GDA", bodyOffset: 4 })
export class GDA {
  @F.str(0) currentRaw: string;
  @F.str(1) leftRaw: string;
  @F.str(2) rightRaw: string;
  @F.str(3) bottomRaw: string;

  /**
   * Parsed view of the four segments. Throws if `current` is empty —
   * the active map must always be present on a GDA frame.
   */
  segments(): GDASegments {
    const current = parseSegment(this.currentRaw);
    if (!current) {
      throw new Error("GDA: current map segment is empty");
    }
    return {
      current,
      left: parseSegment(this.leftRaw),
      right: parseSegment(this.rightRaw),
      bottom: parseSegment(this.bottomRaw),
    };
  }
}
