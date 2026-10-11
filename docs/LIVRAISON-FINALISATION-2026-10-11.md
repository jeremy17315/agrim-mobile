# AGRIM — BÉLIER D'OR · Livraison de finalisation

**Date :** 11 octobre 2026
**Périmètre :** application mobile Android (Expo/React Native), API NestJS, contrats
partagés, base PostgreSQL — dépôt `agrim-mobile`.
**Règle tenue tout du long :** on audite le code réel, on l'améliore, on ne
reconstruit rien ; rien n'est déclaré « fait » ou « testé » sans l'avoir
exécuté.

Ce document est le **livrable de synthèse** demandé. Il renvoie aux documents
détaillés plutôt que de les recopier :

| Document | Contenu |
|---|---|
| `docs/AUDIT-2026-10-11-FINALISATION.md` | audit du code réel (livrable 1) |
| `docs/PAIEMENT-DIRECT-MANUEL.md` | paramètres, configuration et procédure de vérification du paiement (livrables 8 et 9) |
| `docs/PUBLICATION-PLAY.md` | préparation Play Store, AAB, signature (livrable 12) |
| `docs/COMMANDES-APK-ET-PUBLICATION.md` | mémo de commandes à copier-coller : poste de travail → APK de test → tests sur téléphone → AAB → Play Store |
| ce document | livrables 2 à 7, 10 à 14 |

---

## 1. Où en est le projet

| Phase | État | Preuve |
|---|---|---|
| 1 — Audit du code réel | ✅ terminée | `docs/AUDIT-2026-10-11-FINALISATION.md` |
| 2 — Corrections et sécurité | ✅ terminée | e2e corrigé, mentions légales FR réécrites, filtre d'erreurs réparé |
| 3 — Paiement direct manuel | ✅ terminée | 11 tests e2e API + 6 tests d'écran + procédure écrite |
| 4 — Notifications push | ⏸ **reportée à la demande du client** | contrat, modèles et garde-fous serveur prêts ; voir §7 |
| 5 — Commandes et codes promo | ✅ terminée | 9 tests e2e API + 6 tests d'écran |
| 6 — Cohérence du catalogue et des données commerciales | ✅ terminée (reste les données AGRIM) | 7 tests e2e API + 4 tests d'écran |
| 7 — Tests et publication | 🟡 partielle | tests exécutés et chiffrés (§10) ; AAB et fiche Play à produire (§12, §13) |

---

## 2. Fonctionnalités existantes (livrable 2) — état réel, vérifié dans le code

**Parcours client sans compte**
- Accueil éditorial, catalogue, fiche produit (formats, prix par format,
  disponibilité, promotions), panier, devis serveur, checkout invité (nom,
  téléphone, zone, précisions), commande, confirmation.
- Reprise du panier après fermeture : cache persistant + clé d'idempotence
  conservée, donc pas de doublon de commande.
- Suivi d'une commande invitée par sa référence + capacité temporaire
  (jeton signé), sans créer de compte.

**Commandes et stock**
- Création de commande serveur : prix, remises, total recalculés côté serveur ;
  aucun montant envoyé par le téléphone n'est lu.
- Réservation de stock auprès du site (SSOT), libération à l'annulation,
  protection anti-survente.
- Statuts de commande, historique d'événements, annulation client.

**Livraison**
- Grille de zones servie par le site, choix de zone au checkout, frais jamais
  encaissés en ligne (« à confirmer »), livraison/retrait, code de remise (OTP),
  clôture d'exception par la gestion, suivi GPS côté livreur.

**Comptes et espaces internes**
- Auth JWT + rotation de refresh, Argon2, rôles CLIENT / LIVREUR / PRODUCTEUR /
  GESTIONNAIRE / ADMIN / DG, espaces tournée, exploitation, gestion, direction,
  back-office gérant (commandes, stocks, récoltes), parrainage, avis.

**Catalogue**
- Le site est la source de vérité ; synchronisation (produits, variantes,
  images, prix, promotions), et catalogue consultable hors ligne.

**Paiement (avant cette livraison)**
- Agrégateur (CinetPay/PayDunya/simulation) : conservé **uniquement** pour les
  commandes passées avant la bascule (voir §3).

