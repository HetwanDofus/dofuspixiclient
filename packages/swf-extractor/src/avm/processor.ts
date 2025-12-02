import { SwfReader } from '../parser/swf-reader.ts';
import { ActionCode, PushType } from '../parser/structure/action/opcodes.ts';
import { AvmState, type AvmValue, type AvmObject, type AvmArray } from './state.ts';
import { Errors } from '../error/errors.ts';

/**
 * ActionScript 1.0/2.0 bytecode processor.
 */
export class AvmProcessor {
  private readonly state: AvmState;
  private readonly maxIterations: number;

  constructor(state?: AvmState, maxIterations: number = 100000) {
    this.state = state ?? new AvmState();
    this.maxIterations = maxIterations;
  }

  /**
   * Get the execution state.
   */
  getState(): AvmState {
    return this.state;
  }

  /**
   * Execute ActionScript bytecode.
   */
  execute(bytecode: Uint8Array): void {
    const reader = new SwfReader(bytecode, undefined, Errors.ALL & ~Errors.OUT_OF_BOUNDS);
    let iterations = 0;

    while (reader.hasRemaining() && iterations < this.maxIterations) {
      const opcode = reader.readUI8();
      if (opcode === ActionCode.End) break;

      // Check if action has length
      let length = 0;
      if (opcode >= 0x80) {
        length = reader.readUI16();
      }

      const actionEnd = reader.offset + length;

      try {
        this.executeOpcode(opcode, reader, length);
      } catch (e) {
        // Ignore errors and continue
      }

      // Ensure we're at the right position for next action
      if (length > 0) {
        reader.offset = actionEnd;
      }

      iterations++;
    }
  }

  private executeOpcode(opcode: number, reader: SwfReader, length: number): void {
    switch (opcode) {
      case ActionCode.ConstantPool:
        this.execConstantPool(reader);
        break;

      case ActionCode.Push:
        this.execPush(reader, reader.offset + length);
        break;

      case ActionCode.Pop:
        this.state.pop();
        break;

      case ActionCode.GetVariable:
        this.execGetVariable();
        break;

      case ActionCode.SetVariable:
        this.execSetVariable();
        break;

      case ActionCode.GetMember:
        this.execGetMember();
        break;

      case ActionCode.SetMember:
        this.execSetMember();
        break;

      case ActionCode.InitArray:
        this.execInitArray();
        break;

      case ActionCode.InitObject:
        this.execInitObject();
        break;

      case ActionCode.NewObject:
        this.execNewObject();
        break;

      case ActionCode.CallFunction:
        this.execCallFunction();
        break;

      case ActionCode.CallMethod:
        this.execCallMethod();
        break;

      case ActionCode.ToString:
        this.execToString();
        break;

      case ActionCode.ToNumber:
        this.execToNumber();
        break;

      case ActionCode.Add:
      case ActionCode.Add2:
        this.execAdd();
        break;

      case ActionCode.Subtract:
        this.execSubtract();
        break;

      case ActionCode.Multiply:
        this.execMultiply();
        break;

      case ActionCode.Divide:
        this.execDivide();
        break;

      case ActionCode.PushDuplicate:
        this.state.push(this.state.peek());
        break;

      case ActionCode.StoreRegister:
        this.execStoreRegister(reader);
        break;

      case ActionCode.DefineLocal:
        this.execDefineLocal();
        break;

      // Skip control flow for now - just extract variables
      case ActionCode.Jump:
      case ActionCode.If:
      case ActionCode.GotoFrame:
      case ActionCode.GotoFrame2:
      case ActionCode.GoToLabel:
        break;

      default:
        // Unknown opcode - skip
        break;
    }
  }

  private execConstantPool(reader: SwfReader): void {
    const count = reader.readUI16();
    this.state.constants = [];
    for (let i = 0; i < count; i++) {
      this.state.constants.push(reader.readNullTerminatedString());
    }
  }

  private execPush(reader: SwfReader, end: number): void {
    while (reader.offset < end) {
      const type = reader.readUI8();

      switch (type) {
        case PushType.String:
          this.state.push(reader.readNullTerminatedString());
          break;
        case PushType.Float:
          this.state.push(reader.readFloat());
          break;
        case PushType.Null:
          this.state.push(null);
          break;
        case PushType.Undefined:
          this.state.push(undefined);
          break;
        case PushType.Register:
          const reg = reader.readUI8();
          this.state.push(this.state.registers[reg]);
          break;
        case PushType.Boolean:
          this.state.push(reader.readUI8() !== 0);
          break;
        case PushType.Double:
          // SWF doubles are stored with swapped 32-bit halves (low, high)
          this.state.push(reader.readDoubleSwapped());
          break;
        case PushType.Integer:
          this.state.push(reader.readSI32());
          break;
        case PushType.Constant8:
          const idx8 = reader.readUI8();
          this.state.push(this.state.constants[idx8] ?? '');
          break;
        case PushType.Constant16:
          const idx16 = reader.readUI16();
          this.state.push(this.state.constants[idx16] ?? '');
          break;
      }
    }
  }

