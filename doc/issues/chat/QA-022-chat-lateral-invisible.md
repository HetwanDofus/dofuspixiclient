---
id: QA-022
title: Le chat latéral est invisible sur la plupart des résolutions
severity: P1
domain: chat
type: bug
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-021, QA-052]
files:
  - apps/electrobun/src/window/mainview/MapRenderer.tsx:305-320
  - apps/electrobun/src/game/stores/chat-store.ts
---

## Symptôme

Le panneau ne se rend que si l'espace libre à côté du canvas dépasse 350 px.
Or le canvas est plafonné par la hauteur (`FULL_HEIGHT`) : en 1868×907 il
reste exactement 329 px de chaque côté et le chat disparaît.

Mesuré en session : visible à 2400 px de large, absent à 1868 px.

Il n'existe aucun bouton pour l'ouvrir — `toggleChatOpen` est exporté par
`game/stores/chat-store.ts` mais n'est appelé nulle part.

## Portée

Sur un 16:9 courant, le joueur n'a donc aucun chat du tout.
