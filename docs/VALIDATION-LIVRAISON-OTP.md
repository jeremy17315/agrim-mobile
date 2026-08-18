# Validation de livraison par OTP

Remplace la preuve signature/photo par un code à quatre chiffres remis par le
client et vérifié par le backend.

**Changement de décision assumé** : la preuve signature + photo, retenue
précédemment, est entièrement retirée. Le raisonnement qui la justifiait
(fonctionne hors ligne, ne dépend pas du téléphone du client) reste valable ;
la dépendance au téléphone du client est traitée par la clôture d'exception
réservée à la gestion (§ 8 bis), pas par un repli côté livreur.

---

## 1. Flux

```
Commande confirmée → préparée → mission créée → livreur affecté
  → ACCEPTED    le livreur accepte
  → IN_TRANSIT  il démarre     ← le code est émis et envoyé AU CLIENT
  → ARRIVED     il arrive sur place
  → le client dicte son code, le livreur le saisit
  → le BACKEND vérifie
  → OTP_VERIFIED puis DELIVERED (même transaction)
```

Issue de secours, quand le client ne peut pas donner son code : clôture
d'exception par la **gestion**, avec motif — jamais par le livreur (§ 8 bis).

`PICKED_UP` disparaît : l'étape « colis récupéré » faisait double emploi avec le
départ. Les livraisons existantes dans cet état sont migrées vers `IN_TRANSIT`.

---

## 2. Règles du code

Définies une seule fois, dans `packages/contracts/src/delivery-otp.ts`
(`DELIVERY_OTP_CONFIG`), appliquées par le backend et reflétées par le mobile.

| Règle        | Valeur                   | Justification                                                              |
| ------------ | ------------------------ | -------------------------------------------------------------------------- |
| Longueur     | 4 chiffres               | imposé                                                                     |
| Durée de vie | 60 min                   | couvre une course urbaine ; se régénère sans friction                      |
| Tentatives   | 5                        | 4 chiffres = 10 000 combinaisons ; 5 essais ⇒ 0,05 % de réussite au hasard |
| Renvois      | 5 max, 60 s d'intervalle | évite que le renvoi en boucle serve de harcèlement                         |
| Usage        | unique                   | consommé à la première vérification réussie                                |
| Unicité      | un seul code actif       | une régénération invalide le précédent                                     |

**Génération** : `crypto.randomInt` (générateur cryptographique du système),
pas `Math.random()` qui est prédictible. Les codes à zéros initiaux (`0007`)
sont valides — le code est une chaîne, jamais un nombre.

**Stockage** : seule l'empreinte SHA-256 est persistée. Une fuite de base ne
permet pas de valider une livraison.

> SHA-256 nu, sans Argon2 : sur 10 000 valeurs, un algorithme lent n'apporterait
> aucune résistance réelle. La protection vient de la durée de vie, du plafond de
> tentatives et de l'usage unique. Le haché évite que le code soit lisible en
> base ou dans une sauvegarde.

---

## 3. Les cinq conditions

`DeliveryOtpService.verify()` les contrôle ensemble — aucun chemin ne peut en
contourner une :

1. code exact (comparaison d'empreintes) ;
2. non expiré ;
3. non consommé et non invalidé ;
4. rattaché à la livraison concernée ;
5. livreur habilité sur cette mission.

La consommation est atomique (`updateMany` filtrant sur `verifiedAt: null`) :
deux requêtes simultanées avec le bon code ne valident qu'une seule fois.

Un échec incrémente le compteur **avant** de répondre ; sans cela, une saisie
automatisée épuiserait les 10 000 combinaisons.

---

## 4. Le livreur ne peut pas contourner le code

Trois barrières indépendantes :

- **Contrat** : `COURIER_SETTABLE_DELIVERY_STATUSES` exclut `OTP_VERIFIED` et
  `DELIVERED`. Le type TypeScript rend la demande impossible à écrire côté
  mobile — le compilateur a d'ailleurs signalé chaque appel existant.
- **Backend** : `PATCH /deliveries/:id/status` rejette tout statut non
  positionnable par le terrain → **403 `COURIER_CANNOT_SET_STATUS`**.
- **Interface** : aucun bouton de validation manuelle ; le champ de code
  n'apparaît qu'à l'état `ARRIVED`.

Le seul chemin vers `DELIVERED` est `POST /deliveries/:id/verify-otp`.

---

## 5. Le livreur ne voit jamais le code

- La réponse à `PATCH .../status` ne le contient pas.
- `GET /deliveries/:id/otp-status` renvoie l'état (actif, expiré, tentatives
  restantes) **sans jamais le code**.
- Le code n'apparaît dans aucun journal : `DeliveryOtpService` ne journalise
  que l'identifiant de la livraison. Vérifié sur les journaux d'une exécution
  réelle — 0 occurrence.

**Le code ne part pas en notification poussée.** Une notification transite par
un service tiers (Expo) et s'affiche sur un écran verrouillé, à la vue de
n'importe qui — y compris du livreur qui attend devant la porte. Le message dit
seulement « Ouvrez le suivi pour voir le code ».

