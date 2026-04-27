import { Box, render, Text, useApp, useInput, useWindowSize } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { useEffect, useState } from "react";
import { match, P } from "ts-pattern";

import type { Role, SessionRegistry } from "./session-registry.ts";
import type { UpstreamRegistry } from "./upstream-registry.ts";
import { type LogEntry, logSink } from "./log-sink.ts";
import { GATEWAY_LOG_PATH, logger } from "./logger.ts";

const log = logger.child({ mod: "cli" });

const DEFAULT_SOCK: Record<Role, string> = {
  auth: "/tmp/dofus-authd-v2.sock",
  game: "/tmp/dofus-gamed-v2.sock",
};
const LOG_LINES = 10;

type Ctx = {
  upstreams: UpstreamRegistry;
  sessions: SessionRegistry;
  shutdown: () => Promise<void>;
};

type UpstreamStatus = ReturnType<UpstreamRegistry["status"]>[number];

type Status = {
  sessions: number;
  upstreams: UpstreamStatus[];
};

type Screen =
  | { name: "menu" }
  | { name: "handoff-role" }
  | { name: "handoff-input"; role: Role }
  | { name: "handoff-running" }
  | { name: "handoff-result"; ok: boolean; msg: string };

function snapshot(ctx: Ctx): Status {
  return { sessions: ctx.sessions.size(), upstreams: ctx.upstreams.status() };
}

function useStatus(ctx: Ctx, intervalMs = 1000): Status {
  const [s, set] = useState<Status>(() => snapshot(ctx));
  useEffect(() => {
    const t = setInterval(() => set(snapshot(ctx)), intervalMs);
    return () => clearInterval(t);
  }, [ctx, intervalMs]);
  return s;
}

function useRecentLogs(n: number): LogEntry[] {
  const [lines, setLines] = useState<LogEntry[]>(() => logSink.recent(n));

  useEffect(() => {
    const unsub = logSink.subscribe(() => {
      setLines(logSink.recent(n));
    });

    return unsub;
  }, [n]);

  return lines;
}

function UpstreamRow({ up }: { up: UpstreamStatus }) {
  return (
    <Box flexWrap="wrap">
      <Text color="cyan">{up.role.padEnd(5)} </Text>
      <Text color="gray">active </Text>
      <Text wrap="truncate-middle">{up.active ?? "—"}</Text>
      <Text color="gray"> standby </Text>
      <Text wrap="truncate-middle">{up.standby ?? "—"}</Text>
      <Text color="gray"> buffering </Text>
      <Text color={up.buffering ? "yellow" : "green"}>
        {String(up.buffering)}
      </Text>
      <Text color="gray"> buffered </Text>
      <Text>{up.buffered}</Text>
    </Box>
  );
}

function StatusHeader({ status }: { status: Status }) {
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      flexDirection="column"
    >
      <Box>
        <Text bold>gateway </Text>
        <Text color="gray">· log: </Text>
        <Text wrap="truncate">{GATEWAY_LOG_PATH ?? "stdout"}</Text>
        <Text color="gray"> · sessions </Text>
        <Text color="green">{status.sessions}</Text>
      </Box>
      {status.upstreams.map((up) => (
        <UpstreamRow key={up.role} up={up} />
      ))}
    </Box>
  );
}

type MenuItem = { label: string; value: "handoff" | "quit" };

function Menu({ onPick }: { onPick: (v: MenuItem["value"]) => void }) {
  const items: Array<{ label: string; value: MenuItem["value"] }> = [
    { label: "Handoff — migrate to a standby core", value: "handoff" },
    { label: "Quit", value: "quit" },
  ];
  return (
    <Box flexDirection="column" marginTop={1}>
      <SelectInput items={items} onSelect={(i) => onPick(i.value)} />
    </Box>
  );
}

function HandoffRolePicker({
  onPick,
  onCancel,
}: {
  onPick: (role: Role) => void;
  onCancel: () => void;
}) {
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        which upstream? <Text color="gray">(Esc to cancel)</Text>
      </Text>
      <SelectInput<Role>
        items={[
          { label: "auth  — authd", value: "auth" },
          { label: "game  — gamed", value: "game" },
        ]}
        onSelect={(i) => onPick(i.value)}
      />
    </Box>
  );
}

