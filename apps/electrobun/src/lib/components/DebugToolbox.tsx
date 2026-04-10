import { useState } from "react";

interface DebugToolboxProps {
  stats?: {
    fps: number;
    sprites: number;
    drawCalls: number;
    renderTime: number;
    memory: number;
  };
  error?: string | null;
  onLoadMap?: (mapId: number) => void;
}

const testMaps = [
  { id: 37, name: "Small Map" },
  { id: 300, name: "Medium Map" },
  { id: 745, name: "Large Map" },
  { id: 7411, name: "Stress Test Map" },
];

export default function DebugToolbox({
  stats = { fps: 0, sprites: 0, drawCalls: 0, renderTime: 0, memory: 0 },
  error = null,
  onLoadMap,
}: DebugToolboxProps) {
  const [showStats, setShowStats] = useState(true);

  return (
    <div className="debug-toolbox">
      <div className="controls">
        <label htmlFor="map-select">Load Map:</label>
        <select
          id="map-select"
          defaultValue={7411}
          onChange={(e) => onLoadMap?.(parseInt(e.target.value, 10))}
        >
          {testMaps.map((map) => (
            <option key={map.id} value={map.id}>
              {map.name} (ID: {map.id})
            </option>
          ))}
        </select>
        <button
          type="button"
          className="toggle-btn"
          onClick={() => setShowStats((s) => !s)}
          title={showStats ? "Hide stats" : "Show stats"}
        >
          {showStats ? "Hide" : "Show"} Stats
        </button>
      </div>

      {showStats && (
        <div className="stats-panel">
          <div className="stat-row">
            <span className="stat-label">FPS:</span>
            <span className="stat-value">{stats.fps}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Sprites:</span>
            <span className="stat-value">{stats.sprites}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Draw Calls:</span>
            <span className="stat-value">{stats.drawCalls}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Render:</span>
            <span className="stat-value">{stats.renderTime.toFixed(2)} ms</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Memory:</span>
            <span className="stat-value">{stats.memory.toFixed(1)} MB</span>
          </div>
        </div>
      )}

      {error && (
        <div className="error-bar">
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
