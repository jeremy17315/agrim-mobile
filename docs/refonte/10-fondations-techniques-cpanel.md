# Livrable 11 — Fondations techniques pour cPanel : Prisma, stock, crons

> Premier lot d'**implémentation** de la refonte. Ce document accompagne le
> code livré dans ce commit, corrige des hypothèses courantes sur Prisma en
> environnement mutualisé, et fixe les décisions techniques exécutables.
> Conception amont : `docs/refonte/01…09`. Migration des données : `08`.

---

## 1. Prisma optimisé cPanel — la vérité sur le pool

### 1.1 Correction d'hypothèse : `connection_limit` est inopérant ici

La configuration d'usage pour mutualisé — `DATABASE_URL=…?connection_limit=3&pool_timeout=10`
— **ne s'applique pas à ce projet** : l'API tourne sous **Prisma 7 avec le
driver adapter `@prisma/adapter-pg`** (`apps/api/src/prisma/prisma.client.ts`).
Dans ce mode, le pool est un **Pool node-postgres créé dans le code** ; les
paramètres `connection_limit`/`pool_timeout` de l'URL sont des reliques du
moteur natif, silencieusement ignorées.

**La conséquence serait grave si on la laissait passer** : qui croit régler
`connection_limit=3` garde en réalité un pool de **10 connexions par
processus** — sur un mutualisé limité à 20–30 connexions PostgreSQL pour
tous les locataires, c'est l'épuisement garanti au premier pic, avec des
erreurs `too many clients` aléatoires et non reproductibles.

### 1.2 Le réglage réel (implémenté)

Le pool se règle dans `prisma.client.ts` via des variables d'environnement
validées (`env.validation.ts`) :

| Variable | Défaut | cPanel recommandé | Rôle |
| --- | --- | --- | --- |
| `PG_POOL_MAX` | 10 | **3** | Taille du pool **par processus** |
| `PG_CONNECT_TIMEOUT_MS` | 5 000 | 5 000 | Échouer vite si la base ne répond pas |
| `PG_IDLE_TIMEOUT_MS` | 30 000 | 30 000 | Rendre vite une connexion oisive |
| `PG_STATEMENT_TIMEOUT_MS` | 20 000 | 20 000 | Aucune requête ne monopolise un slot |

**L'arithmétique qui gouverne tout** :

```
connexions totales ≈ (processus Passenger actifs) × PG_POOL_MAX + marges (CLI, psql, migrations)
```

cPanel ne pilote pas finement le nombre de processus Passenger ; seul le
plafond **Entry Processes** de CloudLinux borne. Avec `PG_POOL_MAX=3` et 5
processus : 15 connexions, marge comprise — tenable partout. **À faire
aussi côté cPanel : régler Entry Processes ≤ 5** (Ressources du compte).

Le `DATABASE_URL` reste simple (la base est co-localisée, pas de TLS local) :

```ini
DATABASE_URL="postgresql://agrim_user:MOTDEPASSE@127.0.0.1:5432/agrim_db?schema=public"
PG_POOL_MAX=3
```

### 1.3 Les trois précautions Prisma restantes sur mutualisé

1. **Transactions bornées** (déjà en place) : `maxWait 15 s / timeout 20 s`
   dans `transactionOptions`. Une transaction qui tient des verrous de stock
   ne doit jamais filer.
2. **Migrations = `prisma migrate deploy` uniquement**, exécutées en SSH
   depuis l'environnement Node du panneau, **après backup** (livrable 08 § 6).
3. **Moteurs Prisma** : générer sur le serveur (`npx prisma generate` dans
   l'environnement de l'app). Si le binaire Debian/OpenSSL de LWS n'était pas
   le `native` du moment du generate, ajouter `binaryTargets` au générateur —
   point à observer au premier déploiement (checklist GO/NO-GO).

---

## 2. Concurrence du stock — stratégie implémentée

### 2.1 La décision : `FOR UPDATE` ordonné + `UPDATE` conditionnel + `CHECK`

Fichier : `apps/api/src/common/stock/reserve-stock.ts`. Trois défenses, dans
une seule transaction :

```
1. SELECT … FOR UPDATE OF v — tri par id (anti-interblocage)
2. UPDATE … SET stock = stock − q WHERE id = x AND stock >= q   (conditionnel)
3. CHECK (stock >= 0) en base — migration fondations
   + journal StockMovement écrit dans la même transaction
```

