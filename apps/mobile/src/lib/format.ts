/**
 * Formatage des valeurs métier affichées.
 *
 * L'argent est en francs CFA (XOF) : entier, sans décimale. Toute valeur
 * fractionnaire signale un bug de calcul en amont, on ne l'arrondit pas
 * silencieusement à l'affichage.
 */

/** Espace insécable étroit : évite « 6 000 » coupé en fin de ligne. */
const NBSP = '\u202F';

/**
 * Formate un montant XOF : `6000` → `6 000 F`.
 *
 * @param amount montant entier en francs
 * @param withSuffix ajoute le « F » (à masquer quand l'unité est déjà affichée)
 */
export function formatXof(amount: number, withSuffix = true): string {
  if (!Number.isFinite(amount)) return withSuffix ? `0${NBSP}F` : '0';

  const rounded = Math.round(amount);
  const grouped = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const sign = rounded < 0 ? '-' : '';

  return withSuffix ? `${sign}${grouped}${NBSP}F` : `${sign}${grouped}`;
}

/**
 * Formate un poids stocké en grammes : `900` → `900 g`, `5000` → `5 kg`,
 * `22500` → `22,5 kg`. La virgule décimale est la convention française.
 */
export function formatWeight(grams: number): string {
  if (!Number.isFinite(grams) || grams <= 0) return '—';
  if (grams < 1000) return `${Math.round(grams)}${NBSP}g`;

  const kg = grams / 1000;
  const text = Number.isInteger(kg)
    ? String(kg)
    : kg.toFixed(1).replace('.', ',');
  return `${text}${NBSP}kg`;
}

/**
 * Masses agricoles, exprimées en kilogrammes.
 * Au-delà de la tonne on bascule d'unité : « 18 t » se lit mieux que
 * « 18 000 kg » sur une fiche de synthèse.
 */
export function formatKilograms(kg: number): string {
  if (!Number.isFinite(kg) || kg <= 0) return '—';
  if (kg < 1000) return `${Math.round(kg)}${NBSP}kg`;

  const tonnes = kg / 1000;
  const text = Number.isInteger(tonnes)
    ? String(tonnes)
    : tonnes.toFixed(1).replace('.', ',');
  return `${text}${NBSP}t`;
}

/** Surface d'une parcelle, en hectares. */
export function formatHectares(hectares: number | null): string {
  if (hectares === null || !Number.isFinite(hectares) || hectares <= 0)
    return '—';
  const text = Number.isInteger(hectares)
    ? String(hectares)
    : hectares.toFixed(1).replace('.', ',');
  return `${text}${NBSP}ha`;
}

/** Formate un numéro ivoirien : `+2250700000001` → `+225 07 00 00 00 01`. */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const national = digits.startsWith('225') ? digits.slice(3) : digits;
  if (national.length !== 10) return phone;

  const pairs = national.match(/.{1,2}/g) ?? [];
  return `+225 ${pairs.join(' ')}`;
}

/**
 * Durée relative courte, pour la fraîcheur d'une position GPS :
 * « à l'instant », « il y a 12 s », « il y a 4 min ».
 */
export function formatRelativeTime(
  iso: string,
  now: Date = new Date(),
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';

  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 5) return "à l'instant";
  if (seconds < 60) return `il y a ${seconds}${NBSP}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes}${NBSP}min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours}${NBSP}h`;

  const days = Math.floor(hours / 24);
  return `il y a ${days}${NBSP}j`;
}

/** Distance en mètres → « 250 m » ou « 2,4 km ». */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 1000) return `${Math.round(meters)}${NBSP}m`;

  const km = meters / 1000;
  return `${km.toFixed(1).replace('.', ',')}${NBSP}km`;
}

/** Durée en secondes → « 12 min » ou « 1 h 20 ». */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}${NBSP}min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}${NBSP}h` : `${hours}${NBSP}h${NBSP}${rest}`;
}

const MONTHS = [
  'janv.',
  'févr.',
  'mars',
  'avril',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
] as const;

/**
 * Date d'un événement daté : « aujourd'hui à 14:05 », « hier à 09:30 », puis
 * « 18 août à 14:05 ». Au-delà de quelques jours, « il y a 34 j » n'aide plus
 * personne à retrouver une commande — une vraie date, si.
 */
export function formatDateTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const time = `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, now)) return `aujourd'hui à ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `hier à ${time}`;

  const day = date.getDate();
  const month = MONTHS[date.getMonth()];
  // L'année n'est affichée que si elle diffère : elle est bruyante sinon.
  const year =
    date.getFullYear() === now.getFullYear() ? '' : ` ${date.getFullYear()}`;

  return `${day}${NBSP}${month}${year} à ${time}`;
}
