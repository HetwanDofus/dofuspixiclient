import { type CSSProperties, useState } from "react";

import { Panel } from "../components/Panel";

interface InventoryPanelProps {
  onClose: () => void;
  zoom?: number;
}

const INV_W = 490;
const INV_H = 417;
const PREV_W = 222;
const PREV_H = 197;
const PREV_GAP = 10;

const EQUIP_SLOTS = {
  amulet: { x: 146, y: 44, s: 30 },
  weapon: { x: 208, y: 28, s: 40 },
  ring_l: { x: 82, y: 84, s: 30 },
  ring_r: { x: 141, y: 77, s: 40 },
  belt: { x: 214, y: 84, s: 30 },
  boots: { x: 141, y: 138, s: 40 },
  hat: { x: 274, y: 31, s: 35 },
  cape: { x: 274, y: 72, s: 35 },
  pet: { x: 274, y: 112, s: 35 },
  dofus1: { x: 28, y: 36, s: 25 },
  dofus2: { x: 28, y: 63, s: 25 },
  dofus3: { x: 28, y: 90, s: 25 },
  dofus4: { x: 28, y: 117, s: 25 },
  dofus5: { x: 28, y: 144, s: 25 },
  dofus6: { x: 28, y: 171, s: 25 },
  shield: { x: 78, y: 28, s: 40 },
  mount: { x: 274, y: 153, s: 35 },
};

const FILTER_BUTTONS = [
  {
    id: "equipment",
    stageX: 607,
    stageY: 76,
    icon: "/themes/classic/assets/panels/inventory/filter-equipment.svg",
  },
  {
    id: "nonEquip",
    stageX: 629,
    stageY: 76,
    icon: "/themes/classic/assets/panels/inventory/filter-non-equipment.svg",
  },
  {
    id: "resources",
    stageX: 651,
    stageY: 76,
    icon: "/themes/classic/assets/panels/inventory/filter-resources.svg",
  },
  {
    id: "quest",
    stageX: 673,
    stageY: 76,
    icon: "/themes/classic/assets/panels/inventory/filter-quest.svg",
  },
  {
    id: "souls",
    stageX: 607,
    stageY: 96,
    icon: "/themes/classic/assets/panels/inventory/filter-souls.svg",
  },
  {
    id: "runes",
    stageX: 629,
    stageY: 96,
    icon: "/themes/classic/assets/panels/inventory/filter-runes.svg",
  },
  {
    id: "cards",
    stageX: 651,
    stageY: 96,
    icon: "/themes/classic/assets/panels/inventory/filter-cards.svg",
  },
  {
    id: "customSet",
    stageX: 673,
    stageY: 96,
    icon: "/themes/classic/assets/panels/inventory/filter-custom-set.svg",
  },
];

const INV_OX = 242;
const INV_OY = 18;

const sx = (stageV: number) => stageV - INV_OX;
const sy = (stageV: number) => stageV - INV_OY;
const p = (n: number, zoom: number) => Math.round(n * zoom);

function EquipSlot({
  slotKey,
  slot,
  zoom,
}: {
  slotKey: string;
  slot: { x: number; y: number; s: number };
  zoom: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: p(slot.x, zoom),
        top: p(slot.y, zoom),
        width: p(slot.s, zoom),
        height: p(slot.s, zoom),
        backgroundImage:
          'url("/themes/classic/assets/panels/inventory/equip-slot-fill.svg")',
        backgroundSize: "contain",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
      }}
      title={slotKey}
    />
  );
}