| Choix | Justification |
| --- | --- |
| `FOR UPDATE` plutôt que la seule lecture conditionnelle | Avec plusieurs lignes par commande, il faut une **fenêtre de verrou unique et cohérente** : prix, stock et poids lus sous verrou font foi pour tout le calcul du checkout. Sans verrou, deux requêtes peuvent lire des mondes différents et calculer des totaux jamais cohérents entre eux |
| Tri par id avant verrouillage | Deux commandes verrouillant A puis B, et B puis A, sont le scénario canonique du deadlock. L'ordre déterministe le rend **structurellement impossible** — pas « rare » |
| `UPDATE` conditionnel quand même | La condition dans le `WHERE` fait arbitrer **PostgreSQL**, jamais une lecture antérieure. Le `count === 0` après coup est un filet qui ne devrait jamais parler |
| `CHECK (stock >= 0)` | Même un bug combinant 1 et 2 ne rend pas le compteur négatif : PostgreSQL refuse la ligne. C'est la défense en profondeur exigée par la mission |
| Journal `StockMovement` simultané | `stockBefore/After` viennent des lignes **verrouillées** — exactes par construction, chaîne vérifiable |

### 2.2 Pourquoi pas `SERIALIZABLE`

L'isolation `SERIALIZABLE` sur l'ensemble du checkout obligerait à rejouer
les transactions sur conflit de prédicat (erreur 40001). Sur un mutualisé
où le rate limiting global est serré et où chaque retry consomme un slot
LVE, la tempête de rejeux coûte plus qu'elle ne protège. Le verrouillage
pessimiste ciblé (quelques lignes de variantes, tenues quelques dizaines de
millisecondes) est déterministe et sans retry.

### 2.3 La preuve attendue

`T-CONC-01` (docs/refonte/09 § 7) : 100 `POST /orders` simultanés, stock = 1
⇒ exactement 1 × `201`, 99 × `409 INSUFFICIENT_STOCK`, compteur final 0,
**une** ligne `COMMANDE` au journal, chaîne `stockBefore=1 → stockAfter=0`.
La suite de course rejoue le scénario 50 fois — un pattern qui échoue une
fois sur 50 est un pattern qui échoue.

---

## 3. Verrou des cron jobs — `cron_locks` implémenté

Fichiers : `common/cron/cron-locks.service.ts`, `common/guards/cron-secret.guard.ts`,
`jobs/` (module, contrôleur, service).

### 3.1 Le schéma

| Colonne | Rôle |
| --- | --- |
| `job` (PK) | Nom du job |
| `lockedAt`, `lockedUntil` | Verrou courant + **bail** |
| `lastRunStartedAt/FinishedAt`, `lastStatus`, `lastError`, `runCount` | Historique d'exécution gratuit |

### 3.2 Acquisition atomique (le cœur)

```sql
INSERT INTO "cron_locks" ("job", "lockedAt", "lockedUntil", "lastRunStartedAt", "runCount", "updatedAt")
VALUES ($1, now(), now() + ($2 * interval '1 second'), now(), 1, now())
ON CONFLICT ("job") DO UPDATE
  SET "lockedAt" = EXCLUDED."lockedAt", "lockedUntil" = EXCLUDED."lockedUntil", …
  WHERE "cron_locks"."lockedUntil" IS NULL OR "cron_locks"."lockedUntil" < now()
RETURNING "job";
```

Une ligne retournée = verrou pris. Zéro ligne = un verrou **vivant** existe :
l'appelant abandonne sans erreur (409 `JOB_ALREADY_RUNNING`). Le `WHERE`
sur `lockedUntil` est ce qui rend le dispositif **supportable par
Passenger** : un processus recyclé au milieu d'un job libère son verrou par
péremption du bail, pas par propreté.

### 3.3 La chaîne complète

```
cPanel cron (*/5 * * * *)
  curl -X POST -H "X-Cron-Secret: …" https://api.domaine/api/v1/jobs/run/reconciliation
      → CronSecretGuard (fail-closed : CRON_SECRET absent ⇒ 503 ; comparaison en temps constant)
      → JobsService.run(job) — registre strict (nom inconnu ⇒ 404)
      → CronLocksService.runExclusive(job, ttl, fn)
          acquisition atomique → fn() → libération + trace (status, erreur)
```