**Le code n'est pas non plus écrit en clair dans la notification stockée.**
C'était un défaut de la première version : `codeHash` protégeait la table
`DeliveryOtp` pendant que `Notification.body` conservait la valeur lisible,
sans limite de durée et bien après la livraison. Hacher une donnée d'un côté
en la laissant en clair de l'autre ne protège rien.

Correction : le code est **chiffré au repos** (AES-256-GCM, colonne
`codeCipher`, format `iv:tag:données` en base64url) et n'est déchiffré que pour
le propriétaire de la commande, à la demande, via `GET
/deliveries/orders/:reference/otp`. La clé vit dans `ENCRYPTION_KEY`, distincte
des secrets JWT — une clé qui signe des jetons ne doit pas aussi déchiffrer des
données. La réponse porte `Cache-Control: no-store`.

Les deux colonnes ont chacune leur rôle : `codeHash` (SHA-256) sert à
**vérifier** la saisie du livreur sans jamais rendre le code lisible côté
vérification ; `codeCipher` sert à le **relire** pour son propriétaire. Une
empreinte ne peut pas être relue, un chiffré ne devrait pas servir de
comparateur.

La migration a purgé les corps de notification existants et invalidé les codes
alors actifs : 163 notifications `DELIVERY_OTP` en base, **0 contenant un code**.

---

## 6. GPS

Position **facultative**, enregistrée comme traçabilité (`otpLatitude`,
`otpLongitude`, `otpVerifiedAt`). Elle n'est jamais une condition : un immeuble
qui bloque le signal ne doit pas empêcher une livraison réelle d'être validée.
Le mobile joint la dernière position déjà connue du suivi, sans nouvelle demande
de permission ni attente.

---

## 7. Côté client

Carte sur l'écran de suivi, visible uniquement pendant la livraison. Le code
est demandé au serveur au moment de l'affichage (`useDeliveryCode`), jamais lu
dans les notifications ; la requête est désactivée hors livraison et le
résultat n'est pas mis en cache (`gcTime: 0`).

- code affiché en grand, groupé par deux (`48 21`) pour être dicté sans erreur ;
- libellé pour lecteur d'écran chiffre par chiffre (« 4 8 2 1 »), sinon `4821`
  serait annoncé « quatre mille huit cent vingt et un » ;
- consigne explicite : **à la remise uniquement, jamais par téléphone à
  l'avance** ;
- bouton « Je n'ai pas reçu mon code » (renvoi, réservé au propriétaire de la
  commande).

---

## 8. Suppressions

- Modèle : colonnes `proof*` retirées, énumération `DeliveryProofMethod`
  supprimée. Conserver ces colonnes aurait laissé des données personnelles sans
  usage.
- Contrats : `submitDeliveryProofSchema`, `deliveryProofSchema`,
  `DELIVERY_PROOF_*`.
- Mobile : `SignaturePad.tsx`, capture photo, `uploadProofFile`.
- **API : `FilesController` et `FilesService` supprimés.** Plus aucun fichier
  n'est déposé par les utilisateurs ; une route d'upload sans consommateur reste
  une surface d'attaque. L'abstraction `StorageProvider` est conservée pour le
  prochain besoin réel (visuels produits).

---

## 8 bis. Clôture d'exception

Le code dépend du téléphone du client : batterie vide, pas de réseau, colis
remis au gardien. Sans issue, ces cas finiraient en `FAILED` alors que le colis
a bien été remis — la donnée serait fausse.

`POST /deliveries/orders/:reference/close`, réservé à **GESTIONNAIRE / ADMIN** :

- **le livreur n'y a pas accès** (403 `FORBIDDEN_ROLE`). C'est le point
  central : celui qui livre ne peut pas être celui qui atteste de la livraison,
  sinon la validation par code ne vaudrait plus rien ;
- **motif obligatoire**, 10 caractères minimum (400 `CLOSURE_REASON_REQUIRED`).
  Un champ libre plutôt qu'une liste de choix : une liste finit cliquée
  mécaniquement, une phrase à écrire engage son auteur ;
- la course doit avoir démarré — `IN_TRANSIT` ou `ARRIVED`, sinon 409
  `DELIVERY_NOT_STARTED`. Clôturer une course jamais partie masquerait un
  problème au lieu de le traiter ;
- tout code encore actif est invalidé dans la même transaction ;
- traçabilité : `closureMode`, `closedById`, `closureReason`, plus un
  avertissement au journal.

Un **code de secours** dicté au livreur avait été envisagé puis écarté : il
recréait exactement la fuite que le chiffrement vient de fermer.

`DeliveryClosureMode` distingue les deux issues :

| Mode               | Origine                                            |
| ------------------ | -------------------------------------------------- |
| `CLIENT_OTP`       | Code saisi par le livreur, confirmé par le client. |
| `MANAGER_OVERRIDE` | Clôture d'exception par la gestion, avec motif.    |

**Mesure au tableau de bord DG.** Une exception non comptée devient la règle :
`manualClosures` et `manualClosureRate` (part des livraisons du mois) sont
affichés comme point de vigilance, en rouge au-delà de
`MANUAL_CLOSURE_ALERT_RATE` (10 %). Le message change alors de sens — ce n'est
plus un incident isolé mais un défaut du parcours à corriger dans le produit,
pas à absorber par les gestionnaires.

