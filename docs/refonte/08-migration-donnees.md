# Livrable 9 — Stratégie de migration des données

> Objectif : transformer **deux bases** (site FastAPI : 21 tables en français,
> PostgreSQL en prod / SQLite en dev ; application : 25 modèles en anglais,
> PostgreSQL) en **une seule base centrale**, **sans perte, sans contradiction
> résiduelle et sans interruption de service notable**.
> Contrainte de fond : les deux sources se contredisent par construction
> (stocks différents, statuts hétérogènes, comptes séparés) — la migration
> doit donc **arbitrer**, pas additionner.

---

## 1. Principes non négociables

1. **Aucune perte** : tout enregistrement historique migre, ou est explicitement
   **archivé** (export horodaté conservé), ou est refusé avec **motif tracé**.
   Aucun silence.
2. **Traçabilité d'origine** : chaque objet migré porte son origine —
   `legacySource ∈ {WEB_SITE, MOBILE_V1}` + `legacyReference` (référence
   d'origine conservée, indexée). Un client qui appelle avec « sa » référence
   de l'ancien site doit retrouver sa commande.
3. **Idempotence totale des scripts** : relancer une passe n'insère jamais
   deux fois (clés naturelles + `legacyReference` uniques par source).
4. **Dry-run d'abord** : chaque passe s'exécute en mode `--dry-run` (rapport
   sans écriture) sur **une copie anonymisée des prod**, avant exécution réelle.
5. **Anciens systèmes intacts et en lecture seule** pendant toute la période
   d'observation : le retour arrière est un simple re-pointage, pas une
   restauration.
6. **Arbitrage documenté** : chaque règle de transformation (§ 4) est relue et
   signée par le métier AVANT exécution.

---

## 2. Vue d'ensemble : migration par strangulation en 6 phases

```
Phase 0        Phase 1         Phase 2        Phase 3         Phase 4         Phase 5
PRÉPARATION →  CATALOGUE +  →  COMPTES +   →  HISTORIQUE   →  BASCULE      →  DÉCOMMISSION
               SOCLE CENTRAL   ADRESSES       (commandes,     (cutover)        (observation
                               (dédup.)       paiements,                       30 j puis
                                              avis, stock)                     extinction)
```

Chaque phase a un **critère de sortie mesuré** (§ 6) ; une phase ne démarre
que si la précédente est validée. Les phases 1–3 se font **sans toucher aux
systèmes en production** : elles alimentent la base centrale en parallèle
(les sources restent les maîtres jusqu'au cutover).

| Phase | Durée indicative | Systèmes en service |
| --- | --- | --- |
| 0. Préparation (recette, copies, mapping signé) | 1 sem | anciens (inchangés) |
| 1. Socle + catalogue | 1 sem | anciens (inchangés) |
| 2. Comptes & adresses | 1 sem | anciens (inchangés) |
| 3. Historique (commandes, paiements, avis, stock initial) | 1–2 sem | anciens (inchangés) |
| 4. **Cutover** (fenêtre de gel 2 h, nuit) | 1 nuit | centrale seule dès l'aube |
| 5. Observation puis extinction | 30 j | centrale (+ anciens en lecture seule) |

---

## 3. Outils et environnement

| Élément | Choix |
| --- | --- |
| Scripts de migration | **TypeScript, dans le dépôt** (`tools/migration/`), réutilisant `@agrim/contracts` et Prisma — mêmes types que l'API, zéro divergence de mapping |
| Lecteurs sources | `pg` direct pour le site (PostgreSQL prod), `better-sqlite3` pour la copie SQLite dev (utile aux répétitions) |
| Exécution | depuis la recette cPanel (même réseau que la base cible) ; **jamais** depuis un poste dev vers la prod |
| Mode | `--dry-run` (rapport CSV : insérés, fusionnés, rejetés+motif, écarts) puis `--commit` |
| Journal | table `MigrationRun` (fichier + base) : passe, date, paramètres, compteurs, checksums d'entrée/sortie |
| Sécurité des sources | **dumps complets** des deux bases pris AVANT la première exécution, et re-pris avant le cutover |

---

## 4. Règles de transformation (le contrat de mapping)

### 4.1 Catalogue — le site fait foi (déjà la règle aujourd'hui)

| Source (site) | Cible | Règle |
| --- | --- | --- |
| `gammes` (EBE, DIE, DJA, DV, ROY, SIK) | `Category` | correspondance **par code** (l'ex-`sourceCode` sert de clé de migration, puis est abandonné) ; à défaut de correspondance : création |
| `produits` (reference RB-XX-NN) | `Product` + `ProductVariant` | 1 produit site = 1 variante (le site vend des références) ; `reference` → `sku` ; correspondance avec l'existant mobile par `sourceRef` — **prix site retenu** (prix barre/promo → `Promotion` si `prix_barre` présent) |
| stock site | **nié** | voir 4.5 : le stock initial de la base centrale vient d'un **comptage physique**, pas des compteurs des deux systèmes |

### 4.2 Comptes — dédoublonnage par téléphone

Le téléphone est l'identifiant naturel (déjà la règle des deux côtés) :

```
Clé de fusion : numéro normalisé (+225, espaces/traits retirés)

clients (site)  ┐
                ├─→ même téléphone ⇒ UN SEUL User
User (mobile)   ┘     - rôle CLIENT ; mots de passe : IMPOSSIBLE à fusionner
                      (hashs de deux systèmes : argon2 mobile vs site)
                      ⇒ mot de passe temporairement null
                        → réinitialisation obligatoire à la première connexion
                          (forgot-password, canal téléphone/e-mail)
                      - e-mail : conservé si libre, sinon marqué en conflit
                        (rapport) — jamais écrasé silencieusement
                      - parrainage : conservé côté mobile (le site n'en a pas) ;
                        si le compte site fusionné est plus ancien, il devient
                        le compte principal (createdAt d'origine conservé)
```

| Source | Cible | Notes |
| --- | --- | --- |
| `clients` (site) + `User` (mobile) CLIENT | `User` (fusion) | rapport de fusion nominatif ; conflits listés, jamais arbitrés en silence |
| `utilisateurs` (site, personnel) | `User` rôles GESTIONNAIRE/ADMIN/DG selon matrice LWS fournie par le métier | reset mot de passe systématique (comptes à privilèges) |
| `adresses`/adresses site | `Address` | dédoublonnées par (user, label) ; GPS conservé quand présent |
| `livreurs` | `User` rôle LIVREUR | |

### 4.3 Commandes & historique — traduction des vocabulaires

**Traduction des statuts** (table officielle, signée métier — héritée de
`STATUS-MODEL.md`) :

| Statut site | Statut mobile | → Statut central | Remarque |
| --- | --- | --- | --- |
| `en_attente_paiement` | `PENDING` | `PENDING` | voir règle paiements en vol (4.4) |
| `a_preparer` | `CONFIRMED` | `CONFIRMED` | |
| `en_preparation` | `PREPARING` | `PREPARING` | |
| — | `READY` | `READY` | le site n'a pas cet état : jamais produit par la migration site |
| `en_livraison` | `OUT_FOR_DELIVERY` | `OUT_FOR_DELIVERY` | les `tournees` actives deviennent `Delivery` `IN_TRANSIT`/`ARRIVED` selon avancement |
| `livree` | `DELIVERED` | `DELIVERED` | |
| `annulee` | `CANCELLED` | `CANCELLED` | |

Règles :

- **Références** : `CMD-2026-NNNNN` central (nouveau compteur) ;
  `legacyReference` = référence site ou référence mobile — deux commandes ne
  se fusionnent **jamais** (web ≠ mobile : clients distincts, paniers distincts).
- **Lignes** : les montants figés d'origine sont **conservés tels quels**
  (`subtotal/deliveryFee/total`, `unitPrice`) — on ne recalcule **jamais** un
  historique ; l'incohérence éventuelle d'origine est historique, la
  contrainte CHECK ne s'applique qu'aux nouvelles lignes (migration SQL
  appliquée **après** validation des données migrées, ou données rejetées
  avec rapport si incohérence totale).
- `OrderItem.productName/variantLabel` : figés depuis les libellés d'origine.
- **Avis** (`avis` site vs `ProductReview` mobile) : fusion par
  (produit mappé, client fusionné) ; si les deux existent → **le plus récent
  gagne**, l'autre archivé dans le rapport (le produit central n'accepte qu'un
  avis par couple).
- `OrderEvent` reconstruits : un événement unique `MIGRATED` portant le statut
  d'origine (l'historique fin des transitions n'existe pas côté site).

### 4.4 Paiements — la règle la plus sensible

| État à l'instant du cutover | Traitement |
| --- | --- |
| `SUCCEEDED`/payée (les deux sources) | migrée `SUCCEEDED`, `providerTxId` conservé, `legacySource` posé |
| En attente depuis **> fenêtre d'expiration** | **expirée** (`EXPIRED`) + commande `CANCELLED` — pas de re-vérification d'une transaction trop ancienne : elle n'est plus réglable côté opérateur |
| En attente **récente** (fenêtre ≤ 48 h) | re-vérification **réelle** auprès de CinetPay (`/check` sur `providerTxId`) pendant la fenêtre de gel ; réglée ou échue selon la réponse ; irrésoluble ⇒ `CANCELLED` + note client (e-mail/SMS) |
| Remboursements site | migrés `REFUNDED` |

**Interdiction** : créer un `Payment` central qui ne correspond pas à une
réalité opérateur vérifiable. En cas de doute : annulation + compensation
manuelle tracée, jamais une écriture de foi.

### 4.5 Stock — l'arbitrage physique

Les deux compteurs se contredisent structurellement (chacun entamé par ses
propres ventes). **Aucun des deux ne migre.**

```
Stock initial base centrale = COMPTE PHYSIQUE DE RÉFÉRENCE
  (inventaire réel, saisi dans le back-office via /inventory/adjust)
  - effectué la semaine du cutover, figé le jour J
  - saisit ENTRÉE initiale par variante → StockMovement(ENTREE, reason="Stock initial migration")
  - l'écart vs compteurs d'origine est documenté dans le rapport de migration
  - commandes en vol au cutover (PENDING→CONFIRMED conservées) sont
    DÉDUITES de la saisie (le compteur physique inclut leur marchandise,
    encore en entrepôt : elles seront décrémentées à la bascule de statut)
```

C'est la seule source qui ne peut pas mentir — et le journal `StockMovement`
fait le reste traçable pour toujours.

### 4.6 Livraisons, producteurs, divers

| Source | Cible | Notes |
| --- | --- | --- |
| `tournees` terminées site | `Delivery` `DELIVERED` (closureMode `MANAGER_OVERRIDE`, reason `MIGRATION`) | pas d'OTP rétroactif |
| courses en vol au cutover | **fenêtre de gel** : on attend leur clôture dans l'ancien système avant la passe (livraisons nocturnes rares ; sinon clôture d'exception manuelle tracée) | |
| Producteurs/récoltes (mobile) | inchangés (déjà centraux) | |
| Journal/paiements/messagerie site | `AuditLog` / `MessageLog` (origine `WEB_SITE`) | volume faible |
| Fichiers (visuels site) | téléchargés → `storage/` + `FileAsset` (URLs réécrites) | les images ne restent jamais référencées chez l'ancien hébergeur |

---

## 5. La fenêtre de cutover (Phase 4) — minute par minute

Fenêtre cible : **nuit, 02:00–04:00** (très basse activité, aucune tournée).

| T+ | Action |
| --- | --- |
| 02:00 | Anciens systèmes passent **lecture seule** (maintenance page site ; app mobile v1 : écran « mise à jour requise ») — les crons anciens sont désactivés |
| 02:00 | Re-dumps finaux des deux sources (retour arrière garanti) |
| 02:10 | Passe delta comptes/commandes : re-synchronisation de tout ce qui a bougé depuis la passe 3 (idempotence : seules les nouveautés entrent) |
| 02:30 | Re-vérification CinetPay des paiements récents en vol (4.4) |
| 02:45 | Passe stock : saisie du comptage physique figé ; déduction des commandes en vol confirmées |
| 03:00 | **Rapport de cohérence automatique** (§ 6) — GO/NO-GO |
| 03:05 | GO : `prisma migrate deploy` final (contraintes CHECK etc. déjà en place dès la phase 1), activation des crons cPanel centraux, FCM actif |
| 03:10 | Bascule DNS/routage : site + back-office nouveaux (SPA déjà déployées), API `api.` déjà en place — le **mobile Flutter** n'est pas encore en store : publication Play Store lancée à J+0 (les testeurs ont l'APK) |
| 03:30 | Smoke tests E2E de production (catalogue, commande `simulation` annulée, health) |
| 04:00 | Ouverture commerciale (site + back-office actifs ; app store en diffusion progressive) |