**Autres**
- Analytics DG, réconciliation des paiements historiques, messagerie interne
  (outbox), journal d'audit, mentions légales FR, santé, pièce jointe de preuve
  de paiement (nouveau).

---

## 3. Ce qui a été corrigé ou ajouté (livrable 3)

### 3.1 Paiement direct manuel — le cœur de la demande

- **Fin de l'agrégateur pour les nouvelles commandes** : plus de commission.
  Une commande nouvelle naît en `DIRECT_MOBILE_MONEY` ou `CASH_ON_DELIVERY` ;
  `POST /payments/orders/:ref/initiate` répond `PAYMENT_NOT_AGGREGATOR` (409).
  Les commandes **antérieures** restent servies par l'agrégateur : leur argent a
  été encaissé, les retirer créerait des dossiers orphelins.
- **Compatibilité ascendante** : une application déjà installée qui envoie
  encore `MOBILE_MONEY` + opérateur obtient une commande en transfert direct —
  sa commande n'est jamais refusée, l'intention est respectée.
- **Instructions de paiement** : montant figuré sur la commande, numéro officiel
  et bénéficiaire **lus dans la configuration**, référence de commande à
  rappeler, texte copiable en un geste, et interdiction absolue de demander le
  code secret.
- **Déclaration par le client** : référence de transaction (unique), montant
  transféré, note, justificatif facultatif (JPEG/PNG/WebP/PDF ≤ 5 Mo, contrôlé
  avant écriture).
- **Vérification par le personnel** : file d'attente avec tout ce qu'il faut
  pour décider, écart de montant signalé, confirmation après constat des fonds,
  rejet **motivé** (motif transmis au client), maintien en vérification,
  journal d'audit (auteur, rôle, source, IP, horodatage).
- **Garde-fous** : bascule conditionnelle (pas de double validation), référence
  unique (pas de réutilisation), montant figé, aucun chemin automatique vers
  « payé », un paiement manuel n'expire jamais.

### 3.2 Codes promo

- Création par ADMIN/DG uniquement ; le gestionnaire exécute, il ne fixe pas les
  remises.
- **Un code créé est INACTIF** : la publication est un acte explicite (exigence
  « promotions validées par AGRIM avant publication »).
- **Une seule règle de calcul** partagée par le devis et la commande : le devis
  applique désormais localement les codes d'AGRIM (le site ne fournit plus que
  ses remises automatiques), donc le total annoncé est celui facturé, même si le
  site est injoignable.
- **Un code saisi n'est jamais ignoré en silence** : inconnu, expiré, inactif,
  hors quota, sous le minimum, hors zone → refus avec motif lisible.
- **Quota par téléphone appliqué aussi aux clients connectés** (le numéro du
  compte, jamais un champ envoyé par le téléphone).
- Écran d'administration mobile : création, modification, publication,
  désactivation (jamais de suppression), compteur d'utilisations.

### 3.3 Configuration commerciale sans nouvelle version

- `GET /config/app` **public** : coordonnées, points de vente, textes de
  livraison, FAQ, annonce.
- Écriture réservée ADMIN/DG ; un point de vente créé est **inactif** par
  défaut, et distingue « retrait possible » de « information seulement ».
- Les numéros affichés par l'application (écrans d'appel, panier, paiement)
  viennent du serveur ; `company.ts` ne sert plus que de **repli** hors
  connexion. Vérifié par test : le numéro publié remplace bien celui du bundle.
- Nouvel écran **Contact et aide** : appeler, standard, WhatsApp, e-mail,
  points de vente, livraison, FAQ, signaler un problème.

### 3.4 Sécurité et robustesse (phase 2)

- **Filtre d'erreurs** : `details` (motif d'un refus, champ fautif) n'était
  jamais transmis au client — corrigé, sans exposer d'information technique.
- **Erreurs inconnues refusées** : l'API rejette toute propriété non prévue
  (test : envoyer un montant fabriqué → 400, aucune commande créée).
- Mentions légales réécrites en français (confidentialité + CGU), sans
  référence à l'agrégateur.
- Garde-fou de production : un pilote de paiement de simulation en production
  est remplacé par un pilote inerte et journalisé (jamais de faux encaissement).
