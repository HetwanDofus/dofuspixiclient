---
id: QA-013
title: "Inventaire : 450/1000 pods pour zéro objet"
severity: P2
domain: hud-panels
type: bug
status: fixed
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-037, QA-035, QA-076]
files:
  - apps/gameserver-ts/src/core/modules/inventory/pods.ts
  - apps/gameserver-ts/src/core/modules/stats/stats.service.ts
  - apps/electrobun/src/hud/inventory/EquipmentPanel.tsx
---

## Symptôme

L'inventaire est vide (aucun objet, aucun équipement) mais la jauge de pods
affiche `450/1000`.

## Cause

`useState(450)` pour le poids et `maxWeight = 1000` étaient écrits en dur
dans le panneau (QA-037). Rien côté serveur ne calculait de poids non plus :
`item_templates.weight` était importé et lu par personne, et le frame
`ItemWeight` (`Ow`) n'était jamais émis.

## Correctif

`pods.ts` calcule `maxPods = 1000 + 5 × force totale + bonus d'effet
158/159` et `currentPods = Σ quantité × poids du template` (sac et équipé
confondus, comme en 1.29). `StatsService.sendStats` émet le frame `Ow` à
chaque fois qu'il émet `As` — donc à chaque connexion, équipement, boost de
stat. Le panneau lit l'état réel du store au lieu d'un `useState` figé.

## Vérification

Testé à la main dans le client web le 2026-08-23 : la jauge suit le poids
réel du sac et de l'équipé, et ne bouge pas quand un objet est équipé
(le total ne change pas, seul le slot change).
