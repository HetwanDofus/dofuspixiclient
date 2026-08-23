---
id: QA-021
title: Deux chats concurrents, dont un factice
severity: P2
domain: chat
type: bug
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-020, QA-022, QA-008]
files: []
---

## Symptôme

Le chat réellement fonctionnel est `SideChatContainer`, panneau latéral séparé.
Quand il s'affiche, l'écran porte deux zones de saisie (« Chat here… » morte
dans la bannière, « Say something… » vivante à droite) et **deux jeux de huit
filtres de canaux**.

## Décision à prendre

Lequel des deux est le chat du jeu. QA-020 et QA-022 en découlent.