- `prefer-const` et autres alertes de lint nettoyées ; `eslint --max-warnings 0`
  passe sur les deux applications.

---

## 4. Fichiers créés et modifiés (livrable 4)

### Créés

| Fichier | Rôle |
|---|---|
| `apps/api/src/payments/direct-payments.service.ts` | cœur du paiement direct (déclaration, revue, journal) |
| `apps/api/src/payments/direct-payments.controller.ts` | routes client et invité (dont justificatif multipart) |
| `apps/api/src/payments/payment-admin.controller.ts` | routes d'administration (RBAC, justificatif en flux) |
| `apps/api/src/payments/payment-methods.service.ts` | configuration des numéros de réception |
| `apps/api/src/payments/resolve-method.ts` | règle unique de résolution du moyen de paiement |
| `apps/api/src/payments/dto/direct-payment.dto.ts` | validation des entrées de paiement |
| `apps/api/src/payments/paiement-direct.e2e.spec.ts` | 11 tests d'acceptation du paiement |
| `apps/api/src/promo-codes/promo-code-cumul.e2e.spec.ts` | 9 tests du parcours des codes promo |
| `apps/api/src/app-config/app-config.service.ts` (et `app-config.module.ts`, `app-config.controller.ts`, `dto/app-config.dto.ts`) | configuration commerciale servie et administrable |
| `apps/api/src/app-config/app-config.e2e.spec.ts` | 7 tests de la configuration commerciale |
| `packages/contracts/src/payment-direct.ts` | contrat du paiement direct (statuts, limites, texte copiable) |
| `packages/contracts/src/promo.ts` | règle d'évaluation des codes promo |
| `packages/contracts/src/push.ts`, `packages/contracts/src/app-config.ts` | contrats push et configuration |
| `apps/mobile/app/gestion/paiements.tsx` | file de vérification des paiements |
| `apps/mobile/app/direction/promotions.tsx` | administration des codes promo |
| `apps/mobile/app/contact.tsx` | contact, points de vente, livraison, FAQ |
| `apps/mobile/src/api/promos.ts`, `apps/mobile/src/api/config.ts` | accès réseau des deux écrans ci-dessus |
| `apps/mobile/src/__tests__/paiement.screen.test.tsx`, `gestion-paiements.screen.test.tsx`, `promotions.screen.test.tsx`, `contact.screen.test.tsx` | tests d'écran correspondants |
| `docs/PAIEMENT-DIRECT-MANUEL.md`, `docs/PUBLICATION-PLAY.md`, ce document | livrables |

### Modifiés (extraits significatifs)

- `apps/api/src/app.module.ts`, `apps/api/src/orders/orders.module.ts` :
  enregistrement des nouveaux modules ; `cart-quote.service.ts` bascule sur la
  règle de remise partagée.
- `apps/api/src/orders/orders.service.ts`, `guest-checkout.service.ts`,
  `checkout.service.ts` : normalisation du moyen de paiement, numéro figé sur la
  commande, quotas par téléphone, enregistrement des utilisations de code.
- `apps/api/src/payments/payments.service.ts`, `payments.module.ts` : fermeture
  de l'agrégateur aux commandes nouvelles, garde-fou de production.
- `apps/api/src/promo-codes/promo-codes.service.ts` : refus explicite des codes
  inconnus, publication explicite, identifiant dans la sortie d'administration.
- `packages/contracts/src/{enums,schemas,notifications,index}.ts` : nouveaux
  statuts, nouveaux types de notification, acceptation de `paymentMethodCode`.
- `apps/mobile/app/paiement/[reference].tsx` : écran de transfert direct
  (instructions, copie, déclaration, suivi) — **ne confirme jamais**.
- `apps/mobile/app/commande/index.tsx`, `app/confirmation/[reference].tsx`,
  `app/gestion/index.tsx`, `app/notifications/index.tsx`, `app/(tabs)/*` :
  parcours, aide, accès aux nouveaux écrans.
- `apps/mobile/src/lib/contact.ts` : numéros publiés, repli AGRIM.
- `apps/api/prisma/schema.prisma` + migration (voir §5).

---

## 5. Migrations de base de données (livrable 5)

Une seule migration nouvelle — **strictement additive**, sans suppression ni
renommage :

