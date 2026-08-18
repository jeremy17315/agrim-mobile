/**
 * DESIGN TOKENS AGRIM-Mobile.
 *
 * Source unique de vérité pour l'apparence de l'application. Ces valeurs sont
 * extraites de la maquette validée (AGRIM-Mobile-Maquette-v1.html) et du logo
 * officiel : le vert provient du fond de l'icône Android, l'or des épis et du
 * lettrage « RIZ BOAGNI ».
 *
 * Règle : aucun composant n'écrit une couleur, un espacement ou une taille en
 * dur. Tout passe par ce fichier — c'est ce qui rend un changement de charte
 * possible en un seul endroit.
 */

/* ------------------------------- Couleurs ------------------------------- */

export const palette = {
  /** Vert primaire : barres, boutons, états actifs. */
  green: '#0B5D1E',
  /** Dégradés et en-têtes denses. */
  greenDark: '#074014',
  /** Vert du lettrage « AGRIM ». */
  greenDeep: '#25411F',
  /** Fonds de succès, pastilles. */
  greenSoft: '#E8F0E6',
  /** Accent lisible sur fond clair (ratio suffisant pour du texte). */
  green700: '#0E7A28',

  /** Or du logo : accents premium, promotions. */
  gold: '#D2AC38',
  /** Texte or sur fond clair. */
  goldDark: '#A8842A',
  /** Fonds de mise en avant produit. */
  goldSoft: '#FBF3DE',

  /** Texte principal. */
  ink: '#1A2E14',
  /** Paragraphes. */
  body: '#4A5A44',
  /** Légendes, placeholders. */
  muted: '#8A9585',
  /** Séparateurs, contours. */
  line: '#E4E7E0',

  /** Fond d'application : ivoire chaud (riz / papier). */
  bg: '#FAF8F3',
  /** Surface de carte. */
  card: '#FFFFFF',
  white: '#FFFFFF',

  /** Sémantique — volontairement hors charte pour ne jamais ambiguïser un statut. */
  danger: '#C0392B',
  warn: '#E08A1E',
  info: '#2C6E8F',
} as const;

export type PaletteColor = keyof typeof palette;

/* ------------------------------ Espacements ----------------------------- */

/** Échelle de 4 px : toutes les marges de l'app en dérivent. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/* -------------------------------- Rayons -------------------------------- */

export const radius = {
  sm: 8,
  md: 11,
  lg: 14,
  xl: 18,
  pill: 999,
} as const;

/* ----------------------------- Typographie ------------------------------ */

/**
 * Police système volontairement : rendu natif sur chaque plateforme, aucun
 * octet de police à télécharger. Décisif sur des forfaits data comptés.
 */
export const typography = {
  display: { fontSize: 27, fontWeight: '800', letterSpacing: -0.6 },
  h1: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
  h2: { fontSize: 16, fontWeight: '800' },
  h3: { fontSize: 13.5, fontWeight: '700' },
  body: { fontSize: 13, fontWeight: '400' },
  bodyStrong: { fontSize: 13, fontWeight: '600' },
  caption: { fontSize: 11, fontWeight: '400' },
  micro: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.4 },
} as const;

export type TypographyVariant = keyof typeof typography;

/* -------------------------------- Ombres -------------------------------- */

/**
 * Élévations.
 *
 * `boxShadow` (et non les anciennes props `shadow*`, dépréciées depuis la
 * nouvelle architecture) est interprété sur iOS, Android et web. `elevation`
 * reste fourni pour les versions d'Android qui s'appuient encore dessus.
 */
export const shadow = {
  card: {
    boxShadow: '0px 2px 10px rgba(26, 46, 20, 0.06)',
    elevation: 2,
  },
  floating: {
    boxShadow: '0px 4px 16px rgba(26, 46, 20, 0.14)',
    elevation: 6,
  },
} as const;

/* ------------------------------ Accessibilité --------------------------- */

/**
 * Cible tactile minimale recommandée (44 pt iOS / 48 dp Android).
 * Utilisée par tous les composants pressables, y compris les petits boutons
 * icône dont le visuel est plus petit que la zone de toucher.
 */
export const HIT_SLOP_MIN = 44;

/* -------------------------------- Durées -------------------------------- */

export const duration = {
  fast: 120,
  base: 220,
  slow: 360,
} as const;

export const theme = {
  palette,
  spacing,
  radius,
  typography,
  shadow,
  duration,
  HIT_SLOP_MIN,
} as const;

export type Theme = typeof theme;
