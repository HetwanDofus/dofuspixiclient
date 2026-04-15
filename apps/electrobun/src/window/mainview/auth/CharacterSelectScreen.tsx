import type { GameClient } from "@/game/game-client";
import type { CharacterListEntry } from "@/game/network/protocol";

interface Props {
  client: GameClient;
  characters: CharacterListEntry[];
  busy: boolean;
}

export function CharacterSelectScreen({ client, characters, busy }: Props) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="w-[32rem] rounded-lg bg-neutral-900/80 p-6 shadow-xl ring-1 ring-white/10">
        <h1 className="mb-4 text-xl font-semibold text-white">
          Select character
        </h1>
        {characters.length === 0 ? (
          <div className="text-sm text-neutral-400">
            No characters on this server.
          </div>
        ) : (
          <ul className="space-y-2">
            {characters.map((c) => {
              const id = Number(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => client.selectCharacter(id)}
                    className="flex w-full items-center justify-between rounded bg-neutral-800/70 px-4 py-3 text-left text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="flex items-center gap-3 text-sm text-neutral-400">
                      <span>lvl {c.level}</span>
                      <span>gfx {c.gfxId}</span>
                      {c.isDead && (
                        <span className="text-red-400">dead</span>
                      )}
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