`apps/api/prisma/migrations/20261011090000_paiement_direct_manuel_notifications/migration.sql`

Elle crée : `payment_method_configs`, `payment_declarations`,
`payment_review_logs`, `push_devices`, `notification_campaigns`, `promo_codes`,
`promo_code_redemptions`, `points_of_sale` — et ajoute à l'existant
`Payment.methodCode / receivingNumber / confirmedAt`,
`Notification.linkTarget / linkValue / campaignId`.

**Aucune donnée commerciale n'est insérée par la migration** : ni numéro de
réception, ni code promo, ni point de vente. Ces valeurs sont des paramètres
AGRIM (§13).

Application :

```bash
# En production (recommandé) : via le client Prisma officiel
cd apps/api && npx prisma migrate deploy

# Sans accès réseau (poste isolé) : script maison, même ordre, mêmes fichiers
DATABASE_URL=... node scripts/apply-migrations.cjs
```


**Contraintes vérifiées.** Le 11/10/2026, les contraintes de la base de
développement ont été comparées à celles d'une base neuve : une seule
manquait — la clé étrangère `payment_review_logs_actorId_fkey` (absente parce
que la migration avait été appliquée avant l'ajout de cette relation au
fichier). Elle a été créée à l'identique
(`… REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL`) : les deux
bases sont désormais **identiques, sans aucun écart**. Une base neuve créée en
production recevra la contrainte directement par la migration — rien à faire
manuellement.

Vérifié le 11/10/2026 : **18 migrations appliquées**, dont celle-ci, sur une base vierge créée pour l'occasion (`agrim_migcheck`) — application complète en 483 ms, sans erreur. La base de vérification a été supprimée ensuite.

---

## 6. Variables d'environnement à configurer (livrable 6)

Aucune valeur secrète n'est écrite ici : ce sont les **noms** et leur rôle.

### API (`apps/api/.env` en production)

| Variable | Rôle | Obligatoire |
|---|---|---|
| `DATABASE_URL` | connexion PostgreSQL | oui |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | signature des jetons | oui |
| `ENCRYPTION_KEY` | chiffrement au repos (secret-box AES-256-GCM) | oui |
| `NODE_ENV=production` | active les garde-fous de production | oui |
| `PAYMENT_PROVIDER` | pilote utilisé pour les commandes **antérieures** (`cinetpay`/`paydunya`) ; laisser `simulation` désactive l'agrégateur | selon l'historique |
| `SITE_INTEGRATION_URL`, `SITE_INTEGRATION_TOKEN` | catalogue, grille de livraison et remises automatiques du site | oui |
| `PUSH_ENABLED`, `PUSH_PROVIDER`, `EXPO_ACCESS_TOKEN` | notifications (phase 4, reportée) | plus tard |
| `SIEVE_API_KEY` | intégration SIEVE (existant) | selon usage |
| `THROTTLE_*` (facultatif) | ajustement des limites de débit | non |

### Application mobile (au build, jamais dans le dépôt)

| Variable | Rôle |
|---|---|
| `EXPO_PUBLIC_API_URL` | URL publique de l'API (`https://…/api/v1`) |
| `EXPO_PUBLIC_SITE_URL` | base des médias produits |
| `GOOGLE_MAPS_ANDROID_KEY` | carte des écrans livreur (optionnelle) |
| `EAS_PROJECT_ID`, `EAS_PROJECT_OWNER` | rattachement du projet Expo |

**Aucune clé de paiement, aucun jeton push et aucun secret n'est présent dans le
bundle mobile** : vérifié, `app.config.ts` ne contient que des valeurs publiques,
et les points de vente / numéros viennent du serveur.

---

## 7. Procédure d'activation des notifications (livrable 7 — phase reportée)

La phase 4 est **reportée à la demande du client**. Ce qui est déjà en place,
et ce qu'il restera à faire :

**Déjà en place :** contrats (`packages/contracts/src/push.ts` : catégories,
cibles, liens profonds, limites de rédaction), modèles `PushDevice` (jeton,
installation, téléphone, opt-in, révocation) et `NotificationCampaign`
(titre, message, image, cible, statut, résultats), envoi côté serveur
(`pushToTokens`, purge des jetons invalides), notifications d'équipe et de
commande, modèles de texte FR, écran de notifications in-app.

