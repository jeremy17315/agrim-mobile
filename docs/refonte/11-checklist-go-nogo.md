# Livrable 12 — Checklist GO / NO-GO avant développement et mise en service

> Utilisable telle quelle : chaque ligne dit **quoi vérifier, comment le
> vérifier, et le seuil qui fait basculer en NO-GO**. Trois moments : (A) la
> commande de l'offre LWS, (B) la sonde technique déployée, (C) les tests
> métier minimum avant production. Le GO est **signé**, jamais supposé.

---

## A. Validation de l'offre LWS (avant de payer/engager)

Poser ces questions **par écrit au support LWS**, et exiger des réponses chiffrées.

| # | Point | Comment vérifier | Seuil NO-GO |
| --- | --- | --- | --- |
| A1 | cPanel avec **Setup Node.js App** (Passenger/CloudLinux) | Demander une capture de la fonctionnalité ; ou démo d'essai | Fonctionnalité absente |
| A2 | **Node.js ≥ 20.19** sélectionnable | Liste des versions de l'app Node du panneau | Max < 20.19 (l'API exige ≥ 20.19) |
| A3 | **PostgreSQL** (pas seulement MySQL) | Section « PostgreSQL Databases » du cPanel | Absent ou « bientôt » — **pas de substitution MySQL** (anti double-vente = PG) |
| A4 | `max_connections` PostgreSQL | Demander le chiffre | < 20 (impossible de tenir Passenger × pool + marge) |
| A5 | Cron Jobs | Toujours inclus ; vérifier la granularité | Granularité > 5 min |
| A6 | Accès **SSH/Terminal** | Ouvrir un terminal depuis cPanel | Absent → exiger une procédure support pour builds/migrations |
| A7 | RAM et **Entry Processes** (LVE) | cPanel → Ressources ; demander les plafonds | RAM < 512 Mo ou Entry Processes < 4 (NestJS + Prisma doivent respirer) |
| A8 | Espace disque | Offre | < 5 Go (sources + node_modules + PDF + dumps 30 j) |
| A9 | **TLS automatique** (AutoSSL/Let's Encrypt) | SSL/TLS Status | Absent — webhook CinetPay et FCM exigent HTTPS |
| A10 | Sauvegardes incluses + export possible | Offre | Aucune sauvegarde disque |
| A11 | Répertoire `~` inscriptible hors `public_html` | Test terminal | `.env` et `storage/` doivent vivre hors docroot |

---

## B. Sonde technique (compte cPanel actif, avant d'écrire l'API)

Déployer la sonde minimale : l'API actuelle (ou un `hello-world` NestJS +
un script `pg` de connexion). **Ne rien coder de métier avant que B soit
vert.**

| # | Test | Procédure | Seuil NO-GO |
| --- | --- | --- | --- |
| B1 | L'application Node démarre et répond | Déployer la sonde ; viser `/api/v1/health` en HTTPS | Crash au démarrage, 503 permanent |
| B2 | Prisma + PostgreSQL connectent | `npx prisma generate && migrate deploy` en SSH puis health | Erreur moteur/binaire ; `migrate deploy` en échec |
| B3 | Le pool tient la charge faible | Script : 20 requêtes concurrentes sur la sonde | `too many connections` ; timeouts en rafale |
| B4 | Cold start Passenger | Première requête après 15 min d'inactivité | > 10 s systématique (revoir Entry Processes/RAM) |
| B5 | Cron cPanel exécute | Cron `* * * * *` écrivant un fichier puis appelant `/jobs/run/…` (verrou actif) | Cron absent ; 401/403 sur secret correct |
| B6 | Webhook joignable depuis Internet | `curl -X POST https://api.domaine/api/v1/payments/webhooks/cinetpay` depuis l'extérieur | 4xx/5xx avant même la signature (pare-feu, TLS invalide) |
| B7 | `statement_timeout` et pool configurés | Vérifier la config `PG_*` en place ; une requête longue est coupée | Requête interminable monopolisant un slot |
| B8 | Backup PostgreSQL réalisé puis **restauré** | `pg_dump` via cron + restauration sur base de recette | Dump impossible ; restauration jamais testée |
| B9 | Les logs applicatifs sont accessibles | Setup Node.js App → Log stderr | Aucun accès aux logs (dépannage impossible) |

---

## C. Tests métier minimum avant mise en production (pré-GO définitif)

Sur la recette (même compte, base séparée), avec le code réel :

### C.1 Stock (concurrence)

| # | Test | Attendu |
| --- | --- | --- |
| C1.1 | **T-CONC-01** : 100 `POST /orders` simultanés, stock = 1 | 1 × `201` ; 99 × `409` ; stock final 0 ; 1 ligne au journal ; jamais négatif |
| C1.2 | Rejoué 50 fois (CI de release) | Zéro divergence sur les 50 passes |
| C1.3 | `CHECK` en base : tenter un décrément négatif via psql | Erreur `check_violation` — la base refuse |

