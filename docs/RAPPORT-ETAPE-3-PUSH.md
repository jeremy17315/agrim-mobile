# Rapport — Étape 3 : le push complet

**Date** : 16 octobre 2026
**Branche** : `arena/c9a9604c-agrim-mobile`
**Statut** : implémenté et vérifié — **en attente de votre validation**.

---

## 1. Les trois problèmes réglés

1. **Un client sans compte était injoignable.** Le jeton de notification était rattaché à un COMPTE
   (`PushToken.userId` obligatoire). Or le parcours d'achat est volontairement sans compte : un invité
   qui paie sa commande ne recevait donc **rien** — ni confirmation de paiement, ni arrivée du livreur.
   La table `push_devices` existait depuis des mois… sans aucune route pour l'alimenter.
2. **Les liens enregistrés ne menaient nulle part.** `Notification.linkTarget` / `linkValue` — la
   destination d'une notification — n'étaient **jamais écrits** et **jamais lus**. Un tap ouvrait au
   mieux la commande devinée par identifiant, au pire rien. Aucun écran ne savait ouvrir une fiche
   produit, une catégorie ou un dossier interne.
3. **Les campagnes n'existaient que sur le papier.** La table `notification_campaigns` et le contrat
   (`linkTarget`, `audience`, statuts, compteurs) étaient prêts, mais **aucun code** ne les utilisait :
   impossible de rédiger ni d'envoyer une promotion depuis AGRIM.

---

## 2. Ce qui a été fait

### 2.1 Recevoir sans compte — l'appareil, pas l'utilisateur

| # | Décision | Pourquoi |
|---|---|---|
| 1 | `POST /notifications/devices` est **publique** et accepte la session (`withOptionalAuth`) | Un invité enregistre son appareil sans créer de compte ; un client connecté voit le sien rattaché **automatiquement**. Le compte vient du jeton de session, **jamais** du corps de la requête — sinon n'importe qui rattacherait l'appareil d'un autre à son compte. |
| 2 | L'installation est identifiée par un `installationId` aléatoire conservé sur l'appareil | C'est l'appareil qui reçoit, pas la personne. L'identifiant n'accorde aucun droit : il ne sert qu'à retrouver la ligne à mettre à jour. |
| 3 | Le numéro d'un invité est **déclaré sur l'appareil** (à la commande) | C'est la seule façon de le retrouver : le serveur cherche les appareils par numéro pour annoncer un paiement confirmé ou un livreur en route. |
| 4 | À la déconnexion, l'appareil est **détaché** du compte mais reste actif | Le compte suivant ne reçoit pas les notifications du précédent ; l'appareil continue de recevoir les commandes invitées passées depuis ce téléphone. |
| 5 | Un jeton mort (application désinstallée) est **désactivé**, pas supprimé ; un jeton présent dans les deux tables ne reçoit qu'**un** envoi | La trace explique pourquoi un appareil ne reçoit plus rien ; personne ne reçoit deux fois le même message. |

Le numéro déclaré est un numéro de livraison, pas une preuve d'identité : il n'ouvre l'accès à aucun
compte. Un invité ne peut donc **pas** consulter un historique de notifications dans l'application (il n'y
a aucun moyen de prouver que le numéro est le sien) — c'est dit au §6.

### 2.2 Un lien qui mène à un écran précis

- **Une seule table de traduction**, dans le contrat partagé : `deepLinkToPath({target, value})`.
  `produit` → fiche produit, `categorie` → catalogue filtré, `offre` → catalogue, `commande` → suivi de
  commande, `gestion` → dossier interne, `information` → liste des notifications.
- `notify()` **enregistre** désormais la destination en base **et** la transporte dans la charge utile
  poussée (`target`/`value`, plus `reference` pour les applications déjà installées).