  private execGetVariable(): void {
    const name = String(this.state.pop() ?? '');
    this.state.push(this.state.getVariable(name));
  }

  private execSetVariable(): void {
    const value = this.state.pop();
    const name = String(this.state.pop() ?? '');
    this.state.setVariable(name, value);
  }

  private execGetMember(): void {
    const name = String(this.state.pop() ?? '');
    const obj = this.state.pop();

    if (obj === null || obj === undefined) {
      this.state.push(undefined);
      return;
    }

    // Handle arrays - they have a 'length' property and numeric indices
    if (Array.isArray(obj)) {
      if (name === 'length') {
        this.state.push(obj.length);
      } else {
        const index = parseInt(name, 10);
        if (!isNaN(index)) {
          this.state.push(obj[index]);
        } else {
          // Try to access as property (arrays can have custom properties)
          this.state.push((obj as unknown as Record<string, AvmValue>)[name]);
        }
      }
      return;
    }

    // Handle objects
    if (typeof obj === 'object') {
      this.state.push((obj as AvmObject)[name]);
      return;
    }

    // Handle strings
    if (typeof obj === 'string') {
      if (name === 'length') {
        this.state.push(obj.length);
      } else {
        const index = parseInt(name, 10);
        if (!isNaN(index)) {
          this.state.push(obj[index]);
        } else {
          this.state.push(undefined);
        }
      }
      return;
    }

    this.state.push(undefined);
  }

  private execSetMember(): void {
    const value = this.state.pop();
    const name = String(this.state.pop() ?? '');
    const obj = this.state.pop() as AvmObject | undefined;
    if (obj) {
      obj[name] = value;
    }
  }

  private execInitArray(): void {
    const count = Number(this.state.pop() ?? 0);
    const arr: AvmArray = [];
    for (let i = 0; i < count; i++) {
      arr.unshift(this.state.pop());
    }
    this.state.push(arr);
  }

  private execInitObject(): void {
    const count = Number(this.state.pop() ?? 0);
    const obj: AvmObject = {};
    for (let i = 0; i < count; i++) {
      const value = this.state.pop();
      const name = String(this.state.pop() ?? '');
      obj[name] = value;
    }
    this.state.push(obj);
  }

  private execNewObject(): void {
    const className = String(this.state.pop() ?? '');
    const numArgs = Number(this.state.pop() ?? 0);
    const args: AvmValue[] = [];
    for (let i = 0; i < numArgs; i++) {
      args.unshift(this.state.pop());
    }

    switch (className) {
      case 'Array': {
        // Array(n) creates an array with n elements, Array(a, b, c) creates [a, b, c]
        if (args.length === 1 && typeof args[0] === 'number') {
          const arr: AvmArray = new Array(args[0]).fill(null);
          this.state.push(arr);
        } else {
          this.state.push(args);
        }
        break;
      }
      case 'Object':
        this.state.push({});
        break;
      default:
        // Unknown class - return empty object
        this.state.push({});
        break;
    }
  }

  private execCallFunction(): void {
    const name = String(this.state.pop() ?? '');
    const numArgs = Number(this.state.pop() ?? 0);
    const args: AvmValue[] = [];
    for (let i = 0; i < numArgs; i++) {
      args.push(this.state.pop());
    }

    const fn = this.state.functions.get(name);
    if (fn) {
      this.state.push(fn(...args));
    } else {
      this.state.push(undefined);
    }
  }

  private execCallMethod(): void {
    // Pop the method name and object (we don't use them in the stub)
    this.state.pop(); // method name
    this.state.pop(); // object
    const numArgs = Number(this.state.pop() ?? 0);
    for (let i = 0; i < numArgs; i++) {
      this.state.pop();
    }
    // Stub - return undefined
    this.state.push(undefined);
  }

  private execToString(): void {
    this.state.push(String(this.state.pop() ?? ''));
  }

  private execToNumber(): void {
    this.state.push(Number(this.state.pop()));
  }

  private execAdd(): void {
    const b = this.state.pop();
    const a = this.state.pop();
    if (typeof a === 'string' || typeof b === 'string') {
      this.state.push(String(a ?? '') + String(b ?? ''));
    } else {
      this.state.push(Number(a) + Number(b));
    }
  }

  private execSubtract(): void {
    const b = Number(this.state.pop());
    const a = Number(this.state.pop());
    this.state.push(a - b);
  }

  private execMultiply(): void {
    const b = Number(this.state.pop());
    const a = Number(this.state.pop());
    this.state.push(a * b);
  }

  private execDivide(): void {
    const b = Number(this.state.pop());
    const a = Number(this.state.pop());
    this.state.push(a / b);
  }

  private execStoreRegister(reader: SwfReader): void {
    const reg = reader.readUI8();
    this.state.registers[reg] = this.state.peek();
  }

  private execDefineLocal(): void {
    const value = this.state.pop();
    const name = String(this.state.pop() ?? '');
    this.state.setVariable(name, value);
  }
}

