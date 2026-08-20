import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  connectionStore,
  type LostCause,
} from "@/game/stores/connection-store";

const EXPLANATION: Record<LostCause, string> = {
  core_restarted:
    "Le serveur de jeu a redémarré. La session a été fermée et la progression non enregistrée est perdue.",
  taken_over:
    "Votre compte a été connecté depuis un autre endroit. Une seule session est autorisée à la fois.",
  unreachable: "Le serveur ne répond plus.",
};

/**
 * Connection-lost dialog, in the spirit of the 1.29 client's own.
 *
 * Rendered above both the auth flow and the game so it can appear at any point
 * in the session. It is deliberately modal and deliberately offers a single way
 * out: once the server has forgotten us there is nothing to resume, and a
 * dismissable warning would just put the player back in front of a world that
 * silently ignores every order — the exact failure QA-046 describes.
 */
export function ConnectionLostDialog() {
  const { status, cause } = useSyncExternalStore(
    connectionStore.subscribe,
    connectionStore.getSnapshot
  );

  if (status !== "lost") {
    return null;
  }

  return (
    <div className="pointer-events-auto absolute inset-0 z-[10000] flex items-center justify-center bg-black/60">
      <div className="flex min-w-[320px] max-w-[420px] flex-col items-center gap-3 rounded border border-[#402b15] bg-[#1a1610] p-5 text-center text-white">
        <div className="font-[Verdana,sans-serif] text-[14px] font-bold">
          Connexion au serveur perdue
        </div>
        <div className="font-[Verdana,sans-serif] text-[11px] leading-relaxed text-[#ad9e7e]">
          {EXPLANATION[cause ?? "unreachable"]}
        </div>
        <Button
          variant="pill"
          onClick={reloadToLogin}
          title="Retour à l'écran de connexion"
        >
          Retour à l'écran de connexion
        </Button>
      </div>
    </div>
  );
}

/**
 * A full reload rather than a state reset. The session's leftovers are spread
 * across module-level xstate actors, the Pixi battlefield, the audio manager
 * and half a dozen stores, none of which has a teardown path today; unwinding
 * them by hand is how you get a second, subtler kind of zombie. Reloading is
 * the one move guaranteed to leave nothing behind.
 */
function reloadToLogin(): void {
  window.location.reload();
}
