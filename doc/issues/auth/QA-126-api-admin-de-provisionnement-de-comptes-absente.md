---
id: QA-126
title: L'API admin ne permet pas de provisionner un compte et son premier personnage
severity: P1
domain: auth
type: feature
status: fixed
session: 5
opened: 2026-08-29
closed:
fixed_in:
related: [QA-057, QA-125]
files:
  - apps/gameserver-ts/src/gateway/http.ts
  - apps/gameserver-ts/src/gateway/admin-accounts.ts
  - apps/gameserver-ts/src/gateway/rate-limiter.ts
  - apps/gameserver-ts/src/gateway/main.ts
  - apps/gameserver-ts/src/core/features/auth/password-key.ts
  - apps/gameserver-ts/src/core/features/auth/provision-account
  - apps/gameserver-ts/src/core/modules/maps/spawn-point.ts
  - apps/gameserver-ts/migrations/0055_admin_account_provisioning.ts
  - apps/gameserver-ts/scripts/dev-seed.ts
  - apps/gameserver-ts/test/integration/provision-account.int.spec.ts
  - doc/data-seeding.md
---

## Symptôme

Le gateway protège déjà `/admin/*` avec `GATEWAY_ADMIN_TOKEN`, mais sa seule
opération est le handoff d'un upstream. Un plan de contrôle autorisé comme
DofBotConsole ne peut donc pas créer un compte de jeu et son premier
personnage avant de lancer une session automatisée.

Le seul flux disponible est `scripts/dev-seed.ts`. Il suppose un accès shell
au checkout et à PostgreSQL, mélange provisionnement et données de
démonstration, n'est pas idempotent à l'échelle d'une requête distante et ne
constitue pas un contrat consommable par un logiciel externe. DofBot ne doit
ni exécuter ce script ni écrire directement dans la base `dofus`.

## Attendu

Exposer `POST /admin/accounts` sur le gateway. La route n'existe que lorsque
`GATEWAY_ADMIN_TOKEN` est configuré et réutilise le middleware
`x-admin-token` existant. Elle crée atomiquement :

- le compte et son pseudonyme ;
- son rattachement au serveur demandé, ou au seul serveur sélectionnable si
  `serverId` est omis ;
- son premier personnage avec les valeurs initiales normales du jeu ;
- les caractéristiques, sorts et relations annexes nécessaires pour que le
  personnage puisse être sélectionné immédiatement.

La logique de création doit appartenir à un service d'authentification
réutilisable. `dev-seed.ts` peut le consommer, mais l'API ne lance jamais un
processus shell et ne recopie pas une deuxième implémentation des règles.

## Contrat HTTP

En-têtes obligatoires :

```http
X-Admin-Token: <secret>
Idempotency-Key: <uuid>
Content-Type: application/json
```

Corps :

```json
{
  "username": "bot-astrub-01",
  "passwordKey": "<base64 PBKDF2-SHA256 sur 32 octets>",
  "pseudo": "Bot Astrub 01",
  "serverId": 1,
  "character": {
    "name": "BotAstrub",
    "breedId": 8,
    "sex": 1
  }
}
```

`passwordKey` suit exactement la dérivation utilisée par le client officiel :
PBKDF2-SHA256, 600 000 itérations, sel
`sha256("dofus:" + username.toLowerCase())`, sortie de 32 octets en base64.
Le serveur la hache avec le mécanisme normal de `accounts.pwd_hash`. Le mot de
passe brut ne traverse pas cette API et la clé dérivée n'est jamais stockée ni
journalisée en clair.

Réponse `201 Created` :

```json
{
  "account": { "id": "101", "username": "bot-astrub-01" },
  "character": { "id": "202", "name": "BotAstrub" }
}
```

Une répétition avec la même `Idempotency-Key` et le même corps renvoie le même
résultat sans créer de doublon. La clé et une empreinte du corps sont
persistées dans la transaction de provisionnement. La réutilisation de la clé
avec un autre corps renvoie `409 Conflict`.

Codes attendus :

- `400` pour un JSON mal formé ;
- `401` ou `403` pour un jeton absent ou invalide ;
- `409` pour un nom de compte, pseudonyme ou personnage déjà pris, ainsi que
  pour une clé idempotente réutilisée avec un autre corps ;
- `422` pour une classe, un sexe, un serveur ou une clé PBKDF2 invalide ;
- `201` pour une création et `200` pour la répétition idempotente réussie.

Les erreurs suivent `{ "error": "code_stable", "message": "..." }` et ne
contiennent aucun secret.

## Sécurité et exploitation

- Comparer le jeton admin sans fuite temporelle et ne jamais le journaliser.
- Ne pas activer la route lorsque `GATEWAY_ADMIN_TOKEN` est absent.
- Valider que `passwordKey` est un base64 canonique décodant exactement 32
  octets.
- Limiter la taille du corps et le débit de la route.
- Journaliser l'identifiant de requête, le résultat et les identifiants créés,
  jamais le jeton ni la clé de mot de passe.
- Conserver l'API hors du protocole joueur et des WebSockets `/auth` et
  `/game`.

## Vérification

- Un test d'intégration crée un compte et un personnage dans une base vide,
  puis se connecte via `/auth`, sélectionne le serveur et retrouve ce
  personnage.
- Deux requêtes concurrentes portant la même clé ne produisent qu'un compte et
  un personnage et renvoient le même résultat.
- Un second corps avec la même clé retourne `409` sans mutation.
- Un nom déjà pris retourne `409` sans laisser de lignes partielles.
- Une panne au milieu de l'initialisation annule toute la transaction.
- Les tests prouvent que ni `passwordKey` ni `X-Admin-Token` n'apparaissent
  dans les logs, erreurs ou réponses.