function HandoffInput({
  role,
  onSubmit,
  onCancel,
}: {
  role: Role;
  onSubmit: (path: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(DEFAULT_SOCK[role]);
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        standby socket path for <Text color="cyan">{role}</Text>{" "}
        <Text color="gray">(Enter to confirm, Esc to cancel)</Text>
      </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={(v) => onSubmit(v.trim() || DEFAULT_SOCK[role])}
      />
    </Box>
  );
}

function HandoffRunning() {
  return (
    <Box marginTop={1}>
      <Text color="yellow">running handoff…</Text>
    </Box>
  );
}

function HandoffResult({
  ok,
  msg,
  onBack,
}: {
  ok: boolean;
  msg: string;
  onBack: () => void;
}) {
  useInput(() => onBack());
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={ok ? "green" : "red"}>
        {ok ? "✓" : "✗"} {msg}
      </Text>
      <Text color="gray">press any key to return to menu</Text>
    </Box>
  );
}

function levelColor(level: number): string {
  return match(level)
    .with(P.number.gte(50), () => "red")
    .with(P.number.gte(40), () => "yellow")
    .with(P.number.gte(30), () => "green")
    .with(P.number.gte(20), () => "cyan")
    .otherwise(() => "gray");
}

function levelLabel(level: number): string {
  return match(level)
    .with(P.number.gte(60), () => "FATAL")
    .with(P.number.gte(50), () => "ERROR")
    .with(P.number.gte(40), () => "WARN ")
    .with(P.number.gte(30), () => "INFO ")
    .with(P.number.gte(20), () => "DEBUG")
    .otherwise(() => "TRACE");
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");

  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function LogLine({ entry }: { entry: LogEntry }) {
  const color = levelColor(entry.level);
  const lvl = levelLabel(entry.level);
  const mod = entry.mod ? `[${entry.mod}] ` : "";

  return (
    <Text wrap="truncate-end">
      <Text color="gray">{formatTime(entry.time)} </Text>
      <Text color={color}>{lvl} </Text>
      <Text color="gray">{mod}</Text>
      <Text>{entry.msg}</Text>
    </Text>
  );
}

function LogPane({ lines }: { lines: LogEntry[] }) {
  return (
    <Box
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      flexDirection="column"
      marginTop={1}
      height={LOG_LINES + 2}
    >
      <Box>
        <Text color="gray">logs · last {LOG_LINES}</Text>
      </Box>
      {lines.length === 0 ? (
        <Text color="gray">(waiting for events…)</Text>
      ) : (
        lines
          .slice(-LOG_LINES)
          .map((entry, i) => (
            <LogLine key={`${entry.time}-${i}`} entry={entry} />
          ))
      )}
    </Box>
  );
}

function App({ ctx, clear }: { ctx: Ctx; clear: () => void }) {
  const status = useStatus(ctx);
  const { columns } = useWindowSize();
  const logs = useRecentLogs(LOG_LINES);
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ name: "menu" });

  useEffect(() => {
    clear();
  }, [clear]);

  const goMenu = () => setScreen({ name: "menu" });

  const onMenuPick = (v: MenuItem["value"]) => {
    if (v === "quit") {
      void ctx.shutdown();
      exit();
      return;
    }
    setScreen({ name: "handoff-role" });
  };

  const runHandoff = async (role: Role, path: string) => {
    setScreen({ name: "handoff-running" });

    const t0 = Date.now();
    try {
      await ctx.upstreams.get(role).handoffTo(path);

      const msg = `${role} handoff complete in ${Date.now() - t0}ms`;

      log.info({ durationMs: Date.now() - t0, role, path }, msg);

      setScreen({ name: "handoff-result", ok: true, msg });
    } catch (err) {
      const msg = `${role} handoff failed: ${(err as Error).message}`;

      log.error({ err, role, path }, msg);

      setScreen({ name: "handoff-result", ok: false, msg });
    }
  };

  return (
    <Box flexDirection="column" width={columns}>
      <StatusHeader status={status} />
      {screen.name === "menu" && <Menu onPick={onMenuPick} />}
      {screen.name === "handoff-role" && (
        <HandoffRolePicker
          onPick={(role) => setScreen({ name: "handoff-input", role })}
          onCancel={goMenu}
        />
      )}
      {screen.name === "handoff-input" && (
        <HandoffInput
          role={screen.role}
          onSubmit={(path) => runHandoff(screen.role, path)}
          onCancel={goMenu}
        />
      )}
      {screen.name === "handoff-running" && <HandoffRunning />}
      {screen.name === "handoff-result" && (
        <HandoffResult ok={screen.ok} msg={screen.msg} onBack={goMenu} />
      )}
      <LogPane lines={logs} />
    </Box>
  );
}

export function startCli(ctx: Ctx): void {
  if (!process.stdin.isTTY) {
    return;
  }

  const ref: { clear: () => void } = { clear: () => undefined };
  const instance = render(<App ctx={ctx} clear={() => ref.clear()} />);

  ref.clear = () => instance.clear();
}
