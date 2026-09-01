---
id: QA-134
title: Pas de panneau Métiers — le bouton de bannière est rendu et inerte
severity: P2
domain: hud-panels
type: gap
status: fixed
session: 6
opened: 2026-08-31
closed: 2026-09-01
fixed_in:
related: [QA-052, QA-123, QA-131]
files:
  - apps/electrobun/src/hud/banner/BannerReact.tsx
  - apps/electrobun/src/game/stores/hud-store.ts
  - apps/electrobun/src/hud/HudOverlay.tsx
---

## Symptôme

`<MainBannerIconButton icon="job" />` est rendu dans la bannière, son icône
existe (`components/ui/icons/banner/job.tsx`), et il n'a **pas d'`onClick`**.
`PanelName` ne connaît pas `"jobs"`, `HudOverlay` n'a pas de branche, et aucun
raccourci clavier n'y mène.

## Attendu (1.29)

Le bouton ouvre la fenêtre des métiers : un métier par ligne, son niveau, sa
jauge d'expérience, ses compétences, et pour un métier d'artisanat le nombre de
cases dont il dispose.

## Cause

Le panneau n'a jamais été écrit, faute de données à afficher : `JS` et `JX` sont
typés et n'ont aucun producteur (QA-131).

## Correctif

`hud/jobs/JobsPanel.tsx` sur le patron des autres panneaux (`Panel`,
géométrie dans un `jobs-theme.ts`, données par `useSyncExternalStore` sur
`jobs-store`). Ajouter `"jobs"` à `PanelName`, la branche dans `HudOverlay.tsx`,
le raccourci dans `hud/core/keybindings.ts`, et l'`onClick` du bouton existant.

Les jauges lisent `xp_min` / `xp_current` / `xp_max` de `JX` : le client ne
recalcule aucune courbe.

**Les icônes de métier manquent.** Le 1.29 les charge en
`clips/jobs/<J.g>.swf` et ces SWF n'ont jamais été extraits. Le panneau utilise
en attendant l'icône de la ressource-phare du métier ; l'extraction est une
fiche à part.

## Vérification

En jeu : le bouton ouvre et referme le panneau, qui affiche le métier appris,
son niveau et sa jauge, et se met à jour sans rechargement après une récolte.
