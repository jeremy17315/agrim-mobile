# Livrable 8 — Procédure de déploiement LWS / cPanel

> Cible : **un seul serveur mutualisé LWS administré par cPanel**, hébergeant
> l'API centrale (Node.js/Passenger), le site web et le back-office (sites
> statiques), la base PostgreSQL, les fichiers et les crons. Aucun service
> externe requis : ni Railway/Render/Neon, ni Docker, ni worker permanent.
> Principe : **la règle métier vit dans l'API ; cPanel ne fait que la
> réveiller et la surveiller.**

---

## 1. Topologie sur le compte cPanel

```
/home/<compte>/
├── agrim-api/                    # Application Node.js (Passenger) — API centrale
│   ├── .env                      # secrets — chmod 600, HORS de public_html
│   ├── dist/main.js              # fichier de démarrage Passenger
│   ├── storage/                  # preuves, PDF factures, visuels — jamais servis statiquement
│   ├── tmp/restart.txt           # signal de redémarrage Passenger
│   └── (sources + node_modules)
├── backups/                      # dumps PostgreSQL nocturnes (rétention 30 j)
├── public_html/                  # domaine principal : site web boutique (SPA statique)
└── backoffice.domaine.tld →      # sous-domaine : back-office (SPA statique)
api.domaine.tld                   # sous-domaine → racine applicative Passenger
```

| Élément | Hébergement | Technologie |
| --- | --- | --- |
| API centrale | sous-domaine `api.` via **Setup Node.js App** (Passenger) | NestJS + Prisma |
| Site web | `public_html` (ou sous-domaine dédié) | SPA statique compilée, appels `/api/v1` |
| Back-office | sous-domaine `backoffice.` | SPA statique compilée (mêmes API) |
| PostgreSQL | serveur local du compte (cPanel → PostgreSQL Databases) | une seule base |
| Crons | cPanel → Cron Jobs | curl sur les endpoints `/jobs/*` |
| Fichiers | disque du compte, hors `public_html` | via routes authentifiées de l'API |

---

## 2. Prérequis à valider sur l'offre LWS (avant tout engagement)

