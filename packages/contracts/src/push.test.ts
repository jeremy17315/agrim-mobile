/**
 * Destinations des notifications, mises sous test.
 *
 * Ce qu'elles réparent
 * ────────────────────
 * Les colonnes `linkTarget` / `linkValue` existaient en base depuis la mise en
 * place des notifications, mais PERSONNE ne les lisait : une notification de
 * commande renvoyait vers une liste, une campagne ne savait ouvrir aucune
 * fiche. La traduction destination → route vit ici, en un seul endroit, et
 * c'est elle qui est testée : si elle se trompe, le client atterrit ailleurs.
 *
 * Deuxième règle : une destination abîmée (charge utile tronquée par la
 * plateforme, valeur absente) ne doit JAMAIS mener à un écran vide — elle
 * retombe sur la liste des notifications.
 */
import {
  deepLinkFromData,
  deepLinkToData,
  deepLinkToPath,
  NOTIFICATION_FALLBACK_PATH,
  NOTIFICATION_TARGETS,
  NOTIFICATION_TARGET_VALUE_HINTS,
  type NotificationDeepLink,
} from './push';

it('traduit une référence de commande en écran de suivi', () => {
  expect(
    deepLinkToPath({ target: 'commande', value: 'AGR-2026-0042' }),
  ).toBe('/commandes/AGR-2026-0042');
});

it('traduit un produit en fiche, avec échappement des caractères réservés', () => {
  expect(deepLinkToPath({ target: 'produit', value: 'riz royal' })).toBe(
    '/produit/riz%20royal',
  );
});

it('traduit une catégorie en catalogue filtré', () => {
  expect(deepLinkToPath({ target: 'categorie', value: 'cereales' })).toBe(
    '/catalogue?category=cereales',
  );
});

it('ouvre le catalogue pour une offre : aucun écran ne liste les offres à part', () => {
  expect(deepLinkToPath({ target: 'offre', value: '' })).toBe('/catalogue');
});

it('ouvre la commande à traiter pour une notification d’équipe', () => {
  expect(deepLinkToPath({ target: 'gestion', value: 'AGR-2026-0007' })).toBe(
    '/gestion/AGR-2026-0007',
  );
});

it('renvoie vers la liste des notifications pour une information', () => {
  expect(deepLinkToPath({ target: 'information', value: '' })).toBe(
    NOTIFICATION_FALLBACK_PATH,
  );
});

it('n’invente JAMAIS de route quand la valeur manque', () => {
  // Sans référence, `/commandes/` ouvrirait un écran vide : mieux vaut rendre
  // `null` pour que l'appelant retombe sur la liste.
  expect(deepLinkToPath({ target: 'commande', value: '   ' })).toBeNull();
  expect(deepLinkToPath({ target: 'produit', value: '' })).toBeNull();
  expect(deepLinkToPath({ target: 'gestion', value: '' })).toBeNull();
});

it('accepte une catégorie sans valeur (catalogue complet)', () => {
  expect(deepLinkToPath({ target: 'categorie', value: '' })).toBe('/catalogue');
});

it('fait l’aller-retour entre objet et charge utile push', () => {
  const link: NotificationDeepLink = {
    target: 'produit',
    value: 'nouveau-riz',
    extra: 'codePromo=BIENVENUE10',
  };
  expect(deepLinkToData(link)).toEqual({
    target: 'produit',
    value: 'nouveau-riz',
    extra: 'codePromo=BIENVENUE10',
  });
  expect(deepLinkFromData(deepLinkToData(link))).toEqual(link);
});

it('relit une charge utile abîmée sans planter', () => {
  expect(deepLinkFromData(undefined)).toBeNull();
  expect(deepLinkFromData({})).toBeNull();
  expect(deepLinkFromData({ target: 'produit' })).toBeNull();
  expect(deepLinkFromData({ target: 'inconnu', value: 'x' })).toBeNull();
  // Une valeur sans `extra` reste exploitable : le champ est facultatif.
  expect(deepLinkFromData({ target: 'commande', value: 'AGR-1' })).toEqual({
    target: 'commande',
    value: 'AGR-1',
  });
});

it('relit une charge utile ANCIENNE : la référence seule mène à la commande', () => {
  // Notifications envoyées avant le contrat de destination, encore affichées
  // dans le centre de notifications d'un téléphone.
  expect(deepLinkFromData({ reference: 'AGR-2026-0042' })).toEqual({
    target: 'commande',
    value: 'AGR-2026-0042',
  });
  // Une destination inconnue accompagnée d'une référence reste exploitable.
  expect(
    deepLinkFromData({ target: 'inconnu', value: 'x', reference: 'AGR-1' }),
  ).toEqual({ target: 'commande', value: 'AGR-1' });
  // Une référence vide ne mène nulle part.
  expect(deepLinkFromData({ reference: '' })).toBeNull();
});

it('documente chaque destination : libellé et valeur attendue', () => {
  // Une destination ajoutée sans libellé ni description casserait l'écran de
  // rédaction d'une campagne — le test force à compléter les deux tables.
  for (const target of NOTIFICATION_TARGETS) {
    expect(deepLinkToPath({ target, value: 'x' })).not.toBeUndefined();
    expect(NOTIFICATION_TARGET_VALUE_HINTS[target]).toBeTruthy();
  }
});