**Rollback** : jusqu'à T+03:00 (GO), retour = remise en service des anciens
systèmes (lecture seule → lecture/écriture), base centrale abandonnée pour
la passe. Après GO : les anciens restent disponibles en lecture seule 30 j —
un défaut de donnée se corrige dans la centrale à partir des dumps, jamais
par une re-bascule (le trafic ne revient pas en arrière).

---

## 6. Critères de sortie mesurés (GO/NO-GO et validation de phase)

Chaque passe produit un rapport ; les compteurs doivent s'égaliser **exactement** :

| Contrôle | Attendu |
| --- | --- |
| Comptages par table source ↔ cible | `insérés + fusionnés + rejetés(motif) + archivés = total source` — par table, zéro écart inexpliqué |
| Sommes financières | `Σ total commandes migrées (par statut)` identique aux sources ; `Σ paiements SUCCEEDED` identique |
| Clients fusionnés | chaque téléphone source résout vers exactement 1 `User` central (aucun doublon résiduel, testé en SQL sur la cible) |
| Références | chaque référence commande site/mobile retrouvée via `legacyReference` (échantillon aléatoire 100 % + sondes métier) |
| Stock | chaque variante a **exactement une** écriture `ENTREE` initiale ; journal continu (chaînes `stockBefore/After`) |
| Statuts | aucune commande hors vocabulaire central (enum check) ; répartition par statut comparable aux sources |
| Intégrité structurelle | toutes les contraintes CHECK/index partiels du livrable 4 vérifiées (`NOT VALID → VALIDATE`) |
| Tests E2E recette sur données migrées | suite du livrable 10 au vert sur la recette **rechargeable depuis les copies prod** |