| Prérequis | Où vérifier | Pourquoi |
| --- | --- | --- |
| cPanel avec **Setup Node.js App** (CloudLinux/Passenger) | liste des fonctionnalités de l'offre ou support LWS | c'est le socle du déploiement API |
| **Node.js ≥ 20** sélectionnable | Application Manager après activation | `engines` du monorepo : ≥ 20.19 |
| **PostgreSQL** (pas seulement MySQL) | section Bases de données du cPanel ou support LWS | SSOT exigée = PostgreSQL — non négociable |
| Cron Jobs | toujours inclus cPanel | réconciliation, outbox, relances, backups |
| Terminal/SSH (même restreint) | fonctionnalité « SSH » ou « Terminal » | build + migrations ; sinon procédure de contournement (§ 4.5) |
| TLS automatique (AutoSSL/Let's Encrypt) | SSL/TLS Status | webhook CinetPay et FCM exigent HTTPS public |
| Espace disque ≥ 5 Go + sauvegardes | offre | sources, node_modules, PDF, dumps |

> Si PostgreSQL n'est pas activable sur l'offre choisie, **ne pas substituer
> MySQL** (l'anti double-vente s'appuie sur `FOR UPDATE`, index partiels et
> CHECK : tout PostgreSQL). Changer d'offre LWS — c'est une condition
> d'architecture, pas une préférence.

---

## 3. Procédure d'installation initiale (pas à pas)

### 3.1 Base de données

1. cPanel → **PostgreSQL Databases** → créer la base `compte_agrim`.
2. Créer l'utilisateur `compte_agrim` (mot de passe fort, généré).
3. Ajouter l'utilisateur à la base avec **tous les privilèges**.
4. Noter l'URL : `postgresql://compte_agrim:MOT_DE_PASSE@127.0.0.1:5432/compte_agrim`
   — la base est co-localisée avec l'API : pas d'accès distant à ouvrir.

### 3.2 Sous-domaine API

1. cPanel → **Domains** → créer `api.domaine.tld`, racine documentaire :
   `/home/<compte>/agrim-api/public` (Passenger publiera via l'app ; la racine
   n'expose que ce que l'API choisit — rien de statique).
2. SSL/TLS Status → **Run AutoSSL** sur le sous-domaine (HTTPS obligatoire :
   `notify_url` CinetPay, FCM, sécurité générale).

### 3.3 Application Node.js (Passenger)

1. cPanel → **Setup Node.js App** → *Create Application* :
   - Node.js version : **20.x ou plus** (la plus récente ≥ 20.19 — sur une
     offre qui ne propose que ≤ 16, changer d'offre : NestJS 11 et Prisma 7
     refusent de tourner en dessous, aucun contournement possible) ;
   - Application mode : **Development** le temps de la mise en service
     (bascule en **Production** après vérifications — le mode Production
     active la validation stricte des secrets et ferme Swagger) ;
   - Application root : `agrim-api` (la RACINE du dépôt — monorepo npm :
     `node_modules` y vit, pas dans `apps/api`) ;
   - Application URL : sous-domaine `api` du domaine principal
     (`api.agrimsarl.ci`) — JAMAIS le domaine racine, le site y vit ;
   - Application startup file : `apps/api/dist/src/main.js` (le client
     Prisma Rust-free se compile avec `src/` — voir docs/refonte/10 §12).
2. **Créer** (l'app démarre même sans code : elle s'activera au premier dépôt).

### 3.4 Récupération du code

cPanel → **Git Version Control** → cloner le dépôt GitHub (clé de déploiement
privée recommandée) dans `agrim-api`, ou `git pull` en Terminal :

```bash
cd ~/agrim-api
git clone git@github.com:jeremy17315/agrim.git .   # ou branche de release
```

### 3.5 Build (avec `--include=dev`, leçon déjà payée côté Render)

En Terminal cPanel (ou SSH), activer l'environnement de l'app (le bouton
« Run NPM Install » du panneau fonctionne aussi, mais le shell donne plus de
visibilité) :

```bash
cd ~/agrim-api
npm ci --include=dev                # @nestjs/cli, prisma, tsx sont des devDependencies
npm run build -w packages/contracts # contrats partagés d'abord
npm run db:generate -w apps/api     # prisma generate (client + engines)
npm run build -w apps/api           # nest build → apps/api/dist/src/main.js
```

> **Note Passenger** : Passenger fournit le port via la variable
> d'environnement `PORT`. Le bootstrap lit `process.env.PORT` en priorité sur
> `API_PORT` (`const port = Number(process.env.PORT) || config…`). C'est
> l'unique adaptation au déploiement — à faire dès le premier déploiement.

### 3.6 Variables d'environnement (`.env`)

Fichier `~/agrim-api/.env` (chargé par `dotenv/config` au démarrage, CWD =
racine applicative sous Passenger) — **chmod 600** :

```ini
# ─── Base ─────────────────────────────────────────────────────────
DATABASE_URL="postgresql://compte_agrim:MOT_DE_PASSE@127.0.0.1:5432/compte_agrim?schema=public"
NODE_ENV=production
# Passenger fournit PORT ; API_PORT reste le repli local.
API_PORT=3000
API_GLOBAL_PREFIX=api/v1

# ─── Auth (openssl rand -base64 48 ; DEUX secrets distincts) ─────
JWT_ACCESS_SECRET=…
JWT_ACCESS_TTL=15m
JWT_REFRESH_SECRET=…
JWT_REFRESH_TTL=30d
ENCRYPTION_KEY=…                 # AES-256-GCM OTP — distincte des secrets JWT

# ─── URLs publiques (webhook CinetPay, retour client) ───────────
PUBLIC_API_URL=https://api.domaine.tld/api/v1
PUBLIC_WEB_URL=https://domaine.tld
CORS_ORIGINS=https://domaine.tld,https://backoffice.domaine.tld

# ─── Paiement ─────────────────────────────────────────────────────
PAYMENT_PROVIDER=cinetpay
CINETPAY_API_KEY=…
CINETPAY_SITE_ID=…
CINETPAY_SECRET=…                # requis : vérification des signatures webhook
PAYMENT_TIMEOUT_SECONDS=…

# ─── Jobs (crons cPanel) ──────────────────────────────────────────
CRON_SECRET=…                    # openssl rand -hex 32 — en-tête X-Cron-Secret

# ─── Notifications ────────────────────────────────────────────────
PUSH_ENABLED=true
FIREBASE_SERVICE_ACCOUNT_JSON={"project_id":…}   # firebase-admin (compte de service)
WHATSAPP_PROVIDER_URL=… / WHATSAPP_TOKEN=…       # agrégateur direct (plus de relais site)
SMTP_HOST=… / SMTP_USER=… / SMTP_PASSWORD=…      # SMTP LWS (e-mails transactionnels)

# ─── Stockage local ───────────────────────────────────────────────
STORAGE_LOCAL_ROOT=storage       # → ~/agrim-api/storage (hors public_html)
```

Le validateur de configuration refuse le démarrage en production sur des
secrets faibles ou identiques — c'est voulu, ne pas contourner.

### 3.7 Migrations (première mise en service)

```bash
cd ~/agrim-api
npx prisma migrate deploy        # UNIQUEMENT deploy en production (jamais migrate dev)
npm run db:seed -w apps/api      # SEULEMENT si base vide au tout premier déploiement
```

### 3.8 Démarrage et vérifications

1. Setup Node.js App → **Restart** (ou `touch ~/agrim-api/tmp/restart.txt`).
2. Sonde : `https://api.domaine.tld/api/v1/health` → `{"status":"ok"}`.
3. Smoke tests : `GET /api/v1/catalog/products` (200), login d'un compte de
   test, création d'une commande de test avec le provider `simulation`,
   puis remise en `cinetpay`.
4. Consulter les logs stderr de l'app (Setup Node.js App → *Log*).

### 3.9 Configuration CinetPay (console marchand)

- `notify_url` : `https://api.domaine.tld/api/v1/payments/webhooks/cinetpay`
- `return_url` : gérée par l'API (écran de suivi).
- Le `CINETPAY_SECRET` du tableau de bord marchand = celui du `.env`
  (*leçon existante : un secret absent = 100 % des webhooks rejetés*).

### 3.10 Site web et back-office

```bash
# Build local (ou CI) puis dépôt des fichiers compilés :
apps/web        → ~/public_html            # domaine principal
apps/back-office → ~/backoffice.domaine.tld
```

- Les deux SPA sont **statiques** : aucun Node requis pour elles.
- Variables de build : URL de l'API (`https://api.domaine.tld/api/v1`)
  figée au build (`.env` de build, pas de secret dans un bundle public).
- Réécriture SPA (routage côté client) — `~/public_html/.htaccess` :

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```

- Vérifier que `CORS_ORIGINS` contient exactement les deux origines.

---

## 4. Cron Jobs cPanel

cPanel → **Cron Jobs** (cadence plancher : 1 minute ; les jobs sont
idempotents et **verrouillés** — `409 JOB_ALREADY_RUNNING` si chevauchement) :

```cron
*/5 * * * *   curl -sS -X POST -H "X-Cron-Secret: LE_CRON_SECRET" https://api.domaine.tld/api/v1/jobs/reconciliation  >/dev/null 2>&1
*/10 * * * *  curl -sS -X POST -H "X-Cron-Secret: LE_CRON_SECRET" https://api.domaine.tld/api/v1/jobs/outbox-drain      >/dev/null 2>&1
*/30 * * * *  curl -sS -X POST -H "X-Cron-Secret: LE_CRON_SECRET" https://api.domaine.tld/api/v1/jobs/abandoned-carts   >/dev/null 2>&1
0 3 * * *     curl -sS -X POST -H "X-Cron-Secret: LE_CRON_SECRET" https://api.domaine.tld/api/v1/jobs/maintenance       >/dev/null 2>&1
```

| Job | Rôle |
| --- | --- |
| `reconciliation` | paie les paiements abandonnés (re-vérification CinetPay), rend le stock des commandes expirées, purge la rétention |
| `outbox-drain` | rattrape les événements non traités (si le process a été recyclé avant le drain en ligne) |
| `abandoned-carts` | relances paniers (programmé, jamais temps réel) |
| `maintenance` | purges (`RefreshToken`, `IdempotencyRecord`, `OutboxEvent`, traces GPS), statistiques, contrôle stock vs journal |

**Règles** : échapper les `%` dans les commandes cron (`date +\%F`) ; jamais
de logique métier dans le crontab — il ne fait que **réveiller** l'API ; un
passage de rattrapage au démarrage applicatif couvre les hébergements au
réveil paresseux (héritage du pattern existant).

---

## 5. Sauvegardes (cron quotidien)

```cron
30 2 * * *  pg_dump -U compte_agrim -d compte_agrim | gzip > ~/backups/agrim-$(date +\%F).sql.gz && find ~/backups -name "agrim-*.sql.gz" -mtime +30 -delete
```

- `~/.pgpass` (chmod 600) pour le mot de passe sans interaction.
- **La restauration est répétée une fois par trimestre** sur une base de
  recette : un backup jamais restauré est une supposition, pas un backup.
- Les fichiers (`storage/`) sont couverts par les sauvegardes de fichiers
  cPanel ; les PDF et visuels sont reconstituables depuis `FileAsset` en cas
  de divergence.

---

## 6. Mise à jour (checklist de release)

```bash
cd ~/agrim-api
git fetch && git checkout vX.Y.Z            # tag de release
npm ci --include=dev
npm run build -w packages/contracts && npm run build -w apps/api
npx prisma migrate deploy                   # migrations incrémentales uniquement
touch tmp/restart.txt
curl -sS https://api.domaine.tld/api/v1/health
```

Règles :

1. **Migrations rétrocompatibles** (expand/contract) : ajouter d'abord
   (colonnes/tables optionnelles), déployer le code, retirer ensuite. Prisma
   Migrate étant *forward-only*, tout retrait destructeur se fait dans une
   release ultérieure, jamais avec le code qui en dépend.
2. Un **tag par release** ; retour arrière = checkout du tag précédent +
   restart (les données, elles, restent — d'où l'expand/contract).
3. Fenêtre de déploiement hors heures de pointe (Passenger coupe quelques
   secondes au restart).
4. Après chaque release : smoke tests (health, catalogue, commande simulation,
   webhook simulé).

### Environnement de recette (recommandé)

Un second Node.js App (`recette.domaine.tld`, même compte cPanel, **base
séparée** `compte_agrim_recette`, crons désactivés) reproduit le pipeline à
l'identique : chaque release passe en recette avant production.

---

## 7. Notifications externes — configuration

| Service | Action |
| --- | --- |
| **FCM** | Projet Firebase → 2 apps (Android/iOS) → compte de service (JSON) → `FIREBASE_SERVICE_ACCOUNT_JSON`. iOS : clé APNs uploadée dans Firebase. Le mobile enregistre ses jetons via `POST /push-tokens` |
| **WhatsApp/SMS** | Compte agrégateur direct (ex-WATI/360dialog/opérateur) → URL + jeton dans le `.env`. Les clés ne quittent jamais le serveur |
| **SMTP** | Compte e-mail LWS dédié (ex. `no-reply@domaine.tld`) + mot de passe applicatif |

---

## 8. Mobile Flutter (rappel — hors cPanel)

Le mobile n'est pas déployé sur cPanel ; il est construit et publié :

- `flutter build appbundle --dart-define=API_BASE_URL=https://api.domaine.tld/api/v1`
  (Android) / équivalent iOS ; aucune URL en dur dans le code.
- Signature Android (keystore protégé, hors dépôt), publication Play Store ;
  iOS via TestFlight/App Store.
- `expo-updates` disparaît avec Expo : les correctifs critiques passent par
  les mises à jour stores (et l'API versionnée `/api/v1` garantit la
  compatibilité des clients publiés, livrable 5 § 5).

---

## 9. Supervision et dépannage

| Symptôme | Cause probable | Action |
| --- | --- | --- |
| `503` sur tout `/api/v1` | l'app Passenger ne démarre pas | log stderr (Setup Node.js App) ; le plus souvent `.env` manquant/faux ou validation de secrets en échec |
| L'app redémarre en boucle | exception au boot (migration manquante) | `prisma migrate deploy` puis restart ; vérifier la version du code |
| Erreur Prisma « engine » | engines non générés / mémoire build | `npx prisma generate` dans l'environnement de l'app ; builder hors pic mémoire |
| Webhooks CinetPay absents | `PUBLIC_API_URL` faux, TLS invalide, secret non configuré chez le marchand | tester `/health` en HTTPS public ; re-vérifier `notify_url` ; la réconciliation rattrape pendant ce temps |
| Lenteur au premier accès | cold start Passenger | attendu (~1–3 s) ; l'external monitor sur `/health` garde l'app tiède si besoin |
| `429` sur les crons | deux déclencheurs chevauchent | attendu : `JOB_ALREADY_RUNNING` — espacer les cadences si fréquent |
| Base « too many connections » | pool Prisma trop large | pool réduit (config Prisma `connection_limit`) — mutualisé LWS |

**Supervision minimale** : monitor externe (uptime) sur `/api/v1/health`
+ alerte e-mail ; lecture hebdomadaire des logs stderr ; tableau
back-office (files, paiements en attente, taux d'OTP vs overrides).

---

## 10. Sécurité du compte cPanel

- 2FA cPanel ; mots de passe uniques ; clés SSH plutôt que mot de passe.
- `.env` et `~/.pgpass` en `chmod 600` ; aucun secret dans `public_html`.
- Le dossier `storage/` n'est servi par personne d'autre que l'API (contrôle
  d'accès par route) — pas de listing de répertoires.
- Rotation des secrets (JWT, `CRON_SECRET`, clés agrégateurs) en cas de
  doute ; `ENCRYPTION_KEY` **jamais** tournée à chaud (les OTP en cours
  deviendraient illisibles — les régénérer).
- Mettre à jour les dépendances (`npm audit`) à chaque release majeure.

---

## 11. Résumé exécutable de la mise en service

1. Valider l'offre (Node ≥ 20, **PostgreSQL**, crons, TLS).
2. Créer base + utilisateur PostgreSQL.
3. Créer sous-domaine `api.` + AutoSSL.
4. Créer l'app Node (Passenger, startup `dist/main.js`).
5. Cloner le code, `npm ci --include=dev`, build, `prisma generate`.
6. Écrire `.env` (chmod 600) — secrets forts distincts.
7. `prisma migrate deploy` (+ seed si base vierge).
8. Restart → `/api/v1/health` → smoke tests.
9. Configurer CinetPay (`notify_url`, secret).
10. Déployer les SPA web et back-office (+ `.htaccess`, CORS).
11. Programmer les 4 crons + la sauvegarde nocturne.
12. Configurer FCM et l'agrégateur WhatsApp/SMS.
13. Publier Flutter (Android/iOS) pointant sur `api.domaine.tld`.
14. Recette → production ; monitor externe sur `/health`.