---

## 9. API

| Route                                           | Rôle                 | Effet                                                               |
| ----------------------------------------------- | -------------------- | ------------------------------------------------------------------- |
| `POST /deliveries/:id/verify-otp`               | LIVREUR              | Vérifie le code et clôt la course. Seul chemin vers `DELIVERED`.    |
| `GET /deliveries/:id/otp-status`                | LIVREUR              | État du code, jamais le code.                                       |
| `GET /deliveries/orders/:reference/otp`         | CLIENT               | Déchiffre le code pour son propriétaire. `Cache-Control: no-store`. |
| `POST /deliveries/orders/:reference/otp/resend` | CLIENT               | Régénère et renvoie le code. Propriétaire uniquement.               |
| `POST /deliveries/orders/:reference/close`      | GESTIONNAIRE / ADMIN | Clôture d'exception avec motif. Interdite au livreur.               |

Codes d'erreur : `OTP_INVALID` 400, `OTP_NOT_FOUND` 400, `OTP_EXPIRED` 409,
`OTP_ATTEMPTS_EXCEEDED` 409, `OTP_ALREADY_USED` 409, `OTP_RESEND_TOO_SOON` 409,
`OTP_RESEND_LIMIT` 409, `OTP_NOT_AVAILABLE` 409, `DELIVERY_NOT_ARRIVED` 409,
`COURIER_CANNOT_SET_STATUS` 403, `CLOSURE_REASON_REQUIRED` 400,
`DELIVERY_NOT_STARTED` 409, `DELIVERY_ALREADY_CLOSED` 409.

---

## 10. Vérifications

| Vérification                          | Résultat                                                            |
| ------------------------------------- | ------------------------------------------------------------------- |
| Tests API                             | **243 / 16 suites**                                                 |
| Tests mobile                          | **238 / 23 suites**                                                 |
| `tsc --noEmit` + ESLint (API, mobile) | propres                                                             |
| Migrations Prisma                     | appliquées (`PICKED_UP` → `IN_TRANSIT`, puis chiffrement + clôture) |
| Seed                                  | fonctionnel                                                         |
| Build + démarrage réel                | OK                                                                  |

Parcours complet exécuté contre un serveur réel :

```
code reçu par le CLIENT : 0946
code présent côté livreur ?      false
mauvais code               → 400 OTP_INVALID
clôture manuelle DELIVERED → 403 COURIER_CANNOT_SET_STATUS
bon code                   → 201 DELIVERED, otpVerifiedAt renseigné
rejeu du même code         → 409 DELIVERY_ALREADY_CLOSED
commande finale            → DELIVERED
occurrences du code dans les journaux : 0
```

Second parcours, après chiffrement et clôture d'exception (commande
`AGR-2026-0287`) :

```
client lit son code         → 200 { code: '2990' }, Cache-Control: no-store
livreur demande le code     → 403
gestionnaire demande le code→ 403
clôture par le livreur      → 403 FORBIDDEN_ROLE
motif « ok »                → 400
clôture par le gestionnaire → 201 DELIVERED, MANAGER_OVERRIDE, motif conservé
code après clôture          → { code: null }
commande vue par le client  → DELIVERED
tableau de bord DG          → manualClosures: 1
notification stockée        → « Ouvrez le suivi… », ne contient pas 2990
journaux                    → identifiants seuls, 0 occurrence du code
```

Couverture ajoutée : 15 tests unitaires (règles du contrat), 7 sur le
chiffrement (`SecretBoxService` : non-déterminisme, altération détectée, clé
étrangère, entrée mal formée), 21 tests e2e
(émission, non-divulgation, code faux, expiration, épuisement des tentatives,
rejeu, livreur non habilité, arrivée requise, avec et sans GPS, saisie espacée,
renvoi et son délai, refus de clôture manuelle), 10 e2e sur le stockage et la
clôture d'exception, 15 tests d'écran livreur, 8 tests de la carte client,
9 tests de la feuille de clôture, 3 sur l'indicateur DG.

---

## Limites connues

- **La clôture d'exception repose sur la confiance envers la gestion.** Rien
  n'empêche techniquement un gestionnaire de clôturer une livraison qui n'a pas
  eu lieu. C'est assumé : le contrôle est social (motif signé, comptage visible
  par la direction), pas technique. Le rendre technique demanderait une
  contre-signature client a posteriori, disproportionnée en V1.
- **Perte de `ENCRYPTION_KEY`** : les codes en cours deviennent illisibles pour
  leurs propriétaires. Ils sont alors à renvoyer (`.../otp/resend`), ce qui
  régénère un code chiffré avec la nouvelle clé. Aucune rotation automatique
  n'est prévue.
- Codes expirés non purgés : l'historique est conservé pour les litiges. Prévoir
  une purge à l'échéance de la durée de conservation (phase 21).
- Le renvoi est plafonné par livraison, sans limite globale par client
  (phase 21).
