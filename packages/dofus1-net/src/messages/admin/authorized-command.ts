// BA — Authorized (admin) command stream.
//
// Outbound: `BA<command-text>` (aks/Basics.as:15-18 —
// `autorisedCommand(sCommand)`). The body is a raw command string;
// the server validates the caller is admin and dispatches.
//
// Inbound subops dispatch off `raw.charAt(2)` per DataProcessor.as:91-120:
//
//   BAT<extra> → text response (BasicProcessor::onAuthorizedCommand)
//   BAE       → command rejected (also routes via onAuthorizedCommand)
//   BAC       → clear console (onAuthorizedCommandClear)
//   BAP<txt>  → set prompt (onAuthorizedCommandPrompt)
//   BAL<row>  → replace single line (onAuthorizedLine)
//   BAl<list> → autocomplete list (onAuthorizedCommandsListing)
//
// We expose each subop as its own typed inbound class so consumers
// can `client.on(BAT, ...)` without raw-frame inspection.

import { WireIn, WireOut } from "../../wire";

@WireOut({
  opcode: "BA",
  serialize(m) {
    const out = m as BAOut;
    return out.command;
  },
})
export class BAOut {
  command: string;
}

// BAT — text response (`<type>|<reportMode>|<grid>|<message>`).
@WireIn({
  opcode: "BAT",
  bodyOffset: 3,
  parse(body) {
    const inst = new BAT();
    inst.body = body;
    return inst;
  },
})
export class BAT {
  body: string;
}

// BAE — server rejected the command (no payload).
@WireIn({
  opcode: "BAE",
  bodyOffset: 3,
  parse() {
    return new BAE();
  },
})
export class BAE {}

// BAC — server-requested console clear (no payload).
@WireIn({
  opcode: "BAC",
  bodyOffset: 3,
  parse() {
    return new BAC();
  },
})
export class BAC {}

// BAP — change prompt label.
@WireIn({
  opcode: "BAP",
  bodyOffset: 3,
  parse(body) {
    const inst = new BAP();
    inst.prompt = body;
    return inst;
  },
})
export class BAP {
  prompt: string;
}

// BAL — replace single log line (`<idxFromBottom>|<type>|<text>`).
@WireIn({
  opcode: "BAL",
  bodyOffset: 3,
  parse(body) {
    const inst = new BAL();
    inst.body = body;
    return inst;
  },
})
export class BAL {
  body: string;
}

// BAl — autocomplete listing (lowercase `l` — distinct opcode from
// uppercase BAL above).
@WireIn({
  opcode: "BAl",
  bodyOffset: 3,
  parse(body) {
    const inst = new BAl();
    inst.commands = body.length === 0 ? [] : body.split("|");
    return inst;
  },
})
export class BAl {
  commands: string[];
}
