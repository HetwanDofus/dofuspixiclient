---
id: QA-007
title: Les 14 slots de raccourcis sont vides et inertes
severity: P2
domain: hud-banner
type: gap
status: fixed
session: 1
opened: 2026-08-20
closed:
fixed_in:
related: [QA-010, QA-013]
files:
  - proto/items.proto
  - proto/spells.proto
  - apps/gameserver-ts/migrations/0050_hotbar_shortcuts.ts
  - apps/gameserver-ts/src/core/modules/shortcuts/
  - apps/gameserver-ts/src/core/features/game/shortcuts/
  - apps/gameserver-ts/src/core/features/game/spell-move/
  - apps/electrobun/src/game/stores/shortcuts-store.ts
  - apps/electrobun/src/hud/banner/BannerReact.tsx
  - apps/electrobun/src/hud/banner/hotbar-dnd.ts
  - apps/electrobun/src/hud/banner/hotbar-actions.ts
  - apps/electrobun/src/components/ui/main-banner.tsx
  - apps/electrobun/src/hud/core/keybindings.ts
---

## Symptôme

Deux rangées de 7 slots, avec des onglets latéraux « Sorts » / « Obj. ». Aucun
contenu, aucun glisser-déposer testable puisque ni sorts ni objets n'existent
(cf. QA-010, QA-013). Les onglets ne réagissent pas au clic.

Après la résolution de QA-010 et QA-013 les sorts s'affichaient, mais tout le
reste de la barre restait mort : les onglets ne changeaient rien, aucune source
n'était glissable, aucune touche n'était liée à un slot, et rien n'était
persisté.

## Attendu (1.29)

`dofus/graphics/gapi/controls/MouseShortcuts.as` est la barre canonique :
14 conteneurs, deux onglets exclusifs (`TAB_SPELLS` / `TAB_ITEMS`), glisser-
déposer depuis le grimoire et l'inventaire, double-clic pour utiliser ou
équiper, menu contextuel « Retirer ce raccourci » (`Banner.as:1248-1252`), et
`SH1`..`SH14` / `SWAP` au clavier. Un raccourci objet tient un **template**
(`InventoryShortcutItem._nGenericID`) et se re-résout contre l'inventaire à
chaque rendu : il grise quand le joueur n'a plus l'objet, il ne disparaît pas.
Un sort ne se lance pas depuis la carte.

## Cause

Trois ruptures indépendantes :

1. `MainBannerGrid` montait un `Tabs.Root` sans aucun `Tabs.Panel` — les
   enfants étaient rendus dans un `div` frère, si bien que changer d'onglet ne
   pouvait rien changer.
2. Le protocole (`OrA` / `OrM` / `OrR`, `SM` / `SR`) était déclaré dans
   `proto/` et présent dans les `oneof`, mais aucun handler ne l'écoutait ni
   côté serveur ni côté client, et la table `player_item_shortcuts`
   (migration 0004) n'était ni lue ni écrite.
3. `BannerReact` indexait `slots[spell.position]` comme si `position` était
   0-based, alors que le serveur sème du 1-based (`migrations/0037`,
   `ROW_NUMBER()` démarre à 1) : la barre était décalée d'un cran et le sort
   en position 14 était jeté.

Deux défauts de forme du protocole ont été corrigés au passage :
`SpellMove` portait `{old_position, new_position}` alors que le fil retail est
`SM<spellId>|<position>` (`dofus/aks/Spells.as:131-138`), et rien ne disait que
`InventoryShortcutAdd.object_id` (serveur → client) est un template quand
`InventoryShortcutAddRequest.object_id` (client → serveur) est l'unicId d'une
pile.

## Correctif

- **Données** — `migrations/0050_hotbar_shortcuts.ts` recrée
  `player_item_shortcuts` en `(player_id, slot, template_id)`. L'ancienne
  colonne `item_id` référençait `player_items.id` en cascade : boire la
  dernière potion supprimait le raccourci. `spell_id` disparaît, les slots de
  sorts vivant déjà dans `player_spells.position`. La plage passe à `1..42`,
  soit 3 pages de 14.
- **Serveur** — `modules/shortcuts/` (repository, service, frames) plus deux
  slices : `features/game/shortcuts/` (OrA/OrM/OrR) et
  `features/game/spell-move/` (SM/SR, avec éviction de l'occupant). L'entrée en
  jeu rejoue les raccourcis, une frame `OrA` par slot, après les templates.
- **Client** — `stores/shortcuts-store.ts` porte les slots objets, l'onglet
  courant et la page ; `resolveShortcut` reproduit `findRealItem()` (pile
  équipée prioritaire, quantité cumulée, libellé `Eq` / quantité, grisage quand
  le joueur ne possède plus rien). `hotbar-dnd.ts` fournit le glisser-déposer
  HTML5 (sources : grimoire, inventaire, barre ; cible : la barre ; lâcher hors
  cible = retrait), avec la règle 1.29 « panneau ouvert ou Maj enfoncé ».
  `hotbar-actions.ts` est le chemin unique partagé par la souris et le clavier.
- **Clavier** — `SWAP` = `<`, slots 1..7 = `1`..`7`, slots 8..14 =
  `Ctrl+1`..`Ctrl+7`, valeurs lues dans
  `apps/electrobun/public/assets/langs/fr/shortcuts.json` (table `SSK`, jeu 1).
- **Divergence assumée** — des flèches de pagination remplacent la
  `MovableContainerBar` détachable du client retail pour atteindre les slots
  au-delà de 14.

## Vérification

```bash
cd apps/gameserver-ts && bun test src/core/modules/shortcuts/   # 12 cas
cd apps/electrobun && bun test src/game/stores/shortcuts-store.spec.ts src/game/stores/spells-store.spec.ts
```

À la main, dans le client lancé (`just dev`) :

1. Inventaire ouvert, glisser une **Potion de Mini Soin** sur un slot en mode
   « Obj. » → l'icône apparaît avec le badge `5`.
2. Double-clic → potion bue, PV en hausse, badge à `4`. Même effet avec la
   touche du slot. Pile vidée → le slot reste, grisé.
3. `<` bascule sur « Sorts » ; un clic sur un sort hors combat ne fait rien,
   seul le tooltip s'affiche.
4. Grimoire ouvert, glisser un sort sur un slot, le déplacer, le glisser hors
   de la barre pour le retirer.
5. Page 2 via les flèches, y poser un raccourci.
6. **Déconnexion / reconnexion** : tout est encore là, sur les trois pages.
