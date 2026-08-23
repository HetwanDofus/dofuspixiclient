---
id: QA-002
title: Écrans serveur / personnage sans artwork
severity: P3
domain: auth
type: bug
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-001]
files: []
---

## Symptôme

« Select server » → `Server #1 / 1 chars / online`, puis « Select character » →
`Dev / lvl 1 / gfx 10`. Le personnage est listé en texte brut : ni aperçu du
sprite, ni classe, ni serveur d'origine.

`gfx 10` est un identifiant interne qui ne devrait pas être exposé au joueur.

## Attendu (1.29)

Les deux écrans sont illustrés, et le personnage est rendu avec son sprite,
sa classe et son niveau.
