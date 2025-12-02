/**
 * ActionScript 2 bytecode opcodes.
 * Only includes opcodes needed for behavior analysis.
 */
export enum Opcode {
  // SWF 3
  ActionGotoFrame = 0x81,
  ActionGetURL = 0x83,
  ActionNextFrame = 0x04,
  ActionPreviousFrame = 0x05,
  ActionPlay = 0x06,
  ActionStop = 0x07,
  ActionToggleQuality = 0x08,
  ActionStopSounds = 0x09,
  ActionWaitForFrame = 0x8a,
  ActionSetTarget = 0x8b,
  ActionGoToLabel = 0x8c,

  // SWF 4
  ActionPush = 0x96,
  ActionPop = 0x17,
  ActionAdd = 0x0a,
  ActionSubtract = 0x0b,
  ActionMultiply = 0x0c,
  ActionDivide = 0x0d,
  ActionEquals = 0x0e,
  ActionLess = 0x0f,
  ActionAnd = 0x10,
  ActionOr = 0x11,
  ActionNot = 0x12,
  ActionStringEquals = 0x13,
  ActionStringLength = 0x14,
  ActionStringAdd = 0x21,
  ActionStringExtract = 0x15,
  ActionStringLess = 0x29,
  ActionMBStringLength = 0x31,
  ActionMBStringExtract = 0x35,
  ActionToInteger = 0x18,
  ActionCharToAscii = 0x32,
  ActionAsciiToChar = 0x33,
  ActionMBCharToAscii = 0x36,
  ActionMBAsciiToChar = 0x37,
  ActionJump = 0x99,
  ActionIf = 0x9d,
  ActionCall = 0x9e,
  ActionGetVariable = 0x1c,
  ActionSetVariable = 0x1d,
  ActionGetURL2 = 0x9a,
  ActionGotoFrame2 = 0x9f,
  ActionSetTarget2 = 0x20,
  ActionGetProperty = 0x22,
  ActionSetProperty = 0x23,
  ActionCloneSprite = 0x24,
  ActionRemoteSprite = 0x25,
  ActionStartDrag = 0x27,
  ActionEndDrag = 0x28,
  ActionWaitForFrame2 = 0x8d,
  ActionTrace = 0x26,
  ActionGetTime = 0x34,
  ActionRandomNumber = 0x30,
}

/**
 * Check if an opcode has a length field (opcodes >= 0x80).
 */
export function hasLength(opcode: number): boolean {
  return opcode >= 0x80;
}

/**
 * Check if an action bytecode contains a specific opcode.
 */
export function containsOpcode(actions: Uint8Array, targetOpcode: Opcode): boolean {
  let offset = 0;
  while (offset < actions.length) {
    const opcode = actions[offset]!;
    if (opcode === 0) break; // End of actions

    if (opcode === targetOpcode) {
      return true;
    }

    offset++;
    if (hasLength(opcode)) {
      if (offset + 2 > actions.length) break;
      const length = actions[offset]! | (actions[offset + 1]! << 8);
      offset += 2 + length;
    }
  }
  return false;
}

