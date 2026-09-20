# Livrable 10 — Plan de tests complet

> Objectif : **prouver** que l'architecture tient ses promesses — prix et
> montants toujours serveur, dernier article vendu une seule fois, paiement
> jamais validé par le client, OTP jamais divulgué au livreur, idempotence
> partout — **et** que la migration n'a rien perdu. Le dépôt part d'une
> excellente base : **481 tests au vert** (243 API, 238 mobile) ; le plan les
> transforme en une pyramide couvrant la cible complète.

---

## 1. Principes

1. **Les invariants d'abord** : chaque règle non négociable (livrables 2–7)
   a une preuve automatisée nominative ; une régression est un test rouge,
   pas une revue.
2. **Pyramide** : unitaires rapides (majorité) → intégration sur PostgreSQL
   réel (contraintes SQL ne se prouvent qu'en SQL) → E2E bout en bout →
   charge/concurrence (scénarios ciblés, pas un tintamarre aléatoire).
3. **Zéro simulacre sur les points critiques** : le stock se teste contre un
   **vrai PostgreSQL** avec de vraies requêtes HTTP simultanées (le dépôt
   l'a déjà prouvé : « requêtes HTTP réellement simultanées » — ce pattern
   devient une suite dédiée). CinetPay est simulé à la couche HTTP (nock),
   jamais en remplaçant le service.
4. **CI bloquante** : tout ce qui est ci-dessous en « gate » empêche merge et
   déploiement.

---

## 2. Héritage des 481 tests existants

| Suite actuelle | Destinée à devenir |
| --- | --- |
| 243 API (Jest + Supertest, dont `flows.e2e`, `security.e2e`, stock, OTP, paiements, RBAC) | **Conservées et étendues** : les patterns (machines à états, arbitrage d'annulation, décrément conditionnel, 5 conditions OTP) sont exactement ceux de la cible. S'y ajoutent : promotions, factures, outbox, jobs, webhooks dédoublonnés |
| 238 mobile (Jest + RNTL) | **Inventaire de scénarios → réécriture Flutter** : chaque scénario devient un test unitaire Dart, widget test ou `integration_test`. La logique réseau (`client.ts`, refresh), panier (`cart.ts`), écrans critiques ont leur équivalent Dart nominatif |
| CI 2 jobs (`verification` sans base + `e2e-api` avec PostgreSQL éphémère) | **Conservée, étendue** à 3 jobs : `verification` (lint/typecheck/unit), `e2e-api` (PostgreSQL service), `flutter` (analyze/test/integration en émulateur, nightly) |

---

## 3. Environnements et outillage

| Besoin | Outil | Note |
| --- | --- | --- |
| Base des tests d'intégration | **PostgreSQL 17 réel** (service GitHub Actions en CI ; instance recette cPanel ailleurs) | `migrate deploy` avant suite ; base jetable |
| Faux CinetPay | `nock` sur les deux endpoints (`/v2/payment`, `/v2/payment/check`) + `SimulationProvider` pour les E2E complets | le mock est **à la frontière réseau**, le service réel tourne |
| Faux FCM/WhatsApp/SMTP | serveurs HTTP stubs (nock) ; `PUSH_ENABLED=false` en CI | l'Outbox et le dispatcher réels tournent et sont vérifiés en base (`MessageLog`) |
| Charge & concurrence | **k6** (scénarios versionnés `tools/loadtests/`) + scripts Node de concurrence pure | charge seulement en recette cPanel (pas sur le runner CI) |
| Temps | `jest.useFakeTimers` / injection d'horloge pour TTL (OTP 60 min, expiration paiements) | aucun `sleep` dans les tests |
| Flutter | `flutter_test` (unit/widget), `integration_test` (E2E), `mocktail` | |

---

## 4. Tests unitaires (gate CI — cible < 3 min)

| Module | Cas obligatoires |
| --- | --- |
| `contracts` (règles) | `effectivePrice` (promo datée, promo expirée, sans promo), tarifs livraison (normalisation ville : « Bouaké » = « bouake », inconnue → zone **par défaut, jamais la moins chère**), livraison offerte par poids (seuil 0 = off), calcul panier, config OTP |
| `orders.service` | recalcul intégral depuis la base (le corps ne contient aucun montant), refus référence non vendable, application crédit plafonnée au solde, références séquentielles sans collision, transitions interdites |
| `stock` (pattern) | décrément conditionnel (échec ⇒ rollback complet), restitution arbitrée (le perdant ne rend rien), `StockMovement` toujours co-écrit (`stockBefore/After` chaînés), `reason` obligatoire sur AJUSTEMENT |
| `otp.service` | génération CSPRNG (distribution sur 10⁴), codes à zéros initiaux (`0007`), TTL 60 min, 5 tentatives (incrément **avant** réponse), renvoi plafonné/espacé, invalidation à la régénération, hash≠clair, déchiffrement propriétaire seulement |
| `payments.service` | lecture callback CinetPay (16 champs signés — permutations rejetées), `settle` idempotent (second appel sans effet), échec explicite ⇒ annulation + restitution, expiration par délai |
| `messaging` | résolution événement → canaux → destinataires, templates, `MessageLog` écrit même en échec agrégateur, jamais le code OTP dans un payload (scan) |
| `jobs` | idempotence (double déclenchement = un traitement), `JOB_ALREADY_RUNNING`, bornes de configurabilité |
| Flutter (Dart) | modèles tolérants (champs inconnus ignorés), panier local = cache du serveur, `Idempotency-Key` persistée jusqu'au succès, refresh token rotation/rejeu, affichage OTP (groupage « 48 21 », a11y « 4 8 2 1 ») |

---

## 5. Tests d'intégration (gate CI — PostgreSQL réel)

| Famille | Cas |
| --- | --- |
| **Contraintes SQL** (livrable 4) | `CHECK stock >= 0` (une écriture négative est rejetée **par la base**), promo active unique par variante, un seul OTP actif par livraison, dédoublonnage webhook `UNIQUE(provider, externalId)`, `JobRun` unique actif, cohérence ligne (`lineTotal = unitPrice × qty`) |
| Machines à états | toute transition hors graphe ⇒ `409 INVALID_TRANSITION` ; `OrderEvent` écrit à chaque transition ; co-écriture `OTP_VERIFIED`/`Order DELIVERED` |
| **Outbox** | tout `ORDER_CONFIRMED` a son `OutboxEvent` (aucun ordre confirmé sans événement) ; drain en ligne ; reprise par cron après « mort » du process (test : transaction commitée, drain non exécuté, cron rattrape) ; aucune notification sans `MessageLog` |
| Webhooks | rejeu (2e POST = 200 sans effet, un seul settle), signature invalide (REJECTED, 200), montant discordant (IGNORED + alerte), échec puis succès (le succès gagne, l'ordre inverse aussi), `/check` injoignable (paiement reste en attente, réconciliation rattrape) |
| Idempotence | `Idempotency-Key` rejouée = même réponse figée ; même clé + corps différent = `409` ; TTL 7 j |
| RBAC | matrice complète 6 rôles × routes sensibles (héritée de `security.e2e`, étendue aux nouvelles routes `/catalog` écriture, `/inventory`, `/backoffice`, `/jobs`) — y compris « le livreur ne peut pas lire l'OTP d'autrui » et `404` masquant l'existence |
| Jobs/crons | `reconciliation` règle et rend le stock ; `maintenance` purge selon rétention ; double exécution impossible |

---

## 6. Tests E2E (gate CI pour les parcours ; nightly pour l'émulateur)

**API (Supertest, parcours complets)** :

1. Client : inscription → panier → commande (`Idempotency-Key`) → initiation paiement → callback signé → re-vérification → `CONFIRMED` → événements outbox → préparation → `READY` → assignation → course → OTP → `DELIVERED` → facture PDF téléchargeable.
2. Paiement abandonné : initiation → silence → réconciliation → `EXPIRED` → commande `CANCELLED` → stock rendu (vérifié par le journal).
3. Annulation double : client et bureau annulent la même commande simultanément → un seul rendu de stock (arbitrage).
4. Clôture d'exception : course `ARRIVED`, gestion clôture avec motif → livreur reçoit `403` s'il tente la même route.
5. Producteur : déclaration → revue gestion → réception.
6. Back-office : ajustement de stock avec motif → journal lisible ; audit log alimenté.

**Flutter (`integration_test`, nightly sur émulateur)** :

- parcours achat complet contre l'API de recette (provider simulation) ;
- mode avion : catalogue en cache lisible, commande **bloquée** avec message clair, rejeu idempotent au retour du réseau (même `Idempotency-Key`, une seule commande au final) ;
- dictée OTP (affichage groupé, saisie livreur) ;
- espace livreur hors ligne : points GPS captés puis envoyés en batch.

---

## 7. Concurrence — la suite de course critique (gate de release)

**T-CONC-01 · « 100 requêtes simultanées sur le dernier article »** (exigence
explicite de la mission) — protocole exact :

```
Setup   : variante V avec stock = 1 ; 100 utilisateurs de test
Action  : 100 POST /orders simultanés (promesse Promise.all, requêtes HTTP
          réelles contre l'API réelle), chacun avec SA clé Idempotency-Key,
          même variante, quantity = 1
Attendu : exactement 1 réponse 201
          99 réponses 409 INSUFFICIENT_STOCK
          stock(V) = 0 ; COUNT(StockMovement COMMANDE, V) = 1
          COUNT(Order PENDING/CONFIRMED sur V) = 1
          chaîne journal : stockBefore=1 → stockAfter=0, jamais 0→-1
```

Suite associée :

| ID | Course | Attendu |
| --- | --- | --- |
| T-CONC-02 | webhook `SUCCEEDED` **et** réconciliation `EXPIRED` simultanés sur le même paiement | un seul settle gagne ; l'autre journalise `settled=false` ; jamais SUCCEEDED **et** CANCELLED |
| T-CONC-03 | annulation client **et** bureau simultanées | un seul rendu de stock (transition = jeton) |
| T-CONC-04 | deux `verify-otp` simultanés avec le bon code | une seule validation, un seul `DELIVERED`, `attempts` cohérents |
| T-CONC-05 | deux assignations simultanées de la même mission | un gagnant `ASSIGNED`, l'autre `409 DELIVERY_ALREADY_ASSIGNED` |
| T-CONC-06 | deux vérifications OTP dont une mauvaise en premier | la mauvaise incrémente `attempts` (avant réponse), la bonne passe ensuite |
| T-CONC-07 | cron chevauché (double `curl` rapproché) | `409 JOB_ALREADY_RUNNING`, traitement unique |
| T-CONC-08 | rejeu `Idempotency-Key` pendant que la 1re transaction est encore en cours | la 2e attend puis reçoit la même réponse (pas de deuxième commande) |

Méthode : chaque course tourne en boucle (50 exécutions) sur la CI de release
pour éliminer le facteur chance — un pattern de verrouillage qui échoue une
fois sur 50 est un pattern qui échoue.

---

## 8. Charge & performance (recette cPanel, pré-mise en service puis périodique)

| Scénario k6 | Cible (mutualisé LWS, cold start exclus) |
| --- | --- |
| Catalogue public (lecture) : 50 VU, 5 min | p95 < 400 ms, 0 erreur |
| Checkout : 20 VU, 10 min (provider simulation) | p95 < 800 ms, 0 incohérence de stock à l'arrêt |
| Souak léger : 5 VU, 60 min | pas de fuite mémoire, p95 stable |
| Webhook burst : 200 callbacks en 10 s | tous 200, un seul effet chacun, p95 < 500 ms |
| Cold start Passenger | premier appel < 3 s (documenté, hors SLO) |

Garde-fou : le pool Prisma est calibré au **plafond de connexions LWS**
(`connection_limit` bas) ; le test de charge valide que 20 VU n'épuisent pas
le pool. Toute dégradation → throttlage avant scaling fantaisiste.

---

## 9. Sécurité (gate de release — héritière de `security.e2e`)

| Test | Garantie |
| --- | --- |
| Forge de webhook : HMAC modifié, champs permutés, timestamp ancien | rejeté (REJECTED), 200, alerte |
| Bruteforce OTP : 10 000 tentatives automatisées sur un code | 5 max, `OTP_LOCKED`, zéro validation |
| Bruteforce login / reset | throttling par compte + IP, messages non énumérants |
| Rejeu refresh token volé | `REFRESH_TOKEN_REUSED` → toutes sessions révoquées |
| Fuite de logs : grep systématique des sorties de tests | 0 occurrence d'OTP en clair, de secrets, de hash de mots de passe (le dépôt a déjà la pratique : « 0 occurrence » vérifiée) |
| Montant imposé par le client : `POST /orders` avec `total` dans le corps | champ ignoré/refusé — le total servi est celui recalculé (test contre base piégée : prix modifié entre affichage et commande ⇒ commande au prix base) |
| Accès inter-locataires : IDs d'autrui sur 20 routes | 403/404 corrects (matrice) |
| Upload/route fichiers | aucune route statique de `storage/` ; PDF et preuves par routes authentifiées seulement |

---

## 10. Validation de la migration (livrable 9)

| Test | Quand |
| --- | --- |
| Scripts de migration en `--dry-run` sur **copies anonymisées des prod** : rapports de comptages/sommes exacts | chaque phase |
| Jeux d'essai stérilisés (cas limites : doublons de téléphone, statuts site inconnus, paiements anciens) → résultats attendus figés | phase 0 |
| Après charge : SQL de contrôle sur la cible (chaîne `StockMovement` continue, 1 User par téléphone, `legacyReference` résoluble à 100 %) | GO/NO-GO |
| E2E de la § 6 rejoués **sur la recette rechargeable depuis les dumps prod** | pré-cutover |
| Sondes métier post-cutover : commandes d'un échantillon de vrais clients retrouvées, factures régénérées identiques | semaine 1 |

---

## 11. Matrice d'acceptation — exigence de mission ⇒ preuve

| Exigence (mission) | Preuve automatisée |
| --- | --- |
| Prix/stock/montants jamais imposés par le client | § 9 ligne « montant imposé » + § 4 orders + E2E 1 |
| Pas de double vente du dernier article (transactions + verrous) | **T-CONC-01** (+ CHECK SQL § 5) |
| Journal `StockMovement` traçable | § 4 stock + § 5 contraintes (chaîne continue) |
| CinetPay isolé, webhooks idempotents authentifiés, mobile ne valide jamais | § 5 webhooks + § 9 forge + absence de route client (test : 404 sur toute route non déclarée) |
| OTP 4 chiffres serveur, livreur ne le connaît jamais | § 4 otp + § 9 bruteforce/fuite + RBAC « otp d'autrui » |
| Notifications découplées | § 5 outbox (aucun métier n'appelle FCM/WA : test structurel — imports interdits vérifiés par règle lint dédiée) |
| Idempotence sur `/orders`, paiements, webhooks | § 5 idempotence + T-CONC-08 + rejeu webhook |
| RBAC 6 rôles | § 5 matrice complète |
| SSOT (pas de sync) | test structurel : aucun module `catalog-sync`/`SITE_INTEGRATION_*` (échec du build si réintroduit) + E2E prix cohérents multi-canal |

---

## 12. Gates et cadence

| Moment | Exigé |
| --- | --- |
| Chaque push | `verification` : lint strict (0 warning), typecheck, unitaires — vert |
| Chaque PR/merge | `e2e-api` : intégration + E2E API sur PostgreSQL éphémère |
| Nightly | Flutter integration (émulateur) + tests outbox/temps |
| Pré-release (tag) | T-CONC-01→08 en boucle + sécurité + charge recette + migration dry-run |
| Post-release | monitor `/health`, alertes 5xx, taux d'OTP vs overrides, paiements en attente > seuil |

**Critère de fin de phase de développement** : la matrice § 11 entièrement au
vert — c'est elle, et pas un pourcentage de couverture, qui autorise la mise
en service. (La couverture reste suivie : socle existant conservé, aucune
baisse tolérée.)
