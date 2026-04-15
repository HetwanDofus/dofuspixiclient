import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface TooltipState {
  text: string;
  x: number;
  y: number;
  visible: boolean;
}

interface TooltipContextValue {
  show: (text: string, x: number, y: number) => void;
  hide: () => void;
}

const TooltipContext = createContext<TooltipContextValue | null>(null);

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TooltipState>({
    text: "",
    x: 0,
    y: 0,
    visible: false,
  });

  const show = useCallback((text: string, x: number, y: number) => {
    setState({ text, x, y, visible: true });
  }, []);

  const hide = useCallback(() => {
    setState((s) => ({ ...s, visible: false }));
  }, []);

  return (
    <TooltipContext.Provider value={{ show, hide }}>
      {children}
      {state.visible &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: state.x + 10,
              top: state.y + 10,
              background: "rgba(0, 0, 0, 0.85)",
              color: "#fff",
              padding: "4px 8px",
              borderRadius: 4,
              fontSize: 11,
              fontFamily: "Verdana, sans-serif",
              pointerEvents: "none",
              zIndex: 999999,
              maxWidth: 300,
              whiteSpace: "pre-wrap",
            }}
          >
            {state.text}
          </div>,
          document.body
        )}
    </TooltipContext.Provider>
  );
}

export function useTooltip() {
  const ctx = useContext(TooltipContext);

  if (!ctx) {
    throw new Error("useTooltip must be used within a TooltipProvider");
  }

  return ctx;
}
