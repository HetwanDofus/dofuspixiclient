import { Button } from "@/components/ui/button";
import { useFightMode } from "@/hud/fight/useFightMode";

interface FightEndDialogProps {
  onClose: () => void;
}

/**
 * Modal-style end-of-fight summary. Today the fightStore projection
 * does not include the GameEnd payload (winner team, per-fighter XP /
 * kama / drops); we surface a minimal "Combat terminé" card and let
 * the user dismiss it. Rich results land when fightActor's context
 * grows the GameEnd snapshot.
 */
export function FightEndDialog({ onClose }: FightEndDialogProps) {
  const fight = useFightMode();
  if (!fight.isEnded) {
    return null;
  }
  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="flex min-w-[calc(280px*var(--resolution-factor))] flex-col items-center gap-[calc(8px*var(--resolution-factor))] rounded-[calc(4px*var(--resolution-factor))] border border-[#402b15] bg-[#1a1610] p-[calc(16px*var(--resolution-factor))] text-white">
        <div className="font-[Verdana,sans-serif] text-[calc(14px*var(--resolution-factor))] font-bold">
          Combat terminé
        </div>
        <div className="font-[Verdana,sans-serif] text-[calc(10px*var(--resolution-factor))] text-[#ad9e7e]">
          Récapitulatif détaillé bientôt disponible.
        </div>
        <Button variant="pill" onClick={onClose} title="Fermer">
          OK
        </Button>
      </div>
    </div>
  );
}
