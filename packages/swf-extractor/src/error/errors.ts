/**
 * Error flags for configuring error handling behavior.
 * These flags can be combined using bitwise OR.
 */
export const Errors = {
  /** Throw error when reading beyond buffer bounds */
  OUT_OF_BOUNDS: 1 << 0,
  /** Throw error on invalid/malformed data */
  INVALID_DATA: 1 << 1,
  /** Throw error when extra data is found after expected end */
  EXTRA_DATA: 1 << 2,
  /** Throw error on invalid/unknown tags */
  INVALID_TAG: 1 << 3,
  /** Throw error on unprocessable data */
  UNPROCESSABLE_DATA: 1 << 4,
  /** Enable all errors */
  ALL: 0b11111,
  /** Ignore invalid tags but throw on other errors */
  IGNORE_INVALID_TAG: 0b11111 & ~(1 << 3),
} as const;

export type ErrorFlags = number;

/**
 * Base interface for all SWF parser exceptions
 */
export interface SwfExceptionInterface extends Error {
  readonly offset?: number;
}

/**
 * Exception thrown when parser reads beyond available data
 */
export class ParserOutOfBoundException extends Error implements SwfExceptionInterface {
  constructor(
    message: string,
    public readonly offset: number,
  ) {
    super(message);
    this.name = 'ParserOutOfBoundException';
  }

  static createReadAfterEnd(offset: number, end: number): ParserOutOfBoundException {
    return new ParserOutOfBoundException(
      `Cannot read at offset ${offset}: end of data reached at ${end}`,
      offset,
    );
  }

  static createReadTooManyBytes(offset: number, end: number, requested: number): ParserOutOfBoundException {
    return new ParserOutOfBoundException(
      `Cannot read ${requested} bytes at offset ${offset}: only ${end - offset} bytes available`,
      offset,
    );
  }
}

/**
 * Exception thrown when encountering invalid data
 */
export class ParserInvalidDataException extends Error implements SwfExceptionInterface {
  constructor(
    message: string,
    public readonly offset?: number,
  ) {
    super(message);
    this.name = 'ParserInvalidDataException';
  }

  static createInvalidCompressedData(offset: number): ParserInvalidDataException {
    return new ParserInvalidDataException('Invalid or corrupted compressed data', offset);
  }
}

/**
 * Exception thrown when extra data is found
 */
export class ParserExtraDataException extends Error implements SwfExceptionInterface {
  constructor(
    message: string,
    public readonly offset: number,
    public readonly extraLength: number,
  ) {
    super(message);
    this.name = 'ParserExtraDataException';
  }
}

/**
 * Exception thrown for unknown tags
 */
export class UnknownTagException extends Error implements SwfExceptionInterface {
  constructor(
    message: string,
    public readonly tagType: number,
    public readonly offset?: number,
  ) {
    super(message);
    this.name = 'UnknownTagException';
  }
}

