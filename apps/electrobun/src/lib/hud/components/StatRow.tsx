interface StatRowProps {
  label: string;
  base: number;
  bonus: number;
  total: number;
  onBoost?: () => void;
  canBoost?: boolean;
  even?: boolean;
}

export function StatRow({ label, base, bonus, total, onBoost, canBoost, even }: StatRowProps) {
  return (
    <div
      className="dofus-stat-row"
      style={{
        background: even ? "var(--dofus-bg-alt, #c9bf9d)" : "transparent",
      }}
    >
      <span className="dofus-stat-row__label">{label}</span>
      <span className="dofus-stat-row__base">{base}</span>
      {bonus > 0 && (
        <span className="dofus-stat-row__bonus">+{bonus}</span>
      )}
      <span className="dofus-stat-row__total">{total}</span>
      {canBoost && (
        <button className="dofus-stat-row__boost" onClick={onBoost}>
          +
        </button>
      )}

      <style>{`
        .dofus-stat-row {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          font-size: 10px;
          min-height: 18px;
        }
        .dofus-stat-row__label {
          flex: 1;
          color: var(--dofus-text-dark, #514a3c);
        }
        .dofus-stat-row__base {
          min-width: 28px;
          text-align: right;
          font-weight: bold;
        }
        .dofus-stat-row__bonus {
          color: var(--dofus-boost, #ff6100);
          min-width: 28px;
          text-align: right;
          font-size: 9px;
        }
        .dofus-stat-row__total {
          min-width: 32px;
          text-align: right;
          font-weight: bold;
        }
        .dofus-stat-row__boost {
          background: var(--dofus-boost, #ff6100);
          color: white;
          border: none;
          border-radius: 2px;
          width: 14px;
          height: 14px;
          cursor: pointer;
          font-size: 10px;
          font-weight: bold;
          line-height: 1;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .dofus-stat-row__boost:hover {
          background: var(--dofus-boost-hover, #eca272);
        }
      `}</style>
    </div>
  );
}
