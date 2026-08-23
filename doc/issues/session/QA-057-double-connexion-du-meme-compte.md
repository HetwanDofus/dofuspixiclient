---
id: QA-057
title: Un même compte pouvait ouvrir autant de fenêtres qu'il voulait
severity: P1
domain: session
type: bug
status: fixed
session: 1
opened: 2026-08-20
closed:
fixed_in: 114ef43db6
related: [QA-046, QA-058]
files:
  - apps/gameserver-ts/src/core/features/auth/login/login.handler.ts
  - apps/gameserver-ts/src/core/features/game/select-character/select-character.handler.ts
  - proto/account.proto
---

## Symptôme

Découvert en testant QA-046 : deux fenêtres se connectent en parallèle sur le
compte `dev`, aucune n'est déconnectée, et elles peuvent piloter **le même
personnage**.

## Cause

Rien ne l'interdisait à aucun étage :

- `login.handler.ts` vérifiait identifiants et bannissement, puis appelait
  `attachAccount` sans chercher si le compte avait déjà une session ;
- les tickets sont bien à usage unique (`redeem` fait `where usedAt is null` →
  `set usedAt`), mais la seconde fenêtre refait un login complet et obtient son
  propre ticket, parfaitement légitime — l'unicité du ticket protège du rejeu,
  pas de la seconde connexion ;
- `select-character.handler.ts` vérifiait que le personnage appartient au compte,
  pas que personne d'autre ne le joue.

Le `SessionRegistry` du core n'était indexé que par `sessionId` : il n'y avait
littéralement nulle part où chercher. Côté base, `markLoggedIn` n'écrit que
`lastLoginAt` / `lastLoginIp`, aucun état « en ligne ».

Le dégât n'est pas théorique : `PlayerPresenceService` indexe `byCharacter`
(personnage → map) et `bySession` (session → personnage). Deux sessions sur le
même personnage écrasent `byCharacter`, et le premier départ laisse une entrée
`bySession` orpheline.

Signe que l'intention était là : `LOGIN_ERROR_ALREADY_ONLINE = 3` existe dans
`proto/account.proto` et le client sait déjà l'afficher (`auth.handler.ts`).
Seul le test côté serveur n'avait jamais été écrit.

## Correctif — 2026-08-20

**On éjecte l'ancienne session, on ne refuse pas la nouvelle** — un joueur
réellement déconnecté doit pouvoir revenir sans attendre l'expiration de
l'ancienne.

Le core sait qui devrait être connecté, le gateway seul possède la socket. Le
core lui envoie donc un `SessionClose` — la trame existait déjà, employée
jusqu'ici seulement dans le sens gateway → core ; elle devient bidirectionnelle,
et dans ce sens signifie « raccroche ». **Aucune régénération `buf`.** Le gateway
traduit le motif en code de fil (`account_taken_over` → **4002**), et le client
réutilise toute la machinerie de QA-046 : pas de reconnexion, modale « Votre
compte a été connecté depuis un autre endroit », retour au login.

L'éjection passe par un point unique, `SessionEvictionService.evictAccount()`,
appelé au login `authd` **et** à la redemption du ticket `gamed` — c'est ce
second point qui remplace réellement une session en jeu. Elle ferme la session
localement, donc le départ du monde emprunte la saga `session.closed` existante,
comme une déconnexion ordinaire.

Garde-fous, tous couverts par des tests vérifiés rouges d'abord :

- **un login raté n'éjecte personne** (mot de passe faux, compte banni, pseudo
  inconnu, ticket refusé). Sans ce garde, connaître un pseudo suffirait à
  déconnecter un joueur à volonté ;
- jamais d'auto-éjection ;
- `restore()` reconstruit l'index par compte après un handoff — sans quoi un
  déploiement bleu/vert désactiverait silencieusement toute la détection ;
- un `accountId` vide n'est jamais indexé (les sessions s'ouvrent anonymes) ;
- pas de boucle : le `sessionClose` que le gateway renvoie tombe sur une session
  déjà retirée ;
- 4002 est non-retryable côté client, donc la fenêtre éjectée ne peut pas éjecter
  l'autre en retour.

## Vérification

Stack Docker, parcours complet login → sélection serveur → ticket : la fenêtre A
est fermée en `4002 account_taken_over` **31 ms** après que B a présenté son
ticket, `/health` reste à `sessions:1`. Un mot de passe faux depuis une seconde
fenêtre laisse la première intacte, et un `docker restart gamed` ferme toujours
en `4001 core_gone` — les deux chemins restent distincts.

**Reste à repasser le parcours joueur complet manette en main pour clore.**

## Hors périmètre — la reprise de session

Après éjection, le personnage quitte le monde et le joueur repasse par le login.
En 1.29 il reprendrait sa partie, combat compris.

Ce n'est pas un défaut introduit ici — le combat est indexé par `sessionId`
(`fight.fighter.ts`, `fight.registry.ts`, et l'audience des diffusions dans
`fight.entity.ts`) et **rien n'écoute `session.closed` côté combat** :
`FightLeaveHandler` ne répond qu'au `GameLeaveRequest` explicite. Une simple
coupure réseau en plein combat laisse déjà un combattant orphelin. L'éjection
ajoute un déclencheur à ce défaut, pas le défaut.

Points d'accroche déjà en place pour ce chantier, **à ne pas défaire** :

- `SessionLeaveSaga.onSessionClosed({ session, reason })` reçoit déjà le motif —
  c'est là que se branchera le délai de grâce ;
- `FightRegistryService.registerSession()` / `unregisterSession()` et
  `Fighter.sessionId`, mutable, permettent de rebrancher un combattant sur une
  nouvelle session ;
- la reprise devra s'accrocher à la **sélection de personnage**, pas au ticket,
  puisqu'au moment du ticket on ne connaît que le compte.