Jobs câblés au premier lot : `reconciliation` (le balayage existant, déjà
idempotent) et `outbox-drain` (réclamation atomique des événements via
`UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)` — deux drains
simultanés se partagent le travail sans jamais doubler un événement ;
back-off exponentiel 1→60 min, abandon tracé à 10 tentatives).

Lignes crontab (aucune logique dans le crontab — il réveille, il ne calcule
pas) :

```cron
*/5 * * * *   curl -sS -X POST -H "X-Cron-Secret: LE_SECRET" https://api.domaine/api/v1/jobs/run/reconciliation  >/dev/null 2>&1
*/10 * * * *  curl -sS -X POST -H "X-Cron-Secret: LE_SECRET" https://api.domaine/api/v1/jobs/run/outbox-drain >/dev/null 2>&1
```

---

## 4. Écarts relevés dans la demande initiale (et arbitrage)

| Point de la demande | Arbitrage retenu |
| --- | --- |
| `DATABASE_URL … connection_limit=3` | **Corrigé** : avec `@prisma/adapter-pg`, le pool se règle par `PG_POOL_MAX` dans le code (§ 1.1) |
| Table `notifications_queue` | Renommée **`outbox_events`** : elle porte des événements **métier** (commandes, paiements), dont les notifications ne sont qu'un consommateur. Le jour où analytics ou facturation y souscrit, le nom reste vrai |
| `cron_locks` | Retenu tel quel — bon nom, implémenté avec un **bail** supplémentaire indispensable à Passenger |
| Sérialisable suggéré pour le stock | Écarté au profit du verrouillage pessimiste ciblé (§ 2.2) — pas de tempête de rejeux sur mutualisé |
| Double écriture temporaire site↔API | **Rejetée** en tant que mécanisme durable (elle recrée la divergence que la refonte tue) ; la transition suit le plan de strangulation par phases de `docs/refonte/08` — le site bascule domaine par domaine, jamais en écrivant dans deux bases |

---

## 5. Carte des fichiers du lot

