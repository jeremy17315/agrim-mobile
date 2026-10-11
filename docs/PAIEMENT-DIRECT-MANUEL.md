# Paiement direct manuel — configuration et vérification

_Document de livraison — phase 3 du 11 octobre 2026._

Ce document décrit le régime de paiement **en vigueur** et la procédure que
l'équipe AGRIM suit pour encaisser une commande. Il contient :

1. ce qui a changé et pourquoi ;
2. les **paramètres qu'AGRIM doit fournir** (aucun n'est inventé dans le code) ;
3. la configuration des moyens de paiement ;
4. la **procédure de vérification** d'une déclaration client ;
5. les garanties techniques, et ce que le dispositif ne fait pas ;
6. les tests réellement exécutés, avec leur résultat.

---

## 1. Ce qui a changé

**Décision commerciale :** AGRIM cesse d'utiliser un agrégateur de paiement
(commission sur chaque transaction). Pour les **nouvelles commandes**, le
client transfère lui-même le montant vers le numéro mobile money officiel
d'AGRIM, puis déclare sa transaction ; un responsable vérifie la réception
réelle des fonds avant de confirmer la commande.

Deux régimes coexistent, et ne se mélangent jamais :

| | Commandes nouvelles | Commandes antérieures au 11/10/2026 |
|---|---|---|
| Moyen enregistré | `DIRECT_MOBILE_MONEY` (ou `CASH_ON_DELIVERY`) | `MOBILE_MONEY` (agrégateur), historique |
| Encaissement | Transfert manuel vers le numéro AGRIM | Inchangé, via l'agrégateur |
| Confirmation | Humaine, par un gestionnaire, dans l'application | Rapprochement de l'agrégateur |
| Webhooks | **Refusés** (`PAYMENT_NOT_AGGREGATOR`) | Traités comme avant |

Pourquoi les anciens pilotes d'agrégateur restent branchés : les commandes
déjà payées par ce chemin doivent pouvoir être relues, rapprochées et closes.
Les retirer ferait de ces paiements des dossiers orphelins. La garantie qui
compte est structurelle : **aucune commande nouvelle ne peut naître avec
`MOBILE_MONEY`** — une application déjà installée qui l'envoie encore est
servie par le transfert direct, elle n'est jamais refusée.

---

## 2. Paramètres à fournir par AGRIM (aucun n'est dans le code)

| Paramètre | Où il se saisit | Exemple |
|---|---|---|
| Opérateurs à proposer | administration → moyens de paiement | Orange Money, MTN MoMo, Moov Money, Wave |
| Numéro officiel de réception, **par opérateur** | administration → moyens de paiement | `07 00 05 04 52` |
| Nom du bénéficiaire | administration → moyens de paiement | `AGRIM SARL` |
| Instructions montrées au client | administration → moyens de paiement | « Choisissez *Transfert*, puis saisissez le numéro… » |
| Modèle d'ouverture de l'application opérateur (si disponible) | administration → moyens de paiement | `tel:*144*1*1*{number}*{amount}%23` |
| Activation d'un moyen | administration → moyens de paiement | `isActive` — **désactivé par défaut à la création** |

Tant qu'aucun moyen n'est activé, **l'application ne propose que le paiement à
la livraison** et affiche une explication. Elle n'affiche jamais un numéro
qu'elle ne connaît pas : `GET /payments/methods` renvoie la liste réelle, et
une liste vide est un état normal.

---

## 3. Configurer un moyen de paiement

### Depuis l'administration (API)

Réservé aux rôles **ADMIN** et **DG** — un gestionnaire ne peut pas changer la
cible des encaissements.

```http
POST /api/v1/management/payments/methods
Authorization: Bearer <jeton ADMIN ou DG>
Content-Type: application/json

{
  "code": "ORANGE_MONEY",
  "operatorName": "Orange Money",
  "receivingNumber": "+225 07 00 05 04 52",
  "beneficiaryName": "AGRIM SARL",
  "instructions": "Ouvrez votre application Orange Money, choisissez « Transfert », puis indiquez le numéro ci-dessus.",
  "isActive": true,
  "sortOrder": 1
}
```