**Reste à faire :** enregistrement d'un jeton **sans compte** (aujourd'hui
`usePushRegistration` exige une session), écran d'envoi de campagne
(brouillon → test → envoi de masse avec confirmation), liens profonds à
l'ouverture, validation sur appareil réel **application fermée**, et
identifiants du projet de notification (fournis par AGRIM/Expo).

**Procédure prévue :** créer/valider le projet push, configurer
`PUSH_ENABLED=true` et le jeton serveur, générer un build de test (APK),
installer sur un téléphone réel, fermer complètement l'application, envoyer une
notification de test depuis l'administration, vérifier la réception puis
l'ouverture du bon écran. Aucune clé ne doit être publiée dans le bundle.

---

## 8. Procédure de configuration du paiement manuel (livrable 8)

Détaillée dans `docs/PAIEMENT-DIRECT-MANUEL.md`, section 3. Résumé :

1. `POST /api/v1/management/payments/methods` (ADMIN ou DG) avec `code`,
   `operatorName`, `receivingNumber`, `beneficiaryName`, `instructions`,
   `isActive: true`.
2. Vérifier chez le client : `GET /api/v1/payments/methods` doit renvoyer le
   moyen ; l'écran de paiement affiche le numéro, le bénéficiaire et les
   instructions.
3. Tant qu'aucun moyen n'est activé, l'application ne propose que le paiement à
   la livraison et l'explique — elle n'affiche jamais un numéro qu'elle ne
   connaît pas.

## 9. Procédure de vérification AGRIM (livrable 9)

Détaillée dans `docs/PAIEMENT-DIRECT-MANUEL.md`, section 4. Résumé :

1. Gestion → **Paiements à vérifier** (file du plus ancien au plus récent).
2. Contrôler les fonds reçus sur le compte marchand, en rapprochant la
   référence de transaction annoncée.
3. **Confirmer la réception des fonds** (la commande passe à « confirmée », le
   client est prévenu, la décision est journalisée à votre nom) ou **rejeter**
   avec un motif obligatoire (transmis au client ; la commande n'est pas
   annulée).
4. En cas de doute : laisser en vérification et appeler le client — rien
   n'expire.

---

## 10. Tests exécutés et résultats (livrable 10)

Toutes les commandes ci-dessous ont été **réellement exécutées** sur ce dépôt,
avec une base PostgreSQL migrée et amorcée.

| Commande | Résultat |
|---|---|
| `cd apps/api && npx jest --runInBand` | **37 suites, 435 tests — 435 ✅** |
| `cd apps/mobile && npx jest` | **33 suites, 289 tests — 289 ✅** |
| `cd apps/api && npx tsc --noEmit -p tsconfig.typecheck.json` | aucune erreur |
| `cd apps/mobile && npx tsc --noEmit` | aucune erreur |
| `cd apps/api && npm run lint` / `cd apps/mobile && npm run lint` | aucune erreur (`--max-warnings 0`) |
| `npm run build` (contrats partagés) | compilation OK |

### Preuves apportées, exigence par exigence

| Exigence du brief | Test qui le prouve |
|---|---|
| Commander sans compte | `guest-checkout.service.spec.ts`, `commande.screen.test.tsx` |
| Montants vérifiés côté serveur | `cart-quote.spec.ts` (« le serveur calcule, le client affiche »), `web-checkout.e2e.spec.ts` |
| Paiement vers le numéro configuré | `paiement-direct.e2e.spec.ts` (numéro créé en test, jamais codé en dur) |
| Le client soumet une référence de transaction | `paiement-direct.e2e.spec.ts`, `paiement.screen.test.tsx` |
| AGRIM vérifie et confirme dans l'administration | `paiement-direct.e2e.spec.ts`, `gestion-paiements.screen.test.tsx` |
| **Une commande ne devient JAMAIS « Payée » après « J'ai payé »** | `paiement-direct.e2e.spec.ts` : après déclaration, statut `DECLARED_BY_CUSTOMER`, commande `PENDING`, **zéro** événement de confirmation |
| Pas de double validation | `paiement-direct.e2e.spec.ts` : seconde confirmation → 409 |
| Pas de réutilisation de référence | `paiement-direct.e2e.spec.ts` : même référence, autre commande → 409 |
| Montant erroné → vérification manuelle | `paiement-direct.e2e.spec.ts` : écart → `UNDER_REVIEW`, montant dû inchangé |
| Codes promo administrables et vérifiés serveur | `promo-code-cumul.e2e.spec.ts` (9 tests) |
| Le client ne peut pas fabriquer un montant | `promo-code-cumul.e2e.spec.ts` : propriété inconnue → 400, aucune commande créée |
| Données commerciales modifiables sans nouvelle version | `app-config.e2e.spec.ts`, `contact.screen.test.tsx` |
| Durée du panier, coupure réseau, reprise | `commande.screen.test.tsx` (clé conservée après coupure, renouvelée après refus métier) |
| Décision de livraison honnête | `cart-quote.spec.ts`, `contact.screen.test.tsx` |