- Les notifications d'équipe visent `gestion`, celles d'un invité visent `commande`.
- `deepLinkFromData()` relit une charge utile **abîmée** sans planter, et sait encore ouvrir les
  notifications **anciennes**, qui ne portaient qu'une référence de commande.
- Une destination inconnue ne perd personne : on ouvre la liste des notifications.

### 2.3 Des campagnes utilisables et honnêtes

`GET /campaigns`, `POST /campaigns`, `POST /campaigns/:id/send` — **`ADMIN` et `DG`**, comme les codes
promo (une campagne part vers tous les appareils d'un coup, c'est un engagement commercial).

| Règle tenue par le code | Ce qu'elle empêche |
|---|---|
| **Brouillon puis envoi — deux gestes** | Envoyer une faute de frappe à toute la clientèle d'un seul appui. |
| **Public ciblé** : tous les appareils abonnés / les comptes / l'équipe (test) | Une promotion involontaire envoyée aux clients pendant un essai. |
| **Consentement respecté** : seuls les appareils `promoOptIn` reçoivent une campagne | Les messages de commande et de paiement, eux, ne dépendent jamais de cette préférence. |
| **Un second envoi est refusé** (`updateMany` conditionnel, donc insensible à un double appui ou à deux responsables simultanés) | Envoyer deux fois la même promotion. |
| **Reprise permise uniquement si RIEN n'est parti** ; un envoi partiel est refusé et expliqué | Doubler le message chez les appareils déjà servis. |
| **Compteurs honnêtes** : visés / acceptés / refusés / jetons invalides. Aucun compteur ne dit « lu » | Une interface qui prétendrait qu'un envoi a été vu. |
| **Reason d'échec écrite** quand rien n'a abouti | Une campagne marquée « envoyée » alors que personne n'a été prévenu. |
| **Recopie dans la liste de notifications** des clients qui ont un compte | Un push perdu (application fermée, refus système) = information perdue. |
| Traçé au journal des envois (`MessageLog`) | Un envoi de masse sans trace. |

### 2.4 Dire la vérité sur l'état du push

- `GET /config/app` publie désormais `push.enabled` (état réel du serveur).
- L'application **ne demande pas la permission de notifier** si le serveur ne peut rien envoyer, et
  l'écran des notifications l'écrit franchement au lieu de promettre « vous serez prévenu ».
- Le pilote inerte n'annonce plus d'envois qu'il n'a pas faits (`sent: 0`) : les compteurs, le journal et
  le repli SMS s'appuyaient sur ce chiffre.

---

## 3. Fichiers touchés