- `code` : identifiant technique stable, majuscules/chiffres/`_`.
- `receivingNumber` : validé en forme, jamais contre une liste fermée — AGRIM
  peut publier un opérateur que l'application ne connaît pas encore.
- `isActive` : à la **création**, vaut `false` si le champ est absent. Un
  moyen publié par erreur n'est jamais exposé aux clients avant relecture.

Pour retirer un moyen : `DELETE /api/v1/management/payments/methods/:id`. Le
moyen est **désactivé, jamais supprimé** : l'historique des commandes y renvoie.

`GET /api/v1/management/payments/methods` liste tous les moyens, actifs ou non.

### Depuis l'application

L'écran de vérification est accessible depuis l'espace Gestion
(icône smartphone de l'en-tête). L'édition des numéros se fait par l'API
ci-dessus : la modifier depuis le mobile viendra avec l'écran d'administration
dédié (phase 5).

---

## 4. Procédure de vérification d'un paiement

### Côté client

1. Au checkout, le client choisit « Payer maintenant par … » (un opérateur
   configuré) ou « Paiement à la livraison ».
2. La commande est créée ; le montant attendu, le moyen choisi **et le numéro
   affiché** sont figés sur la commande.
3. L'écran de paiement affiche : montant exact, numéro officiel, bénéficiaire,
   instructions d'AGRIM, référence de commande à rappeler. Tout est copiable
   en un geste.
4. Le client transfère depuis son application opérateur, puis **déclare** :
   référence de transaction (obligatoire), montant transféré (pré-rempli avec
   le montant attendu), note facultative, justificatif facultatif (JPEG/PNG/
   WebP/PDF, 5 Mo maximum).
5. La commande reste « en attente ». Le client peut fermer l'application et
   revenir : sa déclaration est conservée, et l'écran se met à jour tout seul.

### Côté AGRIM

1. Ouvrir **Gestion → Paiements à vérifier**. La file est triée du plus ancien
   au plus récent.
2. Pour chaque dossier, l'écran montre : n° de commande, nom et téléphone du
   client, **montant attendu**, montant déclaré (l'écart est signalé en rouge),
   moyen et numéro de réception, référence de transaction, date de déclaration,
   présence d'un justificatif.
3. **Contrôler les fonds reçus** sur le compte marchand (application opérateur
   ou relevé), en rapprochant la référence de transaction annoncée.
4. Décider :
   - **Confirmer la réception des fonds** → la commande passe à « confirmée »,
     le client est prévenu par notification, et la décision est journalisée au
     nom de son auteur ;
   - **Rejeter la déclaration** → le motif est **obligatoire** ; il est
     conservé au dossier ET affiché au client sur son écran de paiement, et la
     commande n'est **pas** annulée (AGRIM garde la main : vérification
     complémentaire, autre référence, contact direct) ;
   - ne rien faire : le dossier reste en vérification, aucune échéance ne
     l'expire (contrairement à l'ancien régime).

### Règles qui protègent AGRIM

| Risque | Ce qui l'empêche |
|---|---|
| Deux gestionnaires confirment en même temps | bascule conditionnelle : le second reçoit `PAYMENT_ALREADY_SETTLED` (409), rien n'est appliqué deux fois |
| Le même transfert sert deux commandes | `transactionReferenceNormalized` est **unique** : la seconde déclaration est refusée (`PAYMENT_REFERENCE_ALREADY_USED`) |
| Un client modifie son montant ou son statut | le montant attendu est figé sur la commande ; aucune route client n'écrit le statut |
| Un client « confirme » seul | aucun chemin automatique ne mène à `SUCCEEDED` : seule la revue humaine y mène |
| Un montant incohérent passe inaperçu | écart = `UNDER_REVIEW` automatique, signalé dans la file |
| Un numéro est détourné | la configuration est réservée ADMIN/DG, journalisée (`updatedBy`) |
| Un justificatif piégé est stocké | type MIME et taille contrôlés **avant** tout dépôt |

### Ce que le dispositif ne fait pas

- Il **ne prouve pas** un virement : une capture d'écran n'est pas une preuve,
  le geste « J'ai payé » n'existe pas comme validation. La confirmation vient
  du contrôle humain des fonds.
