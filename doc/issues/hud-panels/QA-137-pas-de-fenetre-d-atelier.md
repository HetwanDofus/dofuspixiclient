---
id: QA-137
title: Pas de fenêtre d'atelier
severity: P1
domain: hud-panels
type: gap
status: fixed
session: 6
opened: 2026-08-31
closed: 2026-09-01
fixed_in:
related: [QA-078, QA-135, QA-136]
files:
  - apps/electrobun/src/hud/exchange/StorageWindow.tsx
  - apps/electrobun/src/hud/exchange/TradeOfferPanel.tsx
  - apps/electrobun/src/hud/inventory/ItemGrid.tsx
---

## Symptôme

Aucune interface d'artisanat. Le gestionnaire d'échange du client route
`exchangeCreate` vers l'ouverture générique et le type 3 n'a pas de fenêtre.

## Attendu (1.29)

Deux grilles — le sac, et les cases de la recette —, une prévisualisation du
résultat, un bouton de fabrication et un mode série. Les lignes de recette sont
colorées : gris pour 100 % et zéro expérience, vert pour 100 % avec expérience,
rouge pour le taux normal avec expérience.

## Cause

Le flux serveur n'existe pas (QA-135).

## Correctif

`hud/craft/CraftWindow.tsx`. Rien à dessiner de neuf : `StorageWindow.tsx`
donne la double grille et l'ouverture pilotée par le serveur,
`TradeOfferPanel.tsx` la grille de cases à nombre fixe
(`showFilters={false} showTitle={false}`), et `ItemGrid.tsx` fait les deux —
il a déjà été généralisé une fois pour la banque et l'échange.

Comme la banque et l'échange, la fenêtre sort de la rotation à panneau unique :
ouvrir un atelier ne doit pas fermer l'inventaire.

## Vérification

Ouvrir l'inventaire, puis l'atelier : l'inventaire reste ouvert. Poser des
ingrédients, fabriquer, et voir les deux grilles se mettre à jour sans
rechargement. Fermer et rouvrir : les cases sont vides et l'inventaire est
juste.
