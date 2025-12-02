import type { SwfReader } from '@/parser/swf-reader.ts';

/**
 * DoAction tag - contains ActionScript bytecode.
 */
export interface DoAction {
  readonly actions: Uint8Array;
}

/**
 * Read DoAction tag.
 */
export function readDoAction(reader: SwfReader): DoAction {
  const actions = reader.readBytesTo(reader.end);
  return { actions };
}

/**
 * DoInitAction tag - contains ActionScript for sprite initialization.
 */
export interface DoInitAction {
  readonly spriteId: number;
  readonly actions: Uint8Array;
}

/**
 * Read DoInitAction tag.
 */
export function readDoInitAction(reader: SwfReader): DoInitAction {
  const spriteId = reader.readUI16();
  const actions = reader.readBytesTo(reader.end);
  return { spriteId, actions };
}

