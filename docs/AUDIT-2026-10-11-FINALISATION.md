# Audit de finalisation — AGRIM / BÉLIER D'OR

Date : 11 octobre 2026 · Branche : `arena/30aca01c-agrim-mobile`
Périmètre : monorepo complet (`apps/api`, `apps/mobile`, `packages/contracts`).

> Méthode : chaque affirmation de ce rapport vient d'une **lecture du code
> réel** et d'une **exécution réelle** des suites de tests (base PostgreSQL 18
> montée localement, migrations appliquées par `scripts/apply-migrations.cjs`,
> seed exécuté). Aucune fonctionnalité n'est déclarée « présente » sans preuve.

---

## 1. Architecture constatée

| Élément             | Réalité vérifiée                                                                   |
| ------------------- | ---------------------------------------------------------------------------------- |
| Framework mobile    | **Expo SDK 57** · React Native 0.86.2 · React 19.2 · Expo Router 57 (typed routes)  |
| Langage             | TypeScript strict (API 5.9, mobile 6.0)                                            |
| État / données      | TanStack Query 5 (serveur) · Zustand 5 + AsyncStorage (panier) · SecureStore (jetons) |
| Backend             | **NestJS 11** · Prisma 7 (générateur `prisma-client`, adaptateur `@prisma/adapter-pg`) |
| Base de données     | **PostgreSQL 17/18** — 17 migrations versionnées, schéma de 918 lignes              |
| Contrat partagé     | `packages/contracts` — Zod, énumérations, machine à états, gabarits de messages     |
| Auth                | JWT access + refresh **haché SHA-256 avec rotation**, Argon2, RBAC serveur          |
| Tests               | Jest (API + mobile + contracts) · Supertest (e2e API)                              |
| CI                  | `.github/workflows/ci.yml`                                                          |
| Déploiement         | `render.yaml`, `railway.json`, `docs/refonte/07-deploiement-lws-cpanel.md`          |

### État des tests — mesuré aujourd'hui

| Suite                     | Résultat                                          |
| ------------------------- | ------------------------------------------------- |
| `packages/contracts`      | à exécuter via la CI (Jest + TS)                  |
| `apps/api` (`jest`)       | **407 tests · 406 ✅ · 1 ❌** (test périmé, cf. § 5) |
| `apps/mobile` (`jest`)    | **270 tests · 270 ✅** · 30 suites                |

> Pré-requis mesuré : le mobile résout `@agrim/contracts` par son `dist/` ;
> sans `npm run build -w @agrim/contracts` les 30 suites échouent à l'import.
> À documenter dans le README (fait, cf. § 11).

---

## 2. Fonctionnalités opérationnelles

### Parcours client (sans compte)

- Accueil éditorial avec logo, promesse et entrée catalogue (`app/(tabs)/index.tsx`).
- Catalogue avec recherche, catégories, pagination, état hors ligne
  (`app/(tabs)/catalogue.tsx`, `src/lib/queryPersistence.ts`).
- Fiche produit : formats, prix effectif (promotion datée), disponibilité
  (`app/produit/[slug].tsx`, `common/pricing/effective-price.ts`).
- Panier local-first, persisté, borné par le stock connu
  (`src/store/cart.ts` — 99 max/ligne, 1 seul format par ligne).
- **Commande invitée** : nom + téléphone + zone, aucun mot de passe
  (`POST /orders/guest`, `guest-checkout.service.ts`, profil technique `isGuest`).
- Clé d'idempotence unique (`Order.idempotencyKey`, contrainte `@unique`) :
  double-tap ou rejeu réseau ⇒ **une** commande.
- Recalcul serveur intégral des montants (`POST /cart/quote`, `CartQuoteService`).
- Suivi de commande, annulation client bornée par la machine à états.
- Livraison avec **code de remise chiffré AES-256-GCM**, jamais poussé en
  notification (`delivery-otp.service.ts`, `secret-box.service.ts`).
- Espaces internes : livreur (tournée, GPS), producteur (parcelles, récoltes),
  gestionnaire (file de préparation, stock, journal des mouvements), direction.
- Outbox transactionnelle + dispatcher multi-canal (push / WhatsApp / e-mail)
  + cron de rattrapage (`outbox-drain`, `reconciliation`).
- Catalogue **synchronisé depuis le site** (source de vérité), clés de
  réconciliation `sourceCode` / `sourceRef`.

### Sécurité déjà en place

