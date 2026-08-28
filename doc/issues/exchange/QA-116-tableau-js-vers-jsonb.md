---
id: QA-116
title: Un tableau JS passé à une colonne jsonb est encodé comme un tableau Postgres — les objets créés se dédoublent au lieu de se cumuler
severity: P1
domain: exchange
type: bug
status: fixed
session: 6
opened: 2026-08-28
closed:
fixed_in:
related: [QA-086, QA-101, QA-060]
files:
  - apps/gameserver-ts/src/core/modules/items/items.repository.ts
  - apps/gameserver-ts/test/integration/item-transfer.int.spec.ts
---

## Symptôme

Relevé manette en main, sur un coffre de maison : déposer du fer puis le
reprendre ne le remet pas dans la pile existante, il crée **une seconde pile**.

En base, les deux lignes du même joueur et du même gabarit :

```
107 | owner_kind 1 | template 312 | qty 1 | effects []  | hash d751713988987e93…
128 | owner_kind 1 | template 312 | qty 1 | effects OBJ | hash 99914b932bd37a50…
```

(`OBJ` est l'objet JSON vide.) L'index unique `items_stack` porte sur
`effects_hash`. Les deux hachages diffèrent, donc l'index ne voit pas deux piles
identiques et le `ON CONFLICT DO UPDATE` de `ItemsRepository.give` insère au
lieu de cumuler.

## Cause

`give()` passait le tableau d'effets **tel quel** en paramètre d'une colonne
`jsonb`. node-postgres encode un tableau JS comme un *littéral de tableau
Postgres*, pas comme du JSON. Mesuré directement contre la base :

- un tableau vide est stocké comme l'objet JSON vide — silencieusement ;
- un tableau peuplé lève `ERROR: invalid input syntax for type json`.

Les deux moitiés comptent. La première est la plus vicieuse : elle passe sans
bruit et ne se voit qu'au hachage. La seconde veut dire qu'un objet **à jets**
retiré d'un coffre par le chemin split-puis-fusion levait une exception — le
chemin rapide (`relocateWholeStack`, un `UPDATE` brut) ne touche pas `effects`,
ce qui masquait le défaut tant qu'on ne déplaçait que des piles entières.

Le défaut **précède** le système d'échange : `InventoryRepository.insertItem`
faisait déjà `effects: JSON.parse(serialized)` au commit d00a8632e1 (QA-060), ce
qui rendait le butin d'un objet à jets impossible. `give()` en a hérité en
reprenant le même geste.

`dev-seed.ts` a toujours écrit `JSON.stringify(...)`, ce qui explique que les
lignes semées soient correctes et que rien ne l'ait révélé plus tôt.

## Correctif

`JSON.stringify(grant.effects)` : un paramètre texte, que Postgres convertit en
jsonb et qui fait l'aller-retour à l'identique.

Deux tests d'intégration, écrits d'abord rouges :

- « a stack taken back merges into the one left behind » — déposer 6 sur 10,
  reprendre les 6, finir avec **une** pile de 10 ;
- « rolled effects survive a split move unchanged » — le cas à jets, celui qui
  levait une exception.

Les deux lignes corrompues de la base de développement ont été refondues dans
leur pile saine.

## Vérification

`bun run test:integration` — 42 verts.
