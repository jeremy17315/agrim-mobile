import {
  formatDistance,
  formatDuration,
  formatPhone,
  formatRelativeTime,
  formatWeight,
  formatDateTime,
  formatXof,
} from './format';

/** Espace insécable étroit utilisé par les formateurs. */
const NBSP = '\u202F';

describe('formatXof', () => {
  it('groupe les milliers avec un espace insécable', () => {
    expect(formatXof(6000)).toBe(`6${NBSP}000${NBSP}F`);
    expect(formatXof(25000)).toBe(`25${NBSP}000${NBSP}F`);
    expect(formatXof(1200)).toBe(`1${NBSP}200${NBSP}F`);
  });

  it('gère les petits montants sans séparateur', () => {
    expect(formatXof(800)).toBe(`800${NBSP}F`);
    expect(formatXof(0)).toBe(`0${NBSP}F`);
  });

  it('peut omettre le suffixe', () => {
    expect(formatXof(4000, false)).toBe(`4${NBSP}000`);
  });

  it('arrondit à l’entier : le franc CFA n’a pas de décimale', () => {
    expect(formatXof(1200.4)).toBe(`1${NBSP}200${NBSP}F`);
    expect(formatXof(1200.6)).toBe(`1${NBSP}201${NBSP}F`);
  });

  it('reste affichable face à une valeur invalide', () => {
    expect(formatXof(Number.NaN)).toBe(`0${NBSP}F`);
    expect(formatXof(Number.POSITIVE_INFINITY)).toBe(`0${NBSP}F`);
  });

  it('préfixe les montants négatifs', () => {
    expect(formatXof(-1000)).toBe(`-1${NBSP}000${NBSP}F`);
  });
});

describe('formatWeight', () => {
  it('affiche les formats officiels du flyer', () => {
    expect(formatWeight(900)).toBe(`900${NBSP}g`);
    expect(formatWeight(5000)).toBe(`5${NBSP}kg`);
    expect(formatWeight(22500)).toBe(`22,5${NBSP}kg`);
  });

  it('utilise la virgule décimale française', () => {
    expect(formatWeight(1500)).toContain(',');
    expect(formatWeight(1500)).not.toContain('.');
  });

  it('signale une valeur absente sans planter', () => {
    expect(formatWeight(0)).toBe('—');
    expect(formatWeight(-5)).toBe('—');
    expect(formatWeight(Number.NaN)).toBe('—');
  });
});

describe('formatPhone', () => {
  it('met en forme un numéro ivoirien complet', () => {
    expect(formatPhone('+2250700000001')).toBe('+225 07 00 00 00 01');
    expect(formatPhone('0700000001')).toBe('+225 07 00 00 00 01');
  });

  it('laisse intact un numéro non reconnu plutôt que de le déformer', () => {
    expect(formatPhone('12345')).toBe('12345');
  });
});

describe('formatDistance', () => {
  it('bascule des mètres aux kilomètres', () => {
    expect(formatDistance(250)).toBe(`250${NBSP}m`);
    expect(formatDistance(2400)).toBe(`2,4${NBSP}km`);
  });

  it('refuse les valeurs invalides', () => {
    expect(formatDistance(-1)).toBe('—');
    expect(formatDistance(Number.NaN)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('affiche les minutes puis les heures', () => {
    expect(formatDuration(720)).toBe(`12${NBSP}min`);
    expect(formatDuration(3600)).toBe(`1${NBSP}h`);
    expect(formatDuration(4800)).toBe(`1${NBSP}h${NBSP}20`);
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-18T12:00:00.000Z');

  it('décrit la fraîcheur d’une position GPS', () => {
    expect(formatRelativeTime('2026-08-18T11:59:58.000Z', now)).toBe(
      "à l'instant",
    );
    expect(formatRelativeTime('2026-08-18T11:59:48.000Z', now)).toBe(
      `il y a 12${NBSP}s`,
    );
    expect(formatRelativeTime('2026-08-18T11:56:00.000Z', now)).toBe(
      `il y a 4${NBSP}min`,
    );
    expect(formatRelativeTime('2026-08-18T09:00:00.000Z', now)).toBe(
      `il y a 3${NBSP}h`,
    );
  });

  it('ne renvoie jamais de durée négative si l’horloge dérive', () => {
    expect(formatRelativeTime('2026-08-18T12:05:00.000Z', now)).toBe(
      "à l'instant",
    );
  });

  it('gère une date invalide', () => {
    expect(formatRelativeTime('pas-une-date', now)).toBe('—');
  });
});

describe('formatDateTime', () => {
  const now = new Date('2026-08-18T15:00:00');

  it('affiche l’heure pour aujourd’hui', () => {
    expect(formatDateTime('2026-08-18T14:05:00', now)).toBe(
      "aujourd'hui à 14:05",
    );
  });

  it('reconnaît hier', () => {
    expect(formatDateTime('2026-08-17T09:30:00', now)).toBe('hier à 09:30');
  });

  it('affiche jour et mois au-delà', () => {
    expect(formatDateTime('2026-08-02T14:05:00', now)).toBe(
      `2${NBSP}août à 14:05`,
    );
  });

  it('ajoute l’année seulement si elle diffère', () => {
    expect(formatDateTime('2025-12-24T08:00:00', now)).toBe(
      `24${NBSP}déc. 2025 à 08:00`,
    );
  });

  it('ne casse pas sur une date invalide', () => {
    expect(formatDateTime('pas-une-date', now)).toBe('—');
  });
});
