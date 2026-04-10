interface ProgressBarProps {
  value: number;
  max: number;
  label?: string;
  color?: string;
  height?: number;
}

export function ProgressBar({
  value,
  max,
  label,
  color = "var(--dofus-bar-fill, #ff6600)",
  height = 10,
}: ProgressBarProps) {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;

  return (
    <div className="dofus-progress">
      {label && <span className="dofus-progress__label">{label}</span>}
      <div className="dofus-progress__track" style={{ height }}>
        <div
          className="dofus-progress__fill"
          style={{ width: `${percent}%`, background: color }}
        />
      </div>
      <span className="dofus-progress__value">
        {value}/{max}
      </span>

      <style>{`
        .dofus-progress {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 10px;
          color: var(--dofus-text-dark, #514a3c);
        }
        .dofus-progress__label {
          min-width: 30px;
        }
        .dofus-progress__track {
          flex: 1;
          background: var(--dofus-bar-bg, #514a3c);
          border: 1px solid var(--dofus-bar-border, #514a3c);
          border-radius: 2px;
          overflow: hidden;
        }
        .dofus-progress__fill {
          height: 100%;
          transition: width 0.3s ease;
        }
        .dofus-progress__value {
          min-width: 50px;
          text-align: right;
          font-size: 9px;
        }
      `}</style>
    </div>
  );
}