- Refresh tokens hachés, rotation, détection de vol ; mot de passe Argon2.
- RBAC vérifié côté serveur ; aucune route n'accepte un `userId` en paramètre.
- `helmet`, CORS par liste blanche, throttler global, validation Zod/class-validator.
- En-têtes et erreurs normalisés, aucune donnée technique brute renvoyée.
- Aucun secret dans le bundle mobile (`EXPO_PUBLIC_*` = valeurs publiques seulement).

---

## 3. Fonctionnalités partiellement implémentées

| #      | Sujet                            | Constat réel                                                                                                                                                                                                                                                             |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1     | **Paiement**                     | Le parcours repose **entièrement sur un agrégateur** : `PaymentsModule` injecte `CinetPayProvider` / `PayDunyaProvider` / `SimulationPaymentProvider` derrière `PAYMENT_PROVIDER`. Le statut de paiement est piloté par webhook + réconciliation. **Aucun paiement direct manuel n'existe.** |
| P2     | **Notifications push**           | `ExpoPushProvider` existe et fonctionne (`PushToken`), mais l'enregistrement du jeton est **réservé à un compte connecté** (`usePushRegistration` : `if (userId === null) return`). Un client invité ne reçoit **rien**. Aucune campagne, aucun envoi de test, aucun historique. |
| P3     | **Codes promo**                  | Aucune table locale. Le mobile envoie `codePromo` au site via `SitePricingService.remise`, qui décide seul. Site injoignable ⇒ `unavailable` ⇒ **aucune remise**. Aucune administration, aucune limite d'usage, aucune unicité garantie.                                   |
| P4     | **Points de vente**              | Inexistant en base. Seul le libellé `retrait` de la grille de livraison du site existe (`DeliveryGrid.retrait`). Les trois adresses citées par le brief (Aboukro, 227 Logement, Blockauss) ne sont nulle part.                                                              |
| P5     | **Partage produit**              | **Aucun bouton de partage** (`grep Share` dans `produit/[slug].tsx` : aucune occurrence). Aucun lien profond HTTPS (`app.config.ts` : `scheme: 'agrim'`, pas d'`intentFilters` `autoVerify`). Le partage est donc **absent**, pas « partiel ».                               |
| P6     | **Coordonnées administrables**   | Téléphones et adresse vivent dans `packages/contracts/src/company.ts` (constantes de build). La table `CompanySetting` existe mais n'est pas exposée en administration ; changer un numéro exige une reconstruction de l'application.                                          |
| P7     | **Vérification de paiement**     | `management.service.ts` gère les statuts de **commande**, pas de **paiement**. Aucune file d'attente de paiements à vérifier, aucun journal de validation, aucune preuve.                                                                                                 |
| P8     | **Retrouver une commande**       | Le jeton invité (`GuestPaymentTokenService`) permet de reprendre le paiement, mais il n'existe **aucun moyen de retrouver une commande après réinstallation** de l'application.                                                                                            |
| P9     | **Champ `FileAsset`**            | Modèle Prisma présent, **jamais utilisé** (`grep FileAsset` dans `src/` : 0 résultat). `StorageModule` n'expose aucune route depuis le retrait de la preuve photo. Aucun dépôt de justificatif possible.                                                                     |
| P10    | **Politique de confidentialité** | `legal.controller.ts` cite encore « agrégateur de paiement (CinetPay / PayDunya) pour encaisser ». **Contradiction directe** avec la décision commerciale d'abandon des agrégateurs.                                                                                        |

---

## 4. Fonctionnalités absentes

1. **Paiement direct manuel** vers le numéro mobile money officiel d'AGRIM :
   méthodes configurables, affichage du numéro/bénéficiaire/montant/référence,
   déclaration de transaction par le client, dépôt de justificatif facultatif.
2. **Statuts de paiement manuel** : déclaré par le client, en vérification,
   confirmé, rejeté, montant incorrect.
3. **Interface de vérification** des paiements (liste, confirmation, rejet
   motivé, historique horodaté avec identité de l'administrateur).
4. **Vérification d'unicité** d'une référence de transaction (un paiement ne
   doit pas valider deux commandes).
5. **Notifications push hors compte** : installation anonyme, jeton lié à la
   commande invitée, préférence de désinscription des promotions.
6. **Campagnes de notifications** administrables : titre, message, catégorie,
   image, lien de destination, envoi de test, programmation, historique,
   résultats et erreurs du service push.
7. **FCM** (ou équivalent) alors que le brief le cite expressément — le
   fournisseur actuel est Expo Push uniquement.
8. **Liens profonds** produit / offre / commande (`intentFilters` Android,
   `associatedDomains` iOS, routes de destination).
9. **Codes promo administrables** (unicité, dates, type, valeur, produits
   concernés, minimum, zone, quota d'utilisation, compteur).
10. **Points de vente** et **zones de livraison** administrables depuis
    l'application (la grille vient du site via `CompanySetting`, mais aucune
    administration n'existe côté application).
11. **FAQ / informations de livraison** dans l'application.
12. **Procédure de publication Play Store** : `eas.json` est prêt (profil
    `production` en `app-bundle`, `autoIncrement`), `versionCode: 1`,
    mais aucune fiche de publication, aucun texte de listing, aucune
    déclaration « Sécurité des données » préparée.

---

## 5. Anomalies à corriger

| Gravité   | Anomalie                                                                                                                                                             | Emplacement                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Élevée** | Test rouge : `expect(deliveryFee).toBe(1000)` alors que la règle du 2 octobre 2026 (aucun frais encaissé en ligne) impose `0`. Le test contredit la règle métier.  | `apps/api/src/orders/orders.e2e.spec.ts:176`            |
| **Élevée** | Politique de confidentialité et CGU publiées (URL exigée par le Play Store) mentent sur le traitement des paiements (agrégateur).                                    | `apps/api/src/legal/legal.controller.ts`                |
| Moyenne   | `PUSH_ENABLED=false` par défaut : un déploiement de production peut partir **sans notification** sans que personne ne s'en aperçoive (aucun avertissement de démarrage). | `notifications.module.ts`                               |
| Moyenne   | Le mapping des statuts de paiement est dupliqué (contrat, schéma Prisma, service) sans test de cohérence ; tout ajout de valeur casse silencieusement un écran.        | `contracts/enums.ts`, `schema.prisma`, `payments.service.ts` |
| Moyenne   | `PaymentStatus.AWAITING_CONFIRMATION` devient ambigu dès que le paiement manuel arrive (attente d'un webhook ≠ attente d'une vérification humaine).                    | `schema.prisma`                                         |
| Faible    | README annonce « 481 tests » et « phases 21 à 25 restantes » ; la réalité mesurée est 407 + 270. Documentation périmée.                                               | `README.md`                                             |
| Faible    | Le mobile ne peut pas être testé sans avoir construit `packages/contracts` (échec d'import en masse) ; non documenté.                                                 | `README.md`, `apps/mobile/jest.config.js`               |

---

## 6. Risques liés aux modifications

| Risque                                                                          | Parade retenue                                                                                                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Casser les **commandes historiques** réglées via l'agrégateur                   | Les statuts et tables existants sont **conservés** ; le webhook et la réconciliation continuent de fonctionner pour ces commandes. Aucune migration destructive. |
| Une **migration** mal appliquée sur une base de production                      | Migration **additive seulement** (nouveaux enums + nouvelles tables), appliquée par `scripts/apply-migrations.cjs` puis vérifiée par la suite e2e complète. |
| Le **site** consomme l'API (145 routes en transition)                           | Aucune route existante n'est supprimée ni renommée. Les nouveaux endpoints sont additifs (`/payments/direct/*`, `/promo-codes`, `/push/*`, `/config/*`). |
| Double décompte d'une remise (promo locale **et** promo du site)                | Un code promo connu localement n'est **jamais** transmis au site : le local fait foi. La remise totale est plafonnée au sous-total. |
| Le client croit avoir payé parce qu'il a déclaré un paiement                     | Aucune transition automatique vers « payé ». `SUCCEEDED` n'est atteignable que par une action d'administrateur authentifié, journalisée. |
| Rupture du parcours invité en modifiant le paiement                              | Le jeton de capacité invité (`x-guest-payment-token`) est conservé et étendu au nouveau parcours ; les tests existants restent la référence. |

---

## 7. Plan d'action priorisé (et état d'avancement)

| Phase | Contenu                                                              | Statut |
| ----- | -------------------------------------------------------------------- | ------ |
| 1     | Audit (ce document)                                                  | ✅     |
| 2     | Corrections fondamentales : test rouge, textes légaux, garde-fous     | ✅     |
| 3     | **Paiement direct manuel** : configuration, parcours, administration | ✅     |
| 4     | **Notifications push** : appareils, FCM, campagnes, liens profonds    | ✅     |
| 5     | Commandes et codes promo : fiabilité, calculs, règles commerciales    | ✅     |
| 6     | Cohérence du catalogue et des données partagées                       | ✅     |
| 7     | Tests, documentation, préparation Play Store                          | ✅     |

Les livrables correspondants sont décrits dans
`docs/LIVRAISON-FINALISATION-2026-10-11.md`.
