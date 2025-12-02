/**
 * ActionScript value types.
 */
export type AvmValue = string | number | boolean | null | undefined | AvmObject | AvmArray | AvmFunction;

/**
 * ActionScript object.
 */
export interface AvmObject {
  [key: string]: AvmValue;
}

/**
 * ActionScript array.
 */
export type AvmArray = AvmValue[];

/**
 * ActionScript function (stub).
 */
export interface AvmFunction {
  readonly __isFunction: true;
  readonly name?: string;
}

/**
 * AVM execution state.
 */
export class AvmState {
  /** Constant pool */
  public constants: string[] = [];

  /** Execution stack */
  public stack: AvmValue[] = [];

  /** Variables */
  public variables: Map<string, AvmValue> = new Map();

  /** Registers (r0-r255) */
  public registers: AvmValue[] = new Array(256).fill(undefined);

  /** Built-in functions */
  public functions: Map<string, (...args: AvmValue[]) => AvmValue> = new Map();

  constructor() {
    this.setupBuiltins();
  }

  private setupBuiltins(): void {
    // Math functions
    this.functions.set('parseInt', (str) => {
      const n = parseInt(String(str), 10);
      return isNaN(n) ? undefined : n;
    });

    this.functions.set('parseFloat', (str) => {
      const n = parseFloat(String(str));
      return isNaN(n) ? undefined : n;
    });

    this.functions.set('isNaN', (val) => {
      return typeof val === 'number' && isNaN(val);
    });

    // Type conversion functions
    this.functions.set('String', (val) => String(val ?? ''));
    this.functions.set('Number', (val) => Number(val));
    this.functions.set('Boolean', (val) => Boolean(val));
  }

  /**
   * Push a value onto the stack.
   */
  push(value: AvmValue): void {
    this.stack.push(value);
  }

  /**
   * Pop a value from the stack.
   */
  pop(): AvmValue {
    return this.stack.pop();
  }

  /**
   * Peek at the top of the stack.
   */
  peek(): AvmValue {
    return this.stack[this.stack.length - 1];
  }

  /**
   * Get a variable value.
   */
  getVariable(name: string): AvmValue {
    return this.variables.get(name);
  }

  /**
   * Set a variable value.
   */
  setVariable(name: string, value: AvmValue): void {
    this.variables.set(name, value);
  }

  /**
   * Get all variables as a plain object.
   */
  getVariablesObject(): Record<string, AvmValue> {
    const result: Record<string, AvmValue> = {};
    for (const [key, value] of this.variables) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Clone the state.
   */
  clone(): AvmState {
    const newState = new AvmState();
    newState.constants = [...this.constants];
    newState.stack = [...this.stack];
    newState.variables = new Map(this.variables);
    newState.registers = [...this.registers];
    return newState;
  }
}

