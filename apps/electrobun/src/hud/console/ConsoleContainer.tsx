import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  Console,
  ConsoleButtons,
  ConsoleClearBtn,
  ConsoleCloseBtn,
  ConsoleCopyBtn,
  ConsoleInput,
  ConsoleInputRow,
  ConsoleLogLine,
  ConsoleLogsArea,
  ConsoleMinimizeBtn,
  ConsolePrompt,
} from "@/components/ui/console";
import { processConsoleCommand } from "@/game/console/parser";
import {
  clearConsoleLogs,
  closeConsole,
  consoleHistoryDown,
  consoleHistoryUp,
  consoleStore,
  cycleConsoleSize,
} from "@/game/stores";
import { useGameClient } from "@/hud/contexts/GameClientContext";

/**
 * Admin console (Debug widget) container. Subscribes to `consoleStore`
 * for log buffer + open/size state, and routes user input through
 * `processConsoleCommand` which mirrors `DebugConsoleParser` —
 * client-side commands run locally, anything else is forwarded to the
 * server as a raw `BA<cmd>` admin frame.
 *
 * Placement matches the original Debug widget: docked at the top of the
 * viewport, centered horizontally. The component clips to its rounded
 * outer shape so the logs + input form a single seamless panel like the
 * canonical `DebugLogsStylizedRectangle` + `DebugCommandLineStylizedRectangle`
 * stack (DofusStylePackage.as:359-360).
 */
export function ConsoleContainer() {
  const { isOpen, size, logs, prompt } = useSyncExternalStore(
    consoleStore.subscribe,
    consoleStore.getSnapshot
  );
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const gameClient = useGameClient();

  // Auto-focus the input when the console opens and auto-scroll to the
  // newest log line on every update — matches `Debug.initFocus()` +
  // `Debug.refresh()` semantics.
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: log count is the trigger, not a body read — re-scroll on every new line
  useEffect(() => {
    // Sentinel at the bottom of the log list — scrolls the nearest
    // overflow-y-auto ancestor (ConsoleLogsArea) so new lines are
    // always visible. Using a sentinel + scrollIntoView keeps the
    // component contract intact: ConsoleLogsArea doesn't need to
    // expose a ref to consumers.
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [logs.length]);

  const onSubmit = useCallback(
    (value: string) => {
      processConsoleCommand(value, { client: gameClient?.getClient() ?? null });
      setDraft("");
    },
    [gameClient]
  );

  const onFunctionKey = useCallback((event: { code: string; key: string }) => {
    // `Debug.onShortcut` (Debug.as:241-260) — HISTORY_UP/DOWN cycle
    // through the in-memory command history; Tab autocomplete is
    // intentionally a no-op until `allowedAdminCommands` is wired.
    if (event.code === "ArrowUp" || event.key === "ArrowUp") {
      const next = consoleHistoryUp();
      if (next !== undefined) {
        setDraft(next);
      }
      return;
    }
    if (event.code === "ArrowDown" || event.key === "ArrowDown") {
      setDraft(consoleHistoryDown());
    }
  }, []);

  const renderedLogs = useMemo(
    () =>
      logs.map((entry) => (
        <ConsoleLogLine key={entry.id} level={entry.level}>
          {entry.text}
        </ConsoleLogLine>
      )),
    [logs]
  );

  if (!isOpen) {
    return null;
  }

  return (
    // Top-of-screen, horizontally centered. `pointer-events-auto` on the
    // outer wrapper so the underlying HUD can still pass clicks through
    // when the console is hidden but receive them when it's open. The
    // `z-50` keeps the console above every HUD panel (banner is z-10,
    // panels z-20-ish) without colliding with the world map's z-9999.
    <div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex justify-center">
      <div className="pointer-events-auto mt-[calc(4px*var(--resolution-factor))]">
        <Console size={size}>
          <ConsoleButtons>
            <ConsoleCloseBtn onClick={() => closeConsole()} />
            <ConsoleMinimizeBtn
              onClick={() => {
                cycleConsoleSize();
                inputRef.current?.focus();
              }}
            />
            <ConsoleClearBtn
              onClick={() => {
                clearConsoleLogs();
                inputRef.current?.focus();
              }}
            />
            <ConsoleCopyBtn
              onClick={() => {
                if (typeof navigator === "undefined" || !navigator.clipboard) {
                  return;
                }
                navigator.clipboard
                  .writeText(logs.map((l) => l.text).join("\n"))
                  .catch(() => {
                    /* clipboard permission denied — ignore */
                  });
              }}
            />
          </ConsoleButtons>
          <ConsoleLogsArea>
            {renderedLogs}
            <div ref={bottomRef} />
          </ConsoleLogsArea>
          <ConsoleInputRow>
            <ConsolePrompt>{prompt}</ConsolePrompt>
            <ConsoleInput
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onSubmit={onSubmit}
              onFunctionKey={onFunctionKey}
              placeholder=""
            />
          </ConsoleInputRow>
        </Console>
      </div>
    </div>
  );
}
