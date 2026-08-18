# Phase 20 — Revue de sécurité

Objectif : durcir l'application avant les phases de build. La démarche a été de
**vérifier par le test** plutôt que par la lecture — plusieurs protections
considérées comme acquises ne l'étaient pas réellement.

---

## 1. Le défaut principal : la sécurité n'était pas testée

`helmet`, la liste blanche de validation et le masquage de la signature serveur
étaient configurés dans `main.ts`. Or **les tests d'intégration ne chargent
jamais `main.ts`** : ils construisent l'application eux-mêmes.

Conséquences constatées :

- aucune des 204 assertions existantes n'exerçait ces réglages ;
- une suite avait déjà divergé, validant **sans `forbidNonWhitelisted`** — elle
  testait donc une application plus permissive que celle livrée ;
- `transformOptions` n'était répliqué dans aucune suite.

**Correctif** : extraction dans `src/bootstrap.ts` (`configureApp`), appelé par
`main.ts` **et** par les 13 suites d'intégration. La configuration de production
est désormais celle qui est testée. Toute règle globale s'ajoute là, jamais dans
`main.ts`.

Le premier test écrit contre cette configuration a immédiatement échoué
(`x-content-type-options` absent) — ce qui confirme que la protection n'était pas
couverte.

---

## 2. Preuves de livraison exposées publiquement

`app.useStaticAssets(..., { prefix: '/files/' })` servait le dossier de stockage
**sans aucune authentification**. Une signature manuscrite est une donnée
personnelle ; l'URL suffisait à la lire.

Le nom de fichier étant un UUID v4, l'exposition n'était pas triviale à
exploiter, mais un identifiant non devinable **n'est pas un contrôle d'accès** :
une URL fuite par capture d'écran, journal de proxy ou en-tête `Referer`.

**Correctif** :

- service statique **supprimé** ;
- nouvelle route `GET /files/proofs/:id`, authentifiée, avec règle métier :

| Demandeur | Accès |
|---|---|
| Client de la commande | oui |
| Livreur de la course | oui |
| GESTIONNAIRE / ADMIN / DG | oui (traitement des litiges) |
| Auteur du dépôt, fichier non encore rattaché | oui |
| Tout autre compte | 403 `FILE_ACCESS_DENIED` |

- en-têtes `Cache-Control: private, no-store` et `X-Content-Type-Options: nosniff` ;
- `:id` validé en UUID : une tentative de traversée n'atteint jamais le disque ;
- une référence en base sans fichier renvoie 404, pas une erreur système ;
- `StorageProvider.read()` ajouté au contrat — le futur pilote S3 suivra la
  même interface.

L'URL renvoyée à l'upload pointe désormais vers cette route (`/files/proofs/:id`)
et non plus vers un chemin disque public.

---

## 3. Secrets JWT insuffisamment contrôlés

La validation d'environnement ne vérifiait qu'un seul secret, via un seul
préfixe (`dev_only`), et n'imposait pas qu'ils soient distincts.

Avec `JWT_ACCESS_SECRET === JWT_REFRESH_SECRET`, **un access token vaut refresh
token** : la rotation, la détection de rejeu et la révocation cessent de
protéger quoi que ce soit.

**Correctif** (`src/config/env.validation.ts`) :

- les deux secrets doivent être différents — refus au démarrage, quel que soit
  l'environnement ;
- en production : refus si un secret contient `change`, `secret`, `example`,
  `test`, `dev_only`, ou fait moins de 32 caractères ;
- hors production, ces contrôles restent souples pour ne pas gêner le travail.

7 tests unitaires couvrent ces règles.

---

## 4. Routes publiques sans limite propre

Seul `/auth/login` était protégé (5/min). Trois routes sensibles retombaient sur
la limite globale de 120/min :

| Route | Avant | Après | Motif |
|---|---|---|---|
| `POST /auth/register` | 120/min | **5 / 5 min** | création de comptes en masse |
| `POST /auth/refresh` | 120/min | **20/min** | devinette de jeton |
| `POST /auth/change-password` | 120/min | **5/min** | exige le mot de passe actuel : une session volée ne doit pas servir à le retrouver |

---

## 5. CORS

`origin: isProd ? [] : true` avec `credentials: true`.

- `credentials: true` est inutile ici : l'authentification passe par un en-tête
  `Bearer`, il n'y a pas de cookie de session. Autoriser les credentials
  élargissait la surface sans usage → **désactivé**.