Le NO-GO de la phase 3 (historique) ne bloque pas le projet : les phases sont
indépendantes et réexécutables ; seule la fenêtre de cutover exige le GO
complet.

---

## 7. Cas particulier : l'application mobile v1 (Expo)

- Selon la documentation du dépôt, seuls des **APK de test** ont circulé
  (aucune publication store attestée) — à confirmer avant la phase 4.
- **Si test uniquement** (hypothèse retenue) : la v1 Expo meurt à la fenêtre
  de cutover (écran « mise à jour requise » servi par l'ancienne API en
  lecture seule pendant 30 j), les testeurs passent à l'APK Flutter.
- **Si publication store existait** : conserver un **mode compatibilité**
  minimal (l'ancienne API NestJS relit la base centrale en lecture seule via
  des vues de compatibilité) le temps du retrait de la version — coût connu,
  planifié seulement si le cas se confirme.
- Les comptes mobiles v1 (argon2, refresh tokens) : les refresh tokens ne
  migrent **pas** (tout le monde se reconnecte — clean slate sécuritaire).

---

## 8. Checklist d'exécution (le jour J)

1. Dumps finaux des deux sources (vérifiés par restauration sur recette).
2. Anciens systèmes en lecture seule ; crons anciens OFF.
3. `tools/migration run --phase=delta --commit` (comptes + commandes delta).
4. Re-vérification CinetPay paiements en vol récents.
5. Saisie stock initial (comptage figé) via back-office.
6. Rapport de cohérence (§ 6) relu à deux — **GO/NO-GO signé**.
7. `prisma migrate deploy` ; crons centraux ON ; FCM ON.
8. Bascule SPA (déjà déployées, activation) ; publication store lancée.
9. Smoke tests production ; monitor `/health` au vert.
10. Anciens systèmes : lecture seule, alerte « mise à jour requise », 30 jours
    d'observation, puis extinction (dumps archivés 5 ans — obligation légale
    comptable).
