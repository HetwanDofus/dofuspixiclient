import { type CSSProperties, type ReactNode, useState } from "react";

interface PanelProps {
  title: string;
  width: number;
  height: number;
  zoom?: number;
  onClose?: () => void;
  children: ReactNode;
  style?: CSSProperties;
  /**
   * Draw the dark title bar at all.
   *
   * Every 1.29 window has one except the exchange's own offer board,
   * which retail draws as a bare rounded box — the board is titled by the
   * window beside it, not by itself.
   */
  showTitleBar?: boolean;
  /**
   * Content pinned to the right of the title bar, before the close button
   * — the partner's kamas on their offer board.
   */
  titleRight?: ReactNode;
  /**
   * A window that floats over the map rather than sitting on the banner.
   *
   * 1.29's docked panels — inventory, spells, characteristics — are
   * drawn open at the bottom, because the banner closes them: hence no
   * bottom border and only the top corners rounded. A window that floats
   * has nothing under it to close it, so it needs all four sides.
   */
  floating?: boolean;
}

const CLOSE_UP = "/themes/classic/assets/common/close-up.svg";
const CLOSE_DOWN = "/themes/classic/assets/common/close-down.svg";

/**
 * Base panel component replacing the PIXI BasePanel.
 * Renders panel chrome: rounded top corners, white border, dark title bar, close button.
 * Dimensions are in base units and scaled by zoom.
 */
export function Panel({
  title,
  width,
  height,
  zoom = 1,
  onClose,
  children,
  style,
  showTitleBar = true,
  titleRight,
  floating = false,
}: PanelProps) {
  const [closePressed, setClosePressed] = useState(false);

  const scaledW = Math.round(width * zoom);
  const scaledH = Math.round(height * zoom);
  const border = Math.round(3 * zoom);
  const radius = Math.round(13 * zoom);
  const titleH = Math.round(22 * zoom);
  const closeSize = Math.round(12 * zoom);
  const fontSize = Math.round(11 * zoom);

  return (
    <div
      className="dofus-panel"
      style={{
        width: scaledW,
        height: scaledH,
        borderWidth: border,
        borderRadius: floating ? radius : `${radius}px ${radius}px 0 0`,
        // The class sets `border-bottom-style: none` for the docked
        // case; an inline style is what overrides it.
        ...(floating
          ? { borderBottomStyle: "solid" as const, borderBottomWidth: border }
          : {}),
        pointerEvents: "auto",
        ...style,
      }}
    >
      {showTitleBar && (
        <div
          className="dofus-panel__titlebar"
          style={{
            minHeight: titleH,
            padding: `0 ${Math.round(5 * zoom)}px`,
            borderRadius: `${radius - border}px ${radius - border}px 0 0`,
          }}
        >
          <span className="dofus-panel__title" style={{ fontSize }}>
            {title}
          </span>
          {titleRight}
          {onClose && (
            <img
              src={closePressed ? CLOSE_DOWN : CLOSE_UP}
              alt="Close"
              width={closeSize}
              height={closeSize}
              draggable={false}
              style={{ cursor: "pointer" }}
              onPointerDown={() => setClosePressed(true)}
              onPointerUp={() => {
                setClosePressed(false);
                onClose();
              }}
              onPointerLeave={() => setClosePressed(false)}
            />
          )}
        </div>
      )}
      <div className="dofus-panel__content" style={{ fontSize }}>
        {children}
      </div>

      <style>{`
        .dofus-panel {
          position: relative;
          border-style: solid;
          border-color: white;
          border-bottom-style: none;
          background: var(--dofus-bg, #d5cfaa);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          font-family: Verdana, sans-serif;
          color: var(--dofus-text-dark, #514a3c);
        }
        .dofus-panel__titlebar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--dofus-header-bg, #514a3c);
          flex-shrink: 0;
        }
        .dofus-panel__title {
          color: var(--dofus-text-white, #ffffff);
          font-weight: bold;
        }
        .dofus-panel__content {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
        }
      `}</style>
    </div>
  );
}
