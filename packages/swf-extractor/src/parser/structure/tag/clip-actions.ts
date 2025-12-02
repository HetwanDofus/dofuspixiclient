import type { SwfReader } from '@/parser/swf-reader.ts';

/**
 * Clip action event flags.
 */
export interface ClipEventFlags {
  readonly keyUp: boolean;
  readonly keyDown: boolean;
  readonly mouseUp: boolean;
  readonly mouseDown: boolean;
  readonly mouseMove: boolean;
  readonly unload: boolean;
  readonly enterFrame: boolean;
  readonly load: boolean;
  readonly dragOver: boolean;
  readonly rollOut: boolean;
  readonly rollOver: boolean;
  readonly releaseOutside: boolean;
  readonly release: boolean;
  readonly press: boolean;
  readonly initialize: boolean;
  readonly data: boolean;
  readonly construct: boolean;
  readonly keyPress: boolean;
  readonly dragOut: boolean;
}

/**
 * Single clip action.
 */
export interface ClipAction {
  readonly eventFlags: ClipEventFlags;
  readonly keyCode?: number;
  readonly actions: Uint8Array;
}

/**
 * Clip actions container.
 */
export interface ClipActions {
  readonly allEventFlags: ClipEventFlags;
  readonly records: readonly ClipAction[];
}

/**
 * Read clip event flags.
 */
function readClipEventFlags(reader: SwfReader, swfVersion: number): ClipEventFlags {
  const keyUp = reader.readBool();
  const keyDown = reader.readBool();
  const mouseUp = reader.readBool();
  const mouseDown = reader.readBool();
  const mouseMove = reader.readBool();
  const unload = reader.readBool();
  const enterFrame = reader.readBool();
  const load = reader.readBool();
  const dragOver = swfVersion >= 6 ? reader.readBool() : false;
  const rollOut = swfVersion >= 6 ? reader.readBool() : false;
  const rollOver = swfVersion >= 6 ? reader.readBool() : false;
  const releaseOutside = swfVersion >= 6 ? reader.readBool() : false;
  const release = swfVersion >= 6 ? reader.readBool() : false;
  const press = swfVersion >= 6 ? reader.readBool() : false;
  const initialize = swfVersion >= 6 ? reader.readBool() : false;
  const data = swfVersion >= 6 ? reader.readBool() : false;

  let construct = false;
  let keyPress = false;
  let dragOut = false;

  if (swfVersion >= 6) {
    reader.readUB(5); // Reserved
    construct = reader.readBool();
    keyPress = reader.readBool();
    dragOut = reader.readBool();
    reader.readUB(8); // Reserved
  }

  return {
    keyUp,
    keyDown,
    mouseUp,
    mouseDown,
    mouseMove,
    unload,
    enterFrame,
    load,
    dragOver,
    rollOut,
    rollOver,
    releaseOutside,
    release,
    press,
    initialize,
    data,
    construct,
    keyPress,
    dragOut,
  };
}

/**
 * Check if all event flags are zero.
 */
function isEmptyFlags(flags: ClipEventFlags): boolean {
  return Object.values(flags).every((v) => !v);
}

/**
 * Read clip actions.
 */
export function readClipActions(reader: SwfReader, swfVersion: number): ClipActions {
  reader.readUI16(); // Reserved

  const allEventFlags = readClipEventFlags(reader, swfVersion);
  const records: ClipAction[] = [];

  while (reader.hasRemaining()) {
    const eventFlags = readClipEventFlags(reader, swfVersion);
    if (isEmptyFlags(eventFlags)) break;

    const actionRecordSize = reader.readUI32();
    let keyCode: number | undefined;

    if (eventFlags.keyPress) {
      keyCode = reader.readUI8();
    }

    const actionsSize = eventFlags.keyPress ? actionRecordSize - 1 : actionRecordSize;
    const actions = reader.readBytes(actionsSize);

    records.push({ eventFlags, keyCode, actions });
  }

  return { allEventFlags, records };
}