## Correctif — 2026-08-29

Les règles vivent dans
`src/core/features/auth/provision-account/provision-account.service.ts`, une
classe sans framework qui prend un `Kysely<DB>`. Toute la création tient dans
**une transaction** : compte, `account_servers`, personnage, `player_stats`,
`player_colors`, sortilèges de classe, puis la ligne d'idempotence. Un
personnage listé mais injouable — sans stats, sans sorts — est pire que pas
de personnage du tout, donc le succès partiel n'est pas un état que cette API
peut laisser derrière elle.

La route `POST /admin/accounts` (`src/gateway/admin-accounts.ts`) ne fait que
traduire : en-têtes et JSON à l'entrée, statut HTTP à la sortie. Elle n'est
enregistrée que si `GATEWAY_ADMIN_TOKEN` est présent, et seulement si le
gateway a aussi un `DATABASE_URL` — sinon il refuse de démarrer plutôt que de
servir un 404 sur une API qu'un opérateur croit avoir armée. C'est la seule
chose que le gateway fait de lui-même ; il ouvre cette connexion pour cette
route et pour rien d'autre.

`dev-seed.ts` consomme les mêmes primitives (`derivePasswordKey`,
`hashPasswordKey`, `findSpawnCell`, `grantClassSpells`) : une seule
implémentation de la dérivation PBKDF2, du choix de cellule de spawn et du
grimoire de classe. Aucun processus shell n'est lancé par l'API.

### Idempotence

Migration 0055, table `provisioning_requests`. La ligne est **réclamée en
premier**, dans la transaction qui crée ensuite le compte : deux appels
concurrents portant la même clé se sérialisent sur la clé primaire, le
perdant attend l'insertion spéculative, voit la ligne committée et rejoue le
résultat. `account_id` / `character_id` sont donc nullables — ils sont
remplis à la fin de cette même transaction, si bien qu'une ligne *visible* les
a toujours, et qu'une tentative annulée ne laisse rien.

`request_hash` est un SHA-256 du corps normalisé : la clé dérivée n'est jamais
persistée en clair, et une clé réutilisée avec un autre corps est un bug
d'appelant, pas un rejeu — `409`.

Le même correctif ajoute un index unique sur `lower(pseudo)` : le contrat
promet `409` pour un pseudonyme pris, et un `SELECT` ne peut pas tenir cette
promesse sous concurrence.

### Sécurité

- `x-admin-token` comparé par `timingSafeEqual` — le `!==` précédent fuyait le
  secret caractère par caractère, et il protégeait déjà `/admin/handoff` ;
- `passwordKey` validée par forme (base64 canonique, 43 caractères + `=`,
  décodant exactement 32 octets) parce que `Buffer.from(x, "base64")` avale
  n'importe quoi et provisionnerait un compte auquel personne ne peut se
  connecter ;
- corps plafonné à 8 Kio (`413`), 20 appels par minute et par appelant
  (`429`) ;
- une erreur inattendue n'est jamais renvoyée telle quelle : elle peut citer
  la requête SQL, et la clé dérivée traverse certaines d'entre elles.

### Note de schéma

`schema.ts` marque désormais `Generated<>` les colonnes de `accounts`,
`players`, `player_stats` et `player_colors` qui ont une valeur par défaut en
base. C'est la description exacte du schéma, et c'est ce qui permet de créer
un personnage en n'écrivant que ce qui fait *ce* personnage-là plutôt que de
recopier les défauts des migrations.

## Vérification

Tests : 20 unitaires sur le contrat, 17 sur la route (`bun test src/`, 504
passants au total), 13 d'intégration sur postgres réel (`bun run
test:integration`, 60 passants au total). Ils couvrent la création, le rejeu
idempotent, deux appels **concurrents** sur une même clé qui ne produisent
qu'un compte, la même clé avec un autre corps qui renvoie `409` sans
mutation, chaque nom déjà pris sans ligne partielle, la carte de spawn
absente qui annule tout, et l'absence de la clé et du jeton dans les
messages d'erreur comme dans la ligne persistée.

Passe manuelle sur une base neuve (`dofus_qa126`), gateway lancé avec
`GATEWAY_ADMIN_TOKEN` et `DATABASE_URL` :

| Appel | Réponse |
|---|---|
| sans jeton | `403 forbidden` |
| création | `201 {"account":{"id":"3",…},"character":{"id":"3",…}}` |
| même clé, même corps | `200`, mêmes identifiants |
| même clé, autre corps | `409 idempotency_key_reuse` |
| nom repris, autre clé | `409 username_taken` |
| `breedId: 42` | `422 invalid_request` |
| `passwordKey: "hunter2"` | `422 invalid_password_key` |
| JSON invalide | `400 invalid_json` |
| sans `Idempotency-Key` | `400 missing_idempotency_key` |

Le compte créé se vérifie ensuite avec la dérivation du client
(`Bun.password.verify(passwordKey, pwd_hash)` → vrai), a bien son
`account_servers` à `character_count = 1`, son personnage sur une cellule
walkable (239, pas le 319 par défaut) et ses 3 sorts de niveau 1. Ni le jeton
ni la clé n'apparaissent dans le journal du gateway.

`bun run scripts/dev-seed.ts` rejoué deux fois sur cette base donne le même
résultat qu'avant le correctif.

**Reste à repasser le parcours complet manette en main** — login `/auth`,
sélection du serveur, sélection du personnage — avec un compte créé par
l'API. Les tests d'intégration exécutent les requêtes exactes des trois
handlers concernés, pas les WebSockets.
