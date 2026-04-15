import type { GameClient } from "@/game/game-client";
import type { ServerEntry } from "@/game/network/protocol";

interface Props {
  client: GameClient;
  servers: ServerEntry[];
  busy: boolean;
}

const STATE_LABELS: Record<number, string> = {
  0: "offline",
  1: "online",
  2: "saving",
};

export function ServerSelectScreen({ client, servers, busy }: Props) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="w-[32rem] rounded-lg bg-neutral-900/80 p-6 shadow-xl ring-1 ring-white/10">
        <h1 className="mb-4 text-xl font-semibold text-white">Select server</h1>
        {servers.length === 0 ? (
          <div className="text-sm text-neutral-400">No servers available.</div>
        ) : (
          <ul className="space-y-2">
            {servers.map((s) => {
              const disabled = busy || !s.isSelectable;
              return (
                <li key={s.serverId}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => client.selectServer(s.serverId)}
                    className="flex w-full items-center justify-between rounded bg-neutral-800/70 px-4 py-3 text-left text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="font-medium">Server #{s.serverId}</span>
                    <span className="flex items-center gap-3 text-sm text-neutral-400">
                      <span>{s.characterCount} chars</span>
                      <span>{STATE_LABELS[s.state] ?? `state ${s.state}`}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