- La liste vide en production est le bon défaut tant qu'aucun front web
  n'existe (l'application mobile n'envoie pas d'`Origin` et n'est pas
  concernée), mais elle était **implicite et non configurable**. Ajout de
  `CORS_ORIGINS` (liste séparée par des virgules) pour un futur back-office.

---

## 6. Points vérifiés et jugés corrects

Ces éléments n'ont pas été modifiés — la vérification les a confirmés :

- **Dépôt de fichiers** : liste blanche de types, plafond 5 Mo appliqué avant
  chargement en mémoire, **vérification des magic numbers** (le type MIME
  déclaré ne fait pas foi), nom généré côté serveur, protection contre la
  traversée de chemin.
- **Rotation des refresh tokens** : seul le haché est persisté ; un token révoqué
  qui revient invalide **toutes** les sessions du compte.
- **Revalidation en base à chaque requête** : le rôle inscrit dans le jeton n'est
  jamais cru sur parole ; un compte désactivé perd l'accès immédiatement.
- **Filtre d'exception global** : aucune stack ni erreur Prisma ne remonte au
  client ; les 5xx sont journalisées côté serveur uniquement.
- **Mobile** : aucun secret en AsyncStorage (SecureStore pour les jetons, panier
  seul en clair), aucun `console.*` résiduel, aucun jeton en URL ou en log.
- **Dépôt** : aucun `.env` suivi par Git, aucun secret en dur dans le code.

---

## 7. Tests ajoutés

`src/security.e2e.spec.ts` (14 tests) vérifie des **propriétés**, pas des
fonctionnalités :

- aucune empreinte de mot de passe (`passwordHash`, `$argon2`) ni de
  `tokenHash` dans une réponse ;
- aucune trace technique, requête SQL ou mention de Prisma dans une erreur ;
- un access token refusé comme refresh token, et l'inverse ;
- signature altérée refusée ;
- **jeton non signé (`alg: none`) revendiquant ADMIN refusé** ;
- rôle du jeton non cru sur parole ;
- compte désactivé → accès coupé malgré un jeton valide ;
- champ non déclaré (`userId` injecté) → 400, pas une absorption silencieuse ;
- 7 routes protégées renvoient 401 sans jeton ;
- catalogue public en lecture, aucune écriture publique ;
- en-têtes helmet présents, `x-powered-by` absent.

Complété par : 6 tests de contrôle d'accès aux preuves, 7 tests de validation
d'environnement, 2 tests de rate limiting.

---

## Vérifications finales

| Vérification | Résultat |
|---|---|
| Tests API | **233 / 16 suites** (204 → 233) |
| Tests mobile | **215 / 21 suites** (inchangé, aucune régression) |
| `tsc --noEmit` API + mobile | propre |
| ESLint API + mobile | propre |
| `nest build` puis démarrage réel | OK |
| `GET /files/proofs/<uuid>` sans jeton | **401** |
| Ancien chemin statique `/files/…` | **404** (fermé) |
| En-têtes réels | `nosniff`, `SAMEORIGIN`, HSTS, pas de `x-powered-by` |
| `Access-Control-Allow-Credentials` | absent |

---

## Fichiers

**Créés** — `src/bootstrap.ts`, `src/security.e2e.spec.ts`,
`src/config/env.validation.spec.ts`.

**Modifiés** — `src/main.ts`, `src/config/env.validation.ts`,
`src/auth/auth.controller.ts`, `src/storage/{files.controller,files.service,storage.provider,local-storage.provider}.ts`,
`src/storage/files.e2e.spec.ts`, `src/auth/throttling.e2e.spec.ts`,
les 13 suites d'intégration (alignées sur `configureApp`), `.env.example`.

**Dépendances ajoutées** — aucune.

---

## Limites connues

- Le contrôle d'accès aux preuves est vérifié en base à chaque lecture. Sur un
  volume important, prévoir un index sur
  `Delivery(proofSignatureFile, proofPhotoFile)` — inutile en V1.
- Le rate limiting est en mémoire : avec plusieurs instances, chacune aura son
  propre compteur. Le passage à un store Redis se fera sans changer les
  décorateurs, et reste hors périmètre V1.
- Pas de rotation automatique des secrets ni de purge des refresh tokens
  expirés : à traiter en exploitation.

**Prochaine étape** : phase 21 — performance.
