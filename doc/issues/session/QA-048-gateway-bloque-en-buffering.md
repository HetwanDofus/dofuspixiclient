---
id: QA-048
title: Le gateway ne sort jamais du mode buffering après une reconnexion au core
severity: P0
domain: session
type: bug
status: fixed
session: 1
opened: 2026-08-20
closed:
fixed_in: be5a86d79d
related: [QA-046]
files:
  - apps/gameserver-ts/src/gateway/upstream.ts
  - packages/uds-transport/src/client.ts
  - apps/gameserver-ts/src/gateway/upstream.spec.ts
---

## Symptôme

Reproduction :

1. `docker restart dofuspixiclient-gamed-1` (client connecté ou non) ;
2. recharger le client et se reconnecter (`dev` / `dev` → Server #1).

L'écran de sélection affiche **« No characters on this server. »** alors que
`select * from players` retourne bien `Dev` (id 1, account 1, server 1).
Reproduit deux fois d'affilée. Le personnage n'est pas perdu — il est
simplement inatteignable, ce qui rend le message doublement trompeur.

Chaîne d'événements, relevée dans les logs du gateway :

```
"active core disconnected — buffering"          ← buffering = true
"uds connect failed, retrying"  reconnectMs:500
"connected to core"                             ← reconnecté…
```

puis `/health` :

```json
{"role":"game","active":"/sockets/gamed.sock","buffering":true,"buffered":7}
```

Le gateway s'est bien reconnecté mais **reste en `buffering: true` avec 7 trames
en file, jamais transmises**. `authd` reçoit et traite tout normalement
(`login ok`, `ticket: account=1 server=1`), tandis que `gamed` ne logge plus
rien depuis son démarrage : aucune trame `/game` ne lui parvient.

## Cause

Dans `apps/gameserver-ts/src/gateway/upstream.ts` :

- `onDisconnect` (l. 64-72) pose `this.buffering = true` quand le lien actif
  meurt ;
- seuls `setActive()` (l. 83) et le chemin de handoff (l. 250) remettent
  `buffering = false` ;
- or `udsConnect` **reconnecte le même objet `link`** en boucle. Sa callback
  `onConnect` (l. 58-62) se contente de `link.resolveReady()` — elle n'appelle
  jamais `setActive`, puisque `this.active === link` l'est déjà.

`buffering` reste donc `true` définitivement, et `forwardClient` (l. 98) empile
toute trame client jusqu'à `BUFFER_CAP`.

## Portée

C'est **la troisième des trois causes racines** de la session, et c'est le
mécanisme de zéro-downtime qui justifie tout le découpage gateway / core décrit
dans [architecture.md](../../architecture.md). Il est cassé sur le scénario le
plus courant — un core qui redémarre sans handoff orchestré, c'est-à-dire tout
crash et tout `just gamed` en watch mode.

**Seul un redémarrage du gateway rétablissait le service**, alors que le gateway
est précisément le composant censé ne jamais redémarrer.

QA-046 est la face visible de ce même bug côté client.

## Correctif — 2026-08-20

Le correctif d'une ligne envisagé ci-dessus (`buffering = false` dans
`onConnect`) **ne suffisait pas**. Il lève bien le blocage, mais les trames
mises en file partent quand même dans le vide, pour une seconde raison :

- dans `packages/uds-transport/src/client.ts`, `current` n'est réassigné qu'au
  retour du `await Bun.connect(...)`, alors que `onConnect` est appelé *pendant*
  ce connect. À l'instant du rappel, `current` pointe encore sur la socket
  morte, et `send()` — qui teste `current && isOpen(current)` — jette
  silencieusement tout ce qu'on lui donne. Le vidage du buffer déclenché depuis
  `onConnect` était donc entièrement perdu. **La socket est maintenant publiée
  avant l'appel du rappel.**

Deux défauts voisins corrigés dans la foulée, parce qu'ils produisent
exactement le même symptôme par un autre chemin :

- `sessionOpen` / `sessionClose` court-circuitaient le buffer et partaient
  directement sur la socket : une session ouverte pendant la coupure n'était
  jamais annoncée au nouveau core, et ses trames arrivaient ensuite pour une
  session qu'il ne connaissait pas. Tout passe désormais par la même file, ce
  qui garantit aussi l'ordre `open` → messages → `close` ;
- un handoff qui échoue laissait `standby` positionné (tout handoff ultérieur
  refusé) et `buffering` à `true` — le gel de QA-048 par une autre route. Le
  repli sur le core actif est maintenant explicite.

Enfin, le journal d'un buffer saturé émettait une ligne **par trame perdue** :
mesuré à 190 ms et 200 000 notifications de l'UI Ink pour 200 000 trames, soit
un ralentissement auto-infligé au pire moment. Désormais une ligne à l'ouverture
de l'épisode, un décompte à la reprise.

## Vérification

- `apps/gameserver-ts/src/gateway/upstream.spec.ts` : 7 tests sur de vraies
  sockets UDS — redémarrage de core, ordre des trames de session, plafond du
  buffer, handoff nominal, handoff en échec.
- Stack Docker : `docker restart dofuspixiclient-gamed-1` puis `/health` repasse
  à `buffering:false` en moins de 2 s, et une trame émise pendant la coupure est
  rejouée et traitée par `gamed`.

**Reste à repasser le parcours joueur complet (login → liste des personnages)
manette en main pour clore.**

## Hors périmètre

Le core redémarré a perdu l'état des sessions déjà en jeu. Le gateway relaie de
nouveau, mais un joueur connecté avant la coupure reste sans état côté serveur —
c'est QA-046.
