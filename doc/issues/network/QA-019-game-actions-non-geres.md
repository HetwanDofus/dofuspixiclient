---
id: QA-019
title: Messages `gameActionsStart` / `gameActionsFinish` non gérés
severity: P2
domain: network
type: gap
status: open
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-046]
files: []
---

## Symptôme

À chaque déplacement, la console logge
`[MessageHandler] No handler for gameActionsStart` puis `… gameActionsFinish`.

## Cause

Le serveur émet bien le cadrage d'action (équivalent `GA` du 1.29) que le
client ignore — le séquenceur d'actions n'est pas branché côté client.