| Fichier | Contenu |
| --- | --- |
| `apps/api/prisma/schema.prisma` | +6 modèles : `Promotion`, `CronLock`, `OutboxEvent`, `WebhookEvent`, `IdempotencyRecord`, `MessageLog` |
| `apps/api/prisma/migrations/20260918120000_fondations_ssot/` | Tables nouvelles + CHECK (`stock >= 0`, mouvement non nul, cohérence des lignes) + index partiels (1 promotion active/variante, dédoublonnage webhook) — **purement additif** |
| `apps/api/src/prisma/prisma.client.ts` | Pool pg calibré (`PG_*`), timeouts |
| `apps/api/src/common/stock/reserve-stock.ts` | Primitives `lockVariantsForOrder` / `reserveStockForOrder` / `releaseStockForOrder` (+ spec unitaire sur le faux Prisma à clauses évaluées) |
| `apps/api/src/config/stock-mode.ts` | **Commutateur `STOCK_MODE`** (`site`\|`local`, défaut `site`) — la délégation d'`OrdersService` et la branche locale de `cancelOrderAndReleaseStock` |
| `apps/api/src/messaging/*` | **Itération « messaging »** : ports `WhatsappPort`/`EmailPort` (HTTP agrégateur / SMTP nodemailer, pilotes inertes si non configurés), table de routage, `MessagingDispatcher` (handler d'outbox → 3 canaux + `MessageLog`), 8 tests unitaires |
| `apps/api/src/common/cron/cron-locks.service.ts` | Verrou à bail atomique |
| `apps/api/src/common/guards/cron-secret.guard.ts` | Auth cron fail-closed |
| `apps/api/src/jobs/*` | Module jobs : registre, contrôleur, drain outbox |
| `apps/api/src/orders/checkout.service.ts` | Checkout SSOT **câblé derrière `STOCK_MODE=local`** (`OrdersService.create` délègue) : prix/promotions/grille lus sous verrou, outbox, idempotence stricte (rejeu, conflit de corps, course P2002) |
| `apps/api/src/config/env.validation.ts`, `.env.example` | `CRON_SECRET`, `PG_*` |

**Reste aux itérations suivantes** : handlers de diffusion du module
messaging (itération « notifications »), modules `catalog` en écriture et
`backoffice`. Le câblage du checkout est **fait** (voir § 8) mais sous
commutateur — il ne change rien en production tant que `STOCK_MODE=site`.

---

## 8. Le commutateur `STOCK_MODE` — câblage fait, bascule à ne PAS déclencher

Le checkout SSOT est désormais **dans le chemin de production**, derrière un
commutateur explicite (`config/stock-mode.ts`, variable `STOCK_MODE`) :

| Mode | Chemin commande | Chemin annulation |
| --- | --- | --- |
| `site` (défaut, production actuelle) | réservation à distance via `catalog-sync` (inchangé, byte pour byte) | journal local + libération de la réservation chez le site |
| `local` | `CheckoutService` : verrou `FOR UPDATE` → prix/promotions/grille lus **sous verrou** → décrément conditionnel → journal + outbox + `IdempotencyRecord` dans UNE transaction | `releaseStockForOrder` : incrément conditionnel + journal véridique, dans la transaction d'annulation (`order-stock.ts`, point de passage unique — client, gestion et expiration de paiement convergent) |

**Pourquoi un commutateur plutôt qu'une coupure franche** : tant que le site
FastAPI décompte encore son propre compteur, activer `local` créerait deux
stocks pour un même entrepôt — la double vente, pour de vrai. La bascule fait
donc partie de la phase 4 de la migration (`docs/refonte/08`) :

1. le site lit catalogue/stock dans la base centrale (ou par l'API) ;
2. inventaire physique figé saisi (stock initial `ENTREE`) ;
3. **et seulement là** : `STOCK_MODE=local` au `.env`, `restart.txt`, smoke
   tests commande+annulation, surveillance du journal `StockMovement`.

Avant cette phase, la valeur reste `site` — un déploiement qui oublie la
variable ne change rien (défaut sûr). Les tests e2e existants tournent en
mode `site` : le comportement établi ne peut pas régresser par inadvertance ;
la couverture du mode `local` (primitives + `T-CONC-01` sur PG réel) est
définie au livrable 09.

---

## 9. Itération « messaging » — la diffusion découplée est opérationnelle

La boucle de l'outbox est désormais **fermée de bout en bout** :

```
transaction métier → outbox_events → cron outbox-drain (ou drain en ligne)
    → MessagingDispatcher (table de routage)
        ├─ PUSH      → NotificationsService (in-app + pilote push existant)
        ├─ WHATSAPP  → WhatsappPort  (HTTP agrégateur si WHATSAPP_API_URL/TOKEN)
        └─ EMAIL     → EmailPort     (SMTP nodemailer si SMTP_HOST — serveur LWS)
             chaque tentative → MessageLog (SENT/FAILED/SKIPPED + détail)
```

Règles implémentées et testées (`messaging.dispatcher.spec.ts`, 8 tests) :

1. **Routage économe** : le push (gratuit) porte presque tout ; WhatsApp +
   e-mail réservés aux moments qui comptent (`ORDER_CONFIRMED`,
   `PAYMENT_SUCCEEDED`, `ORDER_DELIVERED`). Un seul endroit décide
   (`messaging.routing.ts`).
2. **Idempotence par canal** : clé unique dérivée de l'identifiant
   d'événement (`evt-1:whatsapp`) — un drain rejoué (bail expiré) ne
   renvoie pas deux fois.
3. **Politique d'échec** : tous les canaux actifs en échec ⇒ l'événement
   repart (back-off du drain) ; au moins un canal passé ⇒ événement clos,
   les échecs restent visibles en FAILED (jamais de double envoi des
   canaux déjà partis). Un canal non configuré est SKIPPED — pas une panne.
4. **Aucune coordonnée dans les payloads** : le dispatcher résout
   téléphone/e-mail depuis l'annuaire, pas depuis l'événement.
5. **Pilotes inertes par défaut** : sans configuration, les canaux sont
   sautés sans erreur — le module s'installe partout et s'allume par `.env`.

Limites assumées de l'itération : l'échec partiel ne retente PAS le canal
perdant (reprise manuelle / back-office à venir) ; le push reste le pilote
existant (Expo) — la migration FCM/native reste une itération dédiée
(livrable 03, § 3.5) ; les paniers abandonnés arriveront avec leur job
`abandoned-carts` (il émettra dans la MÊME outbox).

---

## 10. Itération « catalog » — l'écriture du catalogue existe, verrouillée jusqu'à la bascule

Nouveau module `apps/api/src/catalog/` (administration ; le public lit
toujours via `/products` et `/categories`, inchangés) :

| Route | Effet |
| --- | --- |
| `POST /catalog/categories`, `PATCH /catalog/categories/:id` | gammes |
| `POST /catalog/products` (avec variantes), `PATCH`, `DELETE /catalog/products/:id` | « suppression » = retrait du rayon (`isActive`/`isAvailable` à faux — jamais physique : des commandes référencent) |
| `POST /catalog/products/:id/variants`, `PATCH /catalog/variants/:id`, `GET /catalog/variants/:id` | formats, prix de base, seuils, disponibilité ; détail avec **prix effectif** |
| `POST /catalog/promotions`, `PATCH /catalog/promotions/:id`, `GET /catalog/promotions` | prix promotionnel DATÉ (remplace la colonne `originalPrice` figée) |

Règles implémentées et testées (12 tests) :

1. **Verrou de bascule** : toute écriture exige `STOCK_MODE=local` — sinon
   503 `CATALOG_WRITES_ON_SITE`. Écrire avant la bascule produirait des
   modifications silencieusement écrasées par la synchro du site (toutes
   les 15 min) : la pire divergence, celle qu'on ne voit pas.
2. **Promotions exclusives** : UN SEUL prix actif par variante — l'index
   partiel en base tranche ; la création désactive l'existante dans la
   même transaction ; une course concurrente perdante reçoit 409
   `PROMOTION_ALREADY_ACTIVE`. Prix ≥ prix de base ⇒ 400 (pas de faux
   rabais). Dates incohérentes ⇒ 400.
3. **Désactivation en cascade, réactivation non** : désactiver un produit
   retire ses variantes du rayon ; réactiver ne les remet PAS en bloc —
   geste explicite, variante par variante.
4. **L'ajustement de stock existe déjà** (`management/adjustStock` via
   `applyStockChange`, décrément conditionnel + journal) : pas de
   duplication — le back-office l'utilisera tel quel.

### Couplage de bascule (à ne PAS oublier le jour J)

`STOCK_MODE=local` et `SITE_INTEGRATION_URL=` (vide, synchro coupée)
vont ENSEMBLE : une synchro qui continuerait de tourner écraserait prix et
stocks locaux toutes les 15 minutes. Les deux lignes du `.env` changent au
même instant, suivies des smoke tests catalogue.

---

## 6. Invariants de fondations — à ne jamais casser

1. Toute écriture de stock passe par `common/stock` — jamais de
   `update({ data: { stock: … } })` direct ailleurs.
2. Tout job du registre est idempotent **par construction** : le verrou
   réduit les collisions, il ne les rend pas impossibles (bail périmé,
   curl rejoué par un proxy).
3. La diffusion reste post-commit : aucun module métier n'appelle
   WhatsApp/FCM/SMTP — il écrit dans `outbox_events` dans SA transaction.
4. Une migration est **additive ou expand/contract** — jamais destructrice
   dans la release qui cesse d'utiliser la colonne.
5. `CRON_SECRET` reste requis pour tout job : un endpoint de jobs ouvert
   est une administration anonyme.

---

## 7. Correctif CI requis (à appliquer par un mainteneur)

**Constat** : la CI est rouge sur `main` depuis la migration Prisma 7
(job « Lint · typecheck · tests unitaires » échoue à « Générer le client
Prisma »). Cause : Prisma 7 charge `prisma.config.ts` à **tout** appel CLI —
y compris `generate`, qui n'ouvre pourtant aucune connexion — et exige
`DATABASE_URL` à ce chargement. Le job e2e passe parce qu'il définit la
variable ; le job de vérification, non.

Le sandbox de conception ne peut pas pousser de modification de workflow
(permission GitHub `workflows` absente du jeton). **Correctif à appliquer**
dans `.github/workflows/ci.yml`, au job `verification` :

```yaml
  verification:
    name: Lint · typecheck · tests unitaires
    runs-on: ubuntu-latest
    env:
      # Prisma 7 charge prisma.config.ts à tout appel CLI et y exige
      # DATABASE_URL ; generate n'ouvre aucune connexion : valeur factice.
      DATABASE_URL: postgresql://dummy:dummy@127.0.0.1:5432/dummy?schema=public
    steps:
      # … (inchangé)
```

Jusqu'à application : le job de vérification reste rouge (bruit connu),
mais le job **e2e-api** — qui génère le client, applique les migrations sur
un vrai PostgreSQL 17 et exécute les 243 tests — reste la porte de
validation effective de chaque push.