### C.2 Paiements CinetPay

| # | Test | Attendu |
| --- | --- | --- |
| C2.1 | Webhook valide (signature correcte, mode test marchand) | Commande `CONFIRMED` ; `WebhookEvent PROCESSED` |
| C2.2 | **Webhook falsifié** (HMAC modifié, champs permutés, montant incohérent) | 200 + statut `REJECTED`/`IGNORED` ; **aucun** effet métier ; alerte au journal |
| C2.3 | **Webhook répété** (même `cpm_trans_id` ×5) | Un seul règlement ; 5 entrées ou rejeus reconnus sans effet |
| C2.4 | **Paiement abandonné** (initiation puis silence) | Le cron `reconciliation` vérifie auprès de CinetPay puis tranche : réglé ou expiré + stock rendu |
| C2.5 | **Paiement déjà confirmé** (webhook pendant que la réconciliation règle) | Un seul `settle` gagne ; jamais `SUCCEEDED` **et** `CANCELLED` |

### C.3 Commandes

| # | Test | Attendu |
| --- | --- | --- |
| C3.1 | Double clic (même `Idempotency-Key` ×2 rapide) | Une seule commande |
| C3.2 | Retry réseau (même clé, quelques minutes plus tard) | Même commande, même réponse |
| C3.3 | Même clé, **corps différent** | `409 IDEMPOTENCY_KEY_CONFLICT` |
| C3.4 | Montant modifié côté client (`total` injecté) | Ignoré — le total servi est le recalcul serveur |
| C3.5 | Prix modifié côté client (`unitPrice` injecté) | Ignoré — prix relu en base |
| C3.6 | Annulation client **et** gestion simultanées | Un seul rendu de stock |

### C.4 OTP livraison

| # | Test | Attendu |
| --- | --- | --- |
| C4.1 | Mauvais OTP ×6 | 5 × `400 OTP_INVALID` puis `429 OTP_LOCKED` ; `attempts` incrémente **avant** réponse |
| C4.2 | Brute force scripté (1 000 essais) | Zéro validation ; verrouillage ; rate limiting |
| C4.3 | Expiration (code de > 60 min) | `410 OTP_EXPIRED` ; régénération possible |
| C4.4 | Réutilisation d'un code consommé | Refus — usage unique |
| C4.5 | Deux validations simultanées avec le bon code | Une seule `DELIVERED` |
| C4.6 | Routes livreur vs code | Le livreur ne peut lire le code par **aucune** route |

### C.5 Autorisations (matrice complète)

| # | Test | Attendu |
| --- | --- | --- |
| C5.1 | 6 rôles × routes sensibles (`/management/*`, `/inventory/*`, `/catalog` écriture, `/backoffice/*`, `/jobs/*`) | Refus `403 FORBIDDEN_ROLE` hors rôles autorisés |
| C5.2 | Accès inter-locataires (IDs d'autrui) | 403/404 corrects (jamais 200) |
| C5.3 | `/jobs/*` sans secret, puis mauvais secret | 503 (non configuré) / 401 |

### C.6 Migration

| # | Test | Attendu |
| --- | --- | --- |
| C6.1 | Scripts en `--dry-run` sur **copies anonymisées des prod** | Comptages et sommes exacts ; zéro écart inexpliqué |
| C6.2 | Re-vérification des paiements en vol auprès de CinetPay | Chaque paiement récent tranché sur la **réalité opérateur** |
| C6.3 | Après charge : SQL de contrôle (chaîne `StockMovement` continue, 1 `User` par téléphone, `legacyReference` résoluble à 100 %) | Zéro écart |
| C6.4 | E2E complets rejoués sur la recette rechargée depuis les dumps | Vert |
| C6.5 | Plan de rollback répété en conditions réelles (re-pointage anciens systèmes ≤ 15 min) | Chronométré, validé |

---

## D. Grille de décision

| Verdict | Condition |
| --- | --- |
| **GO développement** | A1–A9 verts + B1–B7 verts (l'hébergement est prouvé avant d'écrire le métier) |
| **GO recette** | A + B verts, CI verte (`verification` + `e2e-api`), matrice docs/refonte/09 § 11 en cours de remplissage |
| **GO production** | C.1 → C.6 intégralement verts sur la recette + backup restauré + monitor `/health` actif + plan de rollback chronométré |
| **NO-GO immédiat** | Un seul des cas : PostgreSQL indisponible (A3), max_connections < 20 (A4), webhook injoignable après correction (B6), T-CONC-01 divergent (C1.1), un seul paiement falsifié accepté (C2.2), rollback non répété (C6.5) |

**Règle de vie** : cette checklist se re-joue à chaque changement d'offre
LWS, chaque montée de version majeure (Node, Prisma) et chaque année — un
GO vieux d'un an est une supposition.
