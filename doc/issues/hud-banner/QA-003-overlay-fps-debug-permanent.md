---
id: QA-003
title: Overlay FPS de debug affiché en permanence, sans toggle
severity: P1
domain: hud-banner
type: bug
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-004]
files: [apps/electrobun/src/game/render/engine.ts:128-135]
---

## Symptôme

`Engine.init()` crée inconditionnellement un `<div>` `position:fixed`
`z-index:999999` en haut à gauche du viewport, qui affiche
`72 FPS 1act upd:0.0ms | sl:0/2048 r:0 q:0.0ms fl:0.0ms h:0`.

Il n'est lié à aucun raccourci — `DEBUG_TOGGLE` = `D` ne l'affecte pas — et se
superpose au jeu en toutes circonstances. C'est l'une des quatre choses qui
frappent dans les dix premières secondes de jeu.

## Correctif

À passer derrière le flag debug.