export function InventoryPanel({ onClose, zoom = 1 }: InventoryPanelProps) {
  const [kamas] = useState(1500000);
  const [weight] = useState(450);
  const maxWeight = 1000;
  const [filterSelected, setFilterSelected] = useState(0);

  const contentStyle: CSSProperties = {
    position: "relative",
    width: p(INV_W, zoom),
    height: p(INV_H - 22, zoom),
  };

  return (
    <div
      style={{
        position: "relative",
        width: p(INV_W + PREV_W + PREV_GAP, zoom),
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: p(PREV_W, zoom),
          height: p(PREV_H, zoom),
          border: `${p(2, zoom)}px solid white`,
          borderRadius: `${p(8, zoom)}px`,
          background: "var(--dofus-bg, #d5cfaa)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <img
          src="/themes/classic/assets/panels/inventory/character-silhouette.svg"
          alt="Preview"
          style={{
            width: "80%",
            height: "80%",
            objectFit: "contain",
          }}
        />
      </div>

      <div style={{ marginLeft: p(PREV_W + PREV_GAP, zoom) }}>
        <Panel
          title="Inventaire"
          width={INV_W}
          height={INV_H}
          onClose={onClose}
          zoom={zoom}
        >
          <div style={contentStyle}>
            <div
              style={{
                position: "absolute",
                left: p(sx(251), zoom),
                top: p(sy(54), zoom),
                width: p(316, zoom),
                height: p(185, zoom),
                backgroundColor: "#514A3C",
                borderRadius: p(10, zoom),
              }}
            />

            {Object.entries(EQUIP_SLOTS).map(([key, slot]) => (
              <EquipSlot key={key} slotKey={key} slot={slot} zoom={zoom} />
            ))}

            <div
              style={{
                position: "absolute",
                left: p(sx(320), zoom),
                top: p(sy(220), zoom),
                color: "#4a92c8",
                fontSize: p(10, zoom),
                fontWeight: "bold",
              }}
            >
              Kamas: {kamas.toLocaleString()}
            </div>

            <div
              style={{
                position: "absolute",
                left: p(sx(440), zoom),
                top: p(sy(210), zoom),
                color: "white",
                fontSize: p(9, zoom),
                fontWeight: "bold",
              }}
            >
              Pods
            </div>

            <div
              style={{
                position: "absolute",
                left: p(sx(430), zoom),
                top: p(sy(224), zoom),
                width: p(80, zoom),
                height: p(10, zoom),
                backgroundColor: "rgba(0, 0, 0, 0.3)",
                borderRadius: p(2, zoom),
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${(weight / maxWeight) * 100}%`,
                  background: "linear-gradient(to right, #ff6600, #ffaa00)",
                }}
              />
            </div>

            <div
              style={{
                position: "absolute",
                left: p(sx(470), zoom),
                top: p(sy(234), zoom),
                color: "white",
                fontSize: p(7, zoom),
                textAlign: "center",
                width: p(30, zoom),
              }}
            >
              {weight}/{maxWeight}
            </div>

            <div
              style={{
                position: "absolute",
                left: p(sx(535), zoom),
                top: p(sy(218), zoom),
                width: p(20, zoom),
                height: p(20, zoom),
                borderRadius: "50%",
                backgroundColor: "#993333",
                cursor: "pointer",
              }}
            />

            <div
              style={{
                position: "absolute",
                left: p(sx(253), zoom),
                top: p(sy(249), zoom),
                width: p(316, zoom),
                height: p(179, zoom),
                backgroundColor: "#514A3C",
                borderRadius: `${p(10, zoom)}px ${p(10, zoom)}px 0 0`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#999999",
                fontSize: p(12, zoom),
                textAlign: "center",
                padding: p(10, zoom),
              }}
            >
              Aucun objet sélectionné
            </div>

            <div
              style={{
                position: "absolute",
                left: p(sx(579), zoom),
                top: p(sy(54), zoom),
                width: p(142, zoom),
                height: p(89, zoom),
                backgroundColor: "#514A3C",
                borderRadius: `${p(10, zoom)}px ${p(10, zoom)}px 0 0`,
              }}
            >
              <div
                style={{
                  textAlign: "center",
                  color: "white",
                  fontSize: p(10, zoom),
                  fontWeight: "bold",
                  paddingTop: p(5, zoom),
                  width: p(132, zoom),
                }}
              >
                Équipement
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: p(2, zoom),
                  padding: p(5, zoom),
                  width: p(132, zoom),
                }}
              >
                {FILTER_BUTTONS.map((btn) => (
                  <button
                    type="button"
                    key={btn.id}
                    onClick={() =>
                      setFilterSelected(FILTER_BUTTONS.indexOf(btn))
                    }
                    style={{
                      position: "relative",
                      width: p(18, zoom),
                      height: p(18, zoom),
                      border: "none",
                      background: "transparent",
                      backgroundImage: `url("${btn.icon}")`,
                      backgroundSize: "contain",
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "center",
                      cursor: "pointer",
                      opacity:
                        FILTER_BUTTONS.indexOf(btn) === filterSelected
                          ? 1
                          : 0.7,
                      padding: 0,
                    }}
                  />
                ))}
              </div>
            </div>

            <div
              style={{
                position: "absolute",
                left: p(sx(583), zoom),
                top: p(sy(117), zoom),
                width: p(132, zoom),
                height: p(18, zoom),
                backgroundColor: "#666666",
                borderRadius: p(2, zoom),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontSize: p(9, zoom),
                cursor: "pointer",
              }}
            >
              All types
            </div>

            <button
              type="button"
              style={{
                position: "absolute",
                left: p(sx(695), zoom),
                top: p(sy(117), zoom),
                width: p(18, zoom),
                height: p(18, zoom),
                border: "none",
                backgroundColor: "#666666",
                borderRadius: p(2, zoom),
                cursor: "pointer",
                backgroundImage:
                  'url("/themes/classic/assets/panels/inventory/search.svg")',
                backgroundSize: "contain",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
                padding: 0,
              }}
            />

            <div
              style={{
                position: "absolute",
                left: p(sx(580), zoom),
                top: p(sy(146), zoom),
                width: p(140, zoom),
                height: p(280, zoom),
                backgroundColor: "#beb998",
                borderRadius: p(2, zoom),
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: "100%",
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: p(2, zoom),
                  padding: p(2, zoom),
                  boxSizing: "border-box",
                }}
              >
                {[...Array(36)].map((_, i) => (
                  <div
                    key={`cell-${i}`}
                    style={{
                      backgroundColor: "#a0957f",
                      borderRadius: p(2, zoom),
                      backgroundImage:
                        'url("/themes/classic/assets/panels/inventory/grid-cell-bg.svg")',
                      backgroundSize: "contain",
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "center",
                    }}
                  />
                ))}
              </div>
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: 0,
                  width: p(12, zoom),
                  height: "100%",
                  backgroundColor: "#9a9584",
                  borderRadius: p(2, zoom),
                }}
              />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
