# Audit de cohérence et disponibilité hors connexion — AGRIM

> Revue du 30 septembre 2026, fondée sur le code de cette application mobile.
> Les écarts entre le site et l'API mobile déjà documentés dans
> [`AUDIT-FOUNDATIONS.md`](./AUDIT-FOUNDATIONS.md) restent à traiter par les
> équipes concernées ; ce document cible la continuité d'usage sur téléphone.

## Résultat attendu et périmètre réaliste

Une application de commerce ne peut pas créer une commande, réserver un stock
ou initier un paiement de façon fiable sans réseau. Le bon objectif est donc :

- **sans Internet :** ouvrir l'application, consulter le dernier catalogue
  enregistré, rechercher dedans, consulter une fiche, modifier et conserver le
  panier, appeler AGRIM ;
- **avec Internet :** actualiser prix et stock, s'authentifier, gérer les
  adresses, commander, payer et suivre la livraison.

Les commandes ne sont **pas** mises en file d'attente hors ligne. Les rejouer
plus tard serait dangereux : le stock, le prix, l'adresse et le paiement
peuvent avoir changé. L'idempotence évite un double envoi, elle ne transforme
pas une commande déconnectée en commande sûre.

## Incohérences constatées avant cette correction

| Priorité | Constat | Risque utilisateur | Correction apportée |
| --- | --- | --- | --- |
| Haute | Le catalogue TanStack Query vivait uniquement en mémoire. Après fermeture de l'application, une coupure réseau affichait une erreur à la place du catalogue. | Application inutilisable dès qu'Internet manque. | Cache public du catalogue persisté dans `AsyncStorage`, relu avant les écrans ; réchauffement d'une liste allant jusqu'à 100 produits. |
| Haute | Au démarrage, un échec du refresh de session (dont une coupure réseau) effaçait les jetons et déconnectait l'utilisateur. | Déconnexion abusive alors que le téléphone a seulement perdu le réseau. | Restauration de la dernière session locale et déconnexion uniquement après un refus serveur `401` explicite. |
| Moyenne | Les fiches produits dépendaient d'un appel dédié même si le produit était déjà présent dans la liste. | Une fiche déjà téléchargée devenait inaccessible hors ligne. | La fiche utilise d'abord l'entrée catalogue mémorisée. |
| Moyenne | Une erreur de rafraîchissement masquait des données déjà en cache. | Écran d'erreur alors que le catalogue restait disponible. | Les écrans privilégient les données présentes et conservent l'erreur uniquement si aucune donnée n'existe. |
| Moyenne | Le panier est local, mais le bouton de commande restait actif sans réseau. | Échec incompréhensible au moment de commander. | Action de commande désactivée hors ligne avec un message explicite ; les modifications du panier restent disponibles. |
| Moyenne | Le numéro AGRIM était affiché dans « Mon compte », sans action d'appel. | L'utilisateur devait recopier le numéro, particulièrement difficile pendant une coupure. | Bouton **Appeler le fixe** dans le compte et dans la bannière globale hors connexion (`tel:`). |
| Corrigé | Aucune ligne fixe n'était configurée. | Le bouton ne pouvait pas honnêtement être présenté comme « le fixe ». | Le standard validé `+225 27 20 36 32 83` est centralisé dans `COMPANY.landlinePhone` ; le bouton compose exclusivement ce numéro. Le mobile `+225 07 00 05 04 52` reste affiché dans « Mon compte ». |

## Limites explicites

1. **Premier lancement sans réseau.** Sans une première ouverture en ligne, il
   n'existe aucun catalogue réel à stocker localement. L'écran s'ouvre et le
   bouton d'appel reste disponible, mais aucun produit ne peut être inventé.
2. **Fraîcheur des données.** Le cache catalogue est conservé au plus 30 jours.
   Hors ligne, prix et stock sont des informations de la dernière connexion ;
   la commande est bloquée afin qu'ils soient revalidés par le serveur.
3. **Images distantes.** Les photos déjà gardées par le cache natif peuvent
   apparaître ; en leur absence, l'interface textuelle de la carte produit
   reste affichée. Les données commerciales, elles, sont bien persistées.
4. **Données sensibles.** Seul le catalogue public est mis dans `AsyncStorage`.
   Les jetons et le profil de session restent dans `SecureStore`. Les commandes,
   adresses et notifications ne sont pas copiées dans le cache public.

## Points de cohérence transverses à poursuivre

Les sujets ci-dessous ne doivent pas être masqués par la correction hors
connexion. Ils sont déjà détaillés et justifiés dans
[`AUDIT-FOUNDATIONS.md`](./AUDIT-FOUNDATIONS.md) :

- le site et l'application gardent chacun un compteur de stock : une source
  unique de réservation reste nécessaire pour éviter une double vente entre les
  deux canaux ;
- comptes, rôles et statuts ne sont pas encore unifiés entre le site et le
  mobile ;
- les remises volume/grossiste du site ne sont pas encore appliquées par le
  mobile ;
- les règles de livraison sont désormais lues depuis le site, mais toute
  modification commerciale doit rester centralisée là-bas.

## Vérification terrain recommandée

1. Ouvrir **Catalogue** avec Internet et attendre le chargement des produits.
2. Ajouter un produit au panier, fermer complètement l'application.
3. Couper Wi‑Fi et données mobiles, puis rouvrir l'application.
4. Vérifier catalogue, recherche, fiche produit et panier ; le bandeau
   « Mode hors connexion » doit être visible.
5. Vérifier que « Commander » est désactivé, puis toucher **Appeler le fixe** :
   le composeur du téléphone doit s'ouvrir avec `+225 27 20 36 32 83`.
6. Rétablir Internet : le bandeau disparaît et le catalogue peut se rafraîchir.

## Contact validé

Le standard fixe de production validé est **+225 27 20 36 32 83**. Il est
centralisé dans `packages/contracts/src/company.ts` (`COMPANY.landlinePhone`) ;
le bouton d'assistance ne doit pas recopier ce numéro dans les écrans.

Le mobile de service **+225 07 00 05 04 52** reste également affiché dans la
rubrique « Mon compte ».