| Fichier | Changement |
|---|---|
| `packages/contracts/src/push.ts` | `deepLinkToPath` (seule traduction destination → route), `NOTIFICATION_FALLBACK_PATH`, destination `gestion`, `deepLinkFromData` tolérant (relit l'ancienne charge utile). |
| `packages/contracts/src/push.test.ts` | **Nouveau.** 12 tests : chaque destination, l'échappement des caractères réservés, la charge utile abîmée, les notifications anciennes, la table des libellés complète. |
| `packages/contracts/src/app-config.ts` | Section `push` (`enabled`) dans la configuration publiée. |
| `packages/contracts/src/schemas.ts` | `notificationSchema` : `linkTarget` / `linkValue` ; `campaignSchema` ; `createCampaignSchema` (bornes du contrat, valeur obligatoire selon la destination). |
| `apps/api/src/notifications/dto/register-device.dto.ts` | **Nouveau.** `RegisterDeviceDto` (installation, jeton Expo, plateforme, numéro d'invité, version d'application, promotions) et `UpdateDeviceDto`. |
| `apps/api/src/notifications/notifications.service.ts` | Enregistrement / détachement / mise à jour d'appareil ; destination écrite et transportée ; envoi dédoublonné entre les deux tables ; jetons morts désactivés. |
| `apps/api/src/notifications/notifications.controller.ts` | `POST` / `PATCH` / `DELETE /notifications/devices` (publiques, session facultative). |
| `apps/api/src/notifications/campaigns.service.ts` | **Nouveau.** Rédaction, audiences, consentement, envoi unique, compteurs, journal. |
| `apps/api/src/notifications/campaigns.controller.ts` | **Nouveau.** `GET` / `POST /campaigns`, `POST /campaigns/:id/send` (`ADMIN`, `DG`). |
| `apps/api/src/notifications/dto/create-campaign.dto.ts` | **Nouveau.** Bornes et listes issues du contrat partagé. |
| `apps/api/src/notifications/push.provider.ts` | Le pilote inerte ne prétend plus envoyer. |
| `apps/api/src/app-config/app-config.service.ts` | Publie `push.enabled`. |
| `apps/api/src/notifications/campaigns.service.spec.ts` | **Nouveau.** 14 tests : consentement, audiences, double envoi, reprise, compteurs, destination corrompue. |
| `apps/api/src/notifications/notifications.devices.spec.ts` | **Nouveau.** 8 tests : appareil sans compte, réattribution du jeton, numéro conservé, détachement, destination par défaut, code de livraison jamais poussé, envoi unique. |
| `apps/mobile/src/lib/installation.ts` | **Nouveau.** Identifiant d'installation persistant + numéro d'invité conservé. |
| `apps/mobile/src/lib/pushDevice.ts` | **Nouveau.** Déclaration du numéro d'un invité sur son appareil. |
| `apps/mobile/src/lib/usePushRegistration.ts` | Enregistrement sans compte, détachement à la déconnexion, permission non demandée si le serveur n'envoie pas, lien profond au tap (y compris lancement par la notification). |
| `apps/mobile/src/api/config.ts` | Lit `push.enabled` (valeur par défaut : désactivé). |
| `apps/mobile/src/api/notifications.ts` | Appels d'appareil (`registerPushDevice`, `unlinkPushDevice`, `updatePushDevice`). |
| `apps/mobile/app/_layout.tsx` | Le suivi du push vit **dans** le fournisseur de requêtes (l'état du push vient de `GET /config/app`). |
| `apps/mobile/app/notifications/index.tsx` | Suit la destination enregistrée par le serveur ; dit la vérité quand les alertes ne sont pas activées. |
| `apps/mobile/app/commande/index.tsx` | Le numéro de l'invité est déclaré sur son appareil au moment de la commande. |
| `apps/mobile/src/__tests__/enregistrement-appareil.test.tsx` | **Nouveau.** 7 tests : appareil d'invité, push désactivé, déconnexion, numéro déclaré, tap → écran visé, notification ancienne, pas de double ouverture. |
| `apps/mobile/src/__tests__/notifications.screen.test.tsx` | 3 tests ajoutés : destination enregistrée, commande invitée absente de l'historique, absence honnête d'alertes. |
| `docs/API-CONTRACT.md` | Appareil, campagnes et consentement documentés. |

Migration de base : **aucune**. Les tables `push_devices` et `notification_campaigns` existaient déjà.

---

## 4. Preuves

| Suite | Résultat | Avant cette étape |
|---|---|---|
| API (`npx jest --runInBand`) | **41 suites / 486 tests — 100 %** | 39 / 464 |
| Mobile (`npx jest`) | **36 suites / 315 tests — 100 %** | 35 / 305 |
| Contrats (`jest`) | **5 suites / 47 tests — 100 %** | 5 / 35 |
| `npm run lint` (API + mobile) | **0 erreur, 0 avertissement** | — |
| `npm run typecheck` (API + mobile) | **0 erreur** | — |

**Essais réels sur l'API vive** (pas seulement en test) et **sur la base** :

```
GET  /config/app                        → push = {"enabled": false}
POST /notifications/devices  (sans compte) → 201 {"registered":true}
PATCH /notifications/devices {phone}       → {"updated":true}
   base : installation "smoke…001", phone "0700000009", userId null, isActive true
DELETE /notifications/devices              → {"removed":true}   (ligne conservée, détachée)
POST /campaigns (CLIENT)                   → 403
POST /campaigns (ADMIN)                    → brouillon, public visé 1, lien produit:riz-royal-grains
POST /campaigns/:id/send                   → FAILED, 0 envoyé, 1 échec, raison écrite :
   « Aucun envoi n'a abouti : service de notifications injoignable, ou notifications
     poussées désactivées sur ce serveur. »
POST /campaigns/:id/send (reprise, rien n'était parti) → acceptée
```

**Aperçu web réellement servi** : le paquet contient `notifications/devices`, `declareGuestPhone`,
`agrim.installationId` et la phrase honnête « Les alertes automatiques ne sont pas encore activées… »
(HTTP 200, 7 108 930 octets).

---

## 5. Comment l'essayer — et ce qui ne peut pas être montré ici

Ce qui se voit immédiatement dans l'aperçu :

1. **Notifications** → l'écran explique que les alertes automatiques ne sont pas activées sur cet
   environnement (c'est exact : `PUSH_ENABLED=false`).
2. **Commander** → le numéro saisi est déclaré sur l'appareil (vérifiable en base, `push_devices`).
3. **Campagnes** → utilisables dès maintenant par l'API (curl / Swagger `…/api/v1/docs`), compte `ADMIN`.

Ce qui ne peut **pas** être montré dans cet environnement, et pourquoi :

- **Aucun jeton de notification** n'est délivré à l'aperçu web (ce n'est pas un appareil) ni dans un
  émulateur : l'enregistrement d'appareil ne se déclenche que sur un téléphone réel, avec un projet EAS.
- **Aucun envoi réel** : il faut `PUSH_ENABLED=true` **et** un vrai jeton. Tant que c'est désactivé, une
  campagne s'affiche honnêtement en échec avec sa raison — c'est exactement ce que montrent les essais.
- **Commande invitée impossible en local** : `SITE_INTEGRATION_URL` est vide, donc le serveur ne peut pas
  confirmer la disponibilité. C'est une limite de l'environnement, pas du code (les tests d'API couvrent le
  parcours complet avec un double du site).

Pour activer le push sur un vrai téléphone : `PUSH_ENABLED=true` côté serveur, et une version de
développement EAS (le push distant n'existe plus dans Expo Go).

---

## 6. Ce qui n'est PAS dans cette étape

- **L'écran d'administration des campagnes** dans l'application : l'API est prête et testée
  (brouillon, envoi, compteurs), mais la rédaction se fait pour l'instant en curl / Swagger. L'écran
  suivrait le modèle de l'éditeur de codes promo (`/direction/promotions`).
- **L'écran de préférences « promotions »** : le serveur respecte `promoOptIn` et sait le modifier
  (`PATCH /notifications/devices`), mais aucune interface ne permet encore de le refuser. Un appareil
  naît donc abonné (défaut du schéma).
- **Historique de notifications pour un invité** : sans compte, rien ne prouve que le numéro saisi est le
  sien ; l'invité reçoit les notifications poussées, pas la liste dans l'application.
- **Push navigateur (clé VAPID), notifications programmées** (`scheduledAt` existe en base, mais aucune
  interface ne le remplit), **image dans une campagne** (`imageUrl` inutilisé).

---

## 7. Prochaine étape proposée, dès votre validation

**Étape 4 — l'écran de campagne + les préférences de notification** : rendre le push utilisable sans
curl depuis l'application (rédiger, cibler, relire, envoyer, suivre les compteurs) et laisser chaque
client refuser les promotions — les deux règles sont déjà écrites et testées côté serveur.

Ensuite, selon l'ordre convenu : **remboursement**, puis favoris, reçu/facture, recommander, créneaux de
livraison, carnet d'adresses, tri et filtres.

Dites-moi simplement « valider », ou corrigez ce qui doit l'être.
