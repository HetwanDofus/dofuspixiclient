import { useState } from "react";

import type { GameClient } from "@/game/game-client";

interface Props {
  client: GameClient;
  failureReason: string | null;
  busy: boolean;
}

export function LoginScreen({ client, failureReason, busy }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password || submitting) return;
    setSubmitting(true);
    try {
      await client.login(username, password);
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = busy || submitting || !username || !password;

  return (
    <div className="flex h-full w-full items-center justify-center">
      <form
        onSubmit={submit}
        className="w-80 rounded-lg bg-neutral-900/80 p-6 shadow-xl ring-1 ring-white/10"
      >
        <h1 className="mb-4 text-xl font-semibold text-white">Sign in</h1>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-neutral-300">Username</span>
          <input
            autoFocus
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded bg-neutral-800 px-3 py-2 text-white outline-none ring-1 ring-white/10 focus:ring-white/30"
          />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-neutral-300">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded bg-neutral-800 px-3 py-2 text-white outline-none ring-1 ring-white/10 focus:ring-white/30"
          />
        </label>
        {failureReason && (
          <div className="mb-3 rounded bg-red-950/60 px-3 py-2 text-sm text-red-300 ring-1 ring-red-500/30">
            {failureReason}
          </div>
        )}
        <button
          type="submit"
          disabled={disabled}
          className="w-full rounded bg-white/90 px-3 py-2 font-medium text-neutral-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Signing in…" : busy ? "Connecting…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