### Ce qui n'a PAS été testé (et ne peut pas l'être ici)

- **Notification reçue application fermée** : nécessite un appareil Android réel
  et un build signé (phase 4 reportée).
- **Paiement réel** : exige le numéro officiel d'AGRIM et un vrai transfert.
- **Publication Play Store** : exige le compte de publication et le
  consentement d'AGRIM.

Ces points sont listés en §13 comme dépendances, pas comme acquis.

---

## 11. Déploiement du backend (livrable 11)

Le dépôt contient déjà `render.yaml` et `railway.json` : la mise en service
suit le chemin existant.

1. **Base** : créer/mettre à jour PostgreSQL, puis `npx prisma migrate deploy`
   (18 migrations, aucune destructive).
2. **Variables** : renseigner celles de §6 (les secrets restent chez
   l'hébergeur, jamais dans le dépôt).
3. **Build** : `npm install` à la racine (monorepo), build des contrats
   partagés (`packages/contracts`), démarrage de l'API (`apps/api`).
4. **Vérifications après déploiement** : `GET /api/v1/health`, puis
   `GET /api/v1/payments/methods` (doit renvoyer la liste configurée) et
   `GET /api/v1/config/app` (coordonnées publiées).
5. **Rattachement du site** : `SITE_INTEGRATION_URL` et
   `SITE_INTEGRATION_TOKEN` pour le catalogue, la grille de livraison et les
   remises automatiques.

---

## 12. Construire l'AAB pour le Play Store (livrable 12)

Procédure complète dans `docs/PUBLICATION-PLAY.md`. Résumé :

```bash
cd apps/mobile
# 1. Build de TEST (APK interne, à installer sur un téléphone réel)
npx eas build --profile preview --platform android

# 2. Build de PUBLICATION (AAB signé)
npx eas build --profile production --platform android

# 3. (optionnel, après validation AGRIM) dépôt en piste interne, en brouillon
npx eas submit --profile production --platform android
```

Points de vigilance : `versionCode` à incrémenter à chaque envoi ; signature
gérée par EAS (conserver l'empreinte) ; permissions strictement limitées à
localisation et Internet ; aucun secret dans le bundle ; **aucune publication
sans validation écrite d'AGRIM**.

---

## 13. Ce qui bloque, et qui dépend d'AGRIM (livrable 13)

| # | Élément attendu | Pourquoi c'est bloquant |
|---|---|---|
| 1 | **Numéro officiel de réception** mobile money, par opérateur | sans lui, aucun client ne peut payer par transfert ; l'application refuse d'inventer un numéro |
| 2 | **Nom du bénéficiaire** exact (tel qu'il apparaît à l'écran de l'opérateur) | évite qu'un client hésite ou transfère au mauvais compte |
| 3 | **Instructions opérateur** (parcours, code USSD éventuel) | rédigées par AGRIM : ce sont ses mots que le client suivra |
| 4 | **Zones de livraison, frais et modalités** | la grille actuelle est un calque de test ; publier de vrais tarifs exige la décision d'AGRIM |
| 5 | **Points de vente à publier** (usine Aboukro, boutique 227 Logement, Blockauss) | adresses, horaires, téléphone et ouverture du retrait à confirmer un par un |
| 6 | **Identité visuelle définitive** (logo, couleurs, captures) | la fiche Play Store ne se publie pas avec des visuels provisoires |
| 7 | **Identifiants push** (projet de notification + jeton serveur) | conditionne la phase 4 et les notifications de commande |
| 8 | **Fiche de confidentialité** (URL publique de la politique) | obligatoire au Play Store ; le texte existe dans l'application, l'URL doit être publiée |
| 9 | **Compte Play Console, clé de signature, consentement de publication** | aucun envoi sans validation écrite d'AGRIM |
| 10 | **Coordonnées officielles de support** (mobile, standard, WhatsApp, e-mail) | remplacées dans l'administration ; ne pas les laisser sur les valeurs de test |

---

## 14. Ce qu'il reste à finaliser (livrable 14)

1. **Phase 4 — notifications push** (reportée) : enregistrement du jeton sans
   compte, envoi de campagnes depuis l'administration, liens profonds, test
   application fermée sur appareil réel.
2. **Interface du site** : la page de commande du site doit afficher les
   instructions de transfert au lieu de rediriger vers l'agrégateur (la
   normalisation serveur est déjà en place ; c'est un travail d'interface, hors
   de ce dépôt).
3. **Écran d'administration des numéros de paiement dans l'application** :
   l'API existe et est testée ; l'écran mobile viendra avec le lot
   « administration » (codes promo et points de vente sont déjà faits).
4. **Rapports d'envoi des campagnes** (phase 4) : résultats et erreurs par
   envoi.
5. **Images des points de vente et des bannières** : référencées en base côté
   site ; l'application les affiche quand elles sont publiées.
6. **Tests à faire sur appareil réel**, une fois un build de test disponible :
   installation, ouverture, parcours complet, coupure réseau, fermeture en
   cours de commande, permissions — liste détaillée dans
   `docs/PUBLICATION-PLAY.md`.
7. **Passage en HTTPS** de l'API (le trafic en clair est déjà conditionné à
   l'URL configurée) et vérification finale des en-têtes de sécurité.

---

## 15. Contrôles de cohérence du 11 octobre 2026 (dernier passage)

Passe de vérification exécutée après la rédaction du présent document, pour
supprimer les affirmations non vérifiées :

| Contrôle | Résultat |
|---|---|
| `docs/PUBLICATION-PLAY.md` cité en §12 | **rédigé et vérifié** : identité de l'app, contenu du bundle, APK de test + liste des 13 points à tester sur téléphone, commande AAB, Play Console, notifications, mises à jour, suivi après publication |
| Décompte des migrations | **18** migrations appliquées (et non 20) : recompté sur la base de test **et** sur une base vierge |
| Application des migrations sur base vierge | ✅ les 18 migrations s'appliquent sans erreur (483 ms), y compris la clé étrangère de `payment_review_logs` |
| Écart de contraintes base de développement / base neuve | **1 seul écart** trouvé (`payment_review_logs_actorId_fkey`) : corrigé, plus aucun écart |
| `README.md` | marque corrigée (**BÉLIER D'OR**, il annonçait encore « RIZ BOAGNI ») et décompte de tests remis à jour (435 + 289 = 724, au lieu de « 481 ») |
| Documentation périmée | titres « RIZ BOAGNI » corrigés dans 7 documents (`ARCHITECTURE`, `DATABASE`, `API-CONTRACT`, `ADMIN`, `AUTHORIZATION`, `STATUS-MODEL`, `APK-DE-TEST`) ; les rapports d'audit conservent la mention d'origine, c'est le constat daté |
| Commentaire du DTO de commande (`codePromo`) | réécrit : il décrivait encore un relais vers le site, alors que la vérification est faite par la règle unique locale |
| Références de fichiers citées dans ce document | 41 chemins vérifiés, **tous existants** |
| Tests et contrôles | API **37 suites / 435 tests**, mobile **33 suites / 289 tests**, `tsc --noEmit` et `eslint --max-warnings 0` sans erreur dans les deux espaces de travail |

Ces contrôles ne remplacent pas les tests sur appareil réel (§14, point 6) :
ceux-ci exigent un APK et un téléphone.

---

_Document de livraison — mis à jour le 11 octobre 2026._
_Prochaine mise à jour attendue : après fourniture par AGRIM des éléments du §13._