- Il **ne rembourse pas** automatiquement : un rejet laisse AGRIM libre de
  traiter le dossier (le client est informé, avec le motif).
- Il **ne demande jamais** le code secret du client, et aucun code PIN n'est
  stocké nulle part.

---

## 5. Garanties techniques (où elles vivent)

| Garantie | Fichier |
|---|---|
| Déclaration, vérification, journal, bascule conditionnelle | `apps/api/src/payments/direct-payments.service.ts` |
| Routes client (compte et invité), justificatif multipart | `apps/api/src/payments/direct-payments.controller.ts` |
| Routes d'administration (RBAC) | `apps/api/src/payments/payment-admin.controller.ts` |
| Configuration des numéros | `apps/api/src/payments/payment-methods.service.ts` |
| Fermeture de l'agrégateur aux nouvelles commandes | `apps/api/src/payments/payments.service.ts`, `apps/api/src/payments/resolve-method.ts` |
| Contrats partagés (statuts, limites, ton des messages) | `packages/contracts/src/payment-direct.ts`, `enums.ts` |
| Écran client | `apps/mobile/app/paiement/[reference].tsx` |
| Écran de vérification | `apps/mobile/app/gestion/paiements.tsx` |

Journal d'audit : chaque décision écrit une ligne `payment_review_logs`
(action, statut avant/après, note, auteur, rôle, source, IP, horodatage).

---

## 6. Tests exécutés, et leur résultat

Commande : `cd apps/api && npx jest --runInBand` (base de test PostgreSQL
locale migrée et amorcée), `cd apps/mobile && npx jest`.

| Suite | Résultat |
|---|---|
| API — 35 suites, **418 tests** | ✅ 418 / 418 |
| Mobile — 31 suites, **279 tests** | ✅ 279 / 279 |
| `tsc --noEmit` (API et mobile) | ✅ aucune erreur |
| `eslint` (API et mobile, `--max-warnings 0`) | ✅ aucune erreur |

Preuves apportées par les tests de la phase 3
(`apps/api/src/payments/paiement-direct.e2e.spec.ts`,
`apps/mobile/src/__tests__/paiement.screen.test.tsx`,
`apps/mobile/src/__tests__/gestion-paiements.screen.test.tsx`) :

- l'agrégateur est **fermé** à une commande nouvelle (`PAYMENT_NOT_AGGREGATOR`) ;
- un ancien client qui envoie encore `MOBILE_MONEY` obtient une commande en
  transfert direct, avec le numéro de réception figé ;
- une commande directe dont le moyen n'est pas configuré est **refusée** — le
  serveur n'invente aucun numéro ;
- après « j'ai déclaré », le paiement est `DECLARED_BY_CUSTOMER` et la commande
  reste `PENDING` : **aucun événement de confirmation n'existe** ;
- une référence de transaction ne peut pas servir deux fois ;
- un montant différent ouvre `UNDER_REVIEW` **sans modifier le montant dû** ;
- un rejet sans motif est refusé (400) ; avec motif, le paiement passe à
  `REJECTED` et la commande **n'est pas annulée** ;
- la confirmation par un gestionnaire fait passer le paiement à `SUCCEEDED`, la
  commande à `CONFIRMED`, et écrit le journal au nom de l'auteur ;
- une **seconde** confirmation reçoit 409 : pas de double validation ;
- le parcours invité (capacité temporaire) permet instructions et déclaration,
  et **rien** sans le jeton ;
- l'écran mobile ne confirme jamais de lui-même, ne déclare pas hors connexion,
  et n'annonce la confirmation qu'après le statut réel du serveur.

---

## 7. Reste à faire sur ce sujet

- **Site web** : aligner la page de commande du site sur le transfert direct
  (elle passe aujourd'hui par l'API, donc elle est déjà normalisée en transfert
  direct côté serveur ; son interface doit être mise à jour pour afficher les
  instructions au lieu de rediriger vers l'agrégateur).
- **Écran d'administration des numéros** dans l'application (l'API existe).
- **Notification « paiement déclaré » vers le client** : le message est écrit
  et l'envoi est préparé (phase 4, notifications).

_Dernière mise à jour : 11 octobre 2026._
