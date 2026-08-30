/**
 * Schémas Zod = CONTRAT DE DONNÉES AGRIM-Mobile.
 *
 * Règle d'or : ces schémas sont définis AVANT les écrans.
 * Le backend les respecte, le mobile les valide. Toute divergence est un
 * bug d'API, pas un bug d'UI.
 */
import { z } from 'zod';

import {
  DELIVERY_STATUSES,
  MOBILE_MONEY_PROVIDERS,
  NOTIFICATION_TYPES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  ROLES,
  STOCK_MOVEMENT_TYPES,
} from './enums';
import {
  FARM_LIMITS,
  PRODUCTION_LIMITS,
  PRODUCTION_STATUSES,
} from './production';

/* ────────────────────────────── Primitives ────────────────────────────── */

export const idSchema = z.uuid();

/** Montant en XOF : entier positif, sans décimales. */
export const moneySchema = z
  .number()
  .int('Le montant doit être un entier (XOF sans décimales)')
  .nonnegative();

/**
 * Téléphone ivoirien : 10 chiffres, avec indicatif +225 optionnel.
 * Le numéro est l'identifiant naturel de l'utilisateur en Côte d'Ivoire.
 */
/**
 * Téléphone ivoirien.
 *
 * Les espaces sont retirés AVANT validation : les utilisateurs saisissent
 * spontanément « 07 00 00 00 01 », et refuser cette forme serait une faute
 * d'ergonomie. La valeur validée est toujours compacte, donc directement
 * comparable en base.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s.-]/g, ''))
  .refine(
    (value) => /^(\+225)?[0-9]{10}$/.test(value),
    'Numéro ivoirien invalide (10 chiffres)',
  );

export const passwordSchema = z
  .string()
  .min(8, 'Au moins 8 caractères')
  .regex(/[A-Za-z]/, 'Doit contenir une lettre')
  .regex(/[0-9]/, 'Doit contenir un chiffre');

/* ──────────────────────────── Utilisateur ─────────────────────────────── */

export const userSchema = z.object({
  id: idSchema,
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  phone: phoneSchema,
  email: z.email().nullable(),
  role: z.enum(ROLES),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type User = z.infer<typeof userSchema>;

/* ──────────────────────────────── Adresse ──────────────────────────────── */

/**
 * En Côte d'Ivoire l'adressage formel est faible : une adresse textuelle ne
 * suffit pas. On modélise commune + quartier + POINTS DE REPÈRE + GPS.
 */
export const addressSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(60),
  city: z.string().min(1).max(80),
  commune: z.string().max(80).nullable(),
  district: z.string().max(120).nullable(),
  landmark: z.string().max(255).nullable(),
  instructions: z.string().max(500).nullable(),
  contactPhone: phoneSchema,
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  isDefault: z.boolean(),
});
export type Address = z.infer<typeof addressSchema>;

/**
 * Saisie d'une adresse. `landmark` (point de repère) compte autant que la
 * commune : c'est souvent lui qui permet réellement au livreur de trouver.
 */
export const createAddressSchema = z.object({
  label: z.string().min(1).max(60),
  city: z.string().min(1).max(80),
  commune: z.string().max(80).optional(),
  district: z.string().max(120).optional(),
  landmark: z.string().max(255).optional(),
  instructions: z.string().max(500).optional(),
  contactPhone: phoneSchema,
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  isDefault: z.boolean().optional(),
});
export type CreateAddressInput = z.infer<typeof createAddressSchema>;

/* ───────────────────────── Catalogue / Produits ────────────────────────── */

export const categorySchema = z.object({
  id: idSchema,
  slug: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable(),
  imageUrl: z.url().nullable(),
  sortOrder: z.number().int(),
});
export type Category = z.infer<typeof categorySchema>;

/** Variante = format commercial (900 g, 5 kg, 22,5 kg…). */
export const productVariantSchema = z.object({
  id: idSchema,
  sku: z.string().min(1).max(60),
  /** Poids en GRAMMES (entier) : évite les flottants sur 22,5 kg. */
  weightGrams: z.number().int().positive(),
  label: z.string().min(1).max(40),
  price: moneySchema,
  /** Prix barré (« avant promotion »). `null` = aucune promotion en cours. */
  originalPrice: moneySchema.nullable(),
  stock: z.number().int().nonnegative(),
  isAvailable: z.boolean(),
});
export type ProductVariant = z.infer<typeof productVariantSchema>;

export const productSchema = z.object({
  id: idSchema,
  slug: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  shortDescription: z.string().max(200).nullable(),
  description: z.string().max(2000).nullable(),
  brand: z.string().max(80),
  imageUrl: z.url().nullable(),
  category: categorySchema.pick({ id: true, slug: true, name: true }),
  variants: z.array(productVariantSchema).min(1),
  isFeatured: z.boolean(),
  isActive: z.boolean(),
});
export type Product = z.infer<typeof productSchema>;

/* ──────────────────────────── Avis produits ────────────────────────────── */

/** Un avis publié : prénom seul, jamais le téléphone. */
export const productReviewSchema = z.object({
  id: idSchema,
  authorFirstName: z.string().min(1).max(80),
  rating: z.number().int().min(1).max(5),
  comment: z.string().min(1).max(800),
  createdAt: z.iso.datetime(),
});
export type ProductReview = z.infer<typeof productReviewSchema>;

export const productReviewsResponseSchema = z.object({
  average: z.number().nullable(),
  count: z.number().int().nonnegative(),
  data: z.array(productReviewSchema),
});
export type ProductReviewsResponse = z.infer<
  typeof productReviewsResponseSchema
>;

export const createProductReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z
    .string()
    .trim()
    .min(8, 'Écrivez au moins quelques mots (8 caractères).')
    .max(800),
});
export type CreateProductReviewInput = z.infer<typeof createProductReviewSchema>;

/* ──────────────────────────────── Panier ───────────────────────────────── */

export const cartItemSchema = z.object({
  id: idSchema,
  productId: idSchema,
  variantId: idSchema,
  productName: z.string(),
  variantLabel: z.string(),
  imageUrl: z.url().nullable(),
  unitPrice: moneySchema,
  quantity: z.number().int().positive().max(999),
  lineTotal: moneySchema,
});
export type CartItem = z.infer<typeof cartItemSchema>;

export const cartSchema = z.object({
  id: idSchema,
  items: z.array(cartItemSchema),
  subtotal: moneySchema,
  deliveryFee: moneySchema,
  total: moneySchema,
  updatedAt: z.iso.datetime(),
});
export type Cart = z.infer<typeof cartSchema>;

export const addCartItemSchema = z.object({
  variantId: idSchema,
  quantity: z.number().int().positive().max(999),
});
export type AddCartItemInput = z.infer<typeof addCartItemSchema>;

/* ──────────────────────────────── Commande ─────────────────────────────── */

export const orderItemSchema = z.object({
  id: idSchema,
  productName: z.string(),
  variantLabel: z.string(),
  unitPrice: moneySchema,
  quantity: z.number().int().positive(),
  lineTotal: moneySchema,
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const orderSchema = z.object({
  id: idSchema,
  /** Référence lisible, ex. AGR-2026-0001 */
  reference: z.string().regex(/^AGR-\d{4}-\d{4,}$/),
  status: z.enum(ORDER_STATUSES),
  items: z.array(orderItemSchema).min(1),
  subtotal: moneySchema,
  deliveryFee: moneySchema,
  total: moneySchema,
  address: addressSchema.omit({ isDefault: true }),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  createdAt: z.iso.datetime(),
});
export type Order = z.infer<typeof orderSchema>;

/**
 * Ligne envoyée à la création d'une commande.
 *
 * On transmet UNIQUEMENT la variante et la quantité : aucun prix. Le panier
 * vit sur l'appareil, mais un prix venant du client n'est jamais digne de
 * confiance — le serveur relit ses propres tarifs et recalcule tout.
 */
export const createOrderItemSchema = z.object({
  variantId: idSchema,
  quantity: z.number().int().min(1).max(999),
});
export type CreateOrderItemInput = z.infer<typeof createOrderItemSchema>;

/**
 * Création de commande.
 * `idempotencyKey` est OBLIGATOIRE : une reconnexion après perte réseau ne
 * doit jamais créer de commande en double (contexte connectivité dégradée).
 */
export const createOrderSchema = z.object({
  addressId: idSchema,
  /** Le panier est local : ses lignes sont envoyées ici au moment de valider. */
  items: z.array(createOrderItemSchema).min(1).max(50),
  paymentMethod: z.enum(PAYMENT_METHODS),
  mobileMoneyProvider: z.enum(MOBILE_MONEY_PROVIDERS).optional(),
  idempotencyKey: z.uuid(),
  note: z.string().max(500).optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/* ──────────────────────────────── Paiement ─────────────────────────────── */

/**
 * Réponse d'initiation. Le paiement N'EST PAS résolu ici :
 * le client confirme hors de l'app, puis un webhook tranche.
 */
export const paymentIntentSchema = z.object({
  paymentId: idSchema,
  orderId: idSchema,
  status: z.enum(PAYMENT_STATUSES),
  method: z.enum(PAYMENT_METHODS),
  amount: moneySchema,
  /** Redirection éventuelle (carte / certains agrégateurs). */
  redirectUrl: z.url().nullable(),
  /** Instruction affichée au client, ex. « Composez #144# pour valider ». */
  instructions: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
});
export type PaymentIntent = z.infer<typeof paymentIntentSchema>;

/* ──────────────────────────────── Livraison ────────────────────────────── */

export const deliverySchema = z.object({
  id: idSchema,
  orderId: idSchema,
  orderReference: z.string(),
  status: z.enum(DELIVERY_STATUSES),
  courierId: idSchema.nullable(),
  address: addressSchema.omit({ isDefault: true }),
  assignedAt: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
});
export type Delivery = z.infer<typeof deliverySchema>;

/* ─────────────────────────────── Notification ──────────────────────────── */

export const notificationSchema = z.object({
  id: idSchema,
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string().max(120),
  body: z.string().max(500),
  isRead: z.boolean(),
  orderId: idSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type Notification = z.infer<typeof notificationSchema>;

/* ──────────────────────────── Authentification ─────────────────────────── */

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'Mot de passe requis'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    firstName: z.string().min(1, 'Prénom requis').max(80),
    lastName: z.string().min(1, 'Nom requis').max(80),
    phone: phoneSchema,
    email: z.email('Email invalide').optional().or(z.literal('')),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['confirmPassword'],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: userSchema,
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

/* ──────────────────────────────── Dashboard ────────────────────────────── */

export const dashboardSchema = z.object({
  revenue: moneySchema,
  ordersCount: z.number().int().nonnegative(),
  clientsCount: z.number().int().nonnegative(),
  deliveriesInProgress: z.number().int().nonnegative(),
  lowStockCount: z.number().int().nonnegative(),
  salesByDay: z.array(z.object({ date: z.string(), amount: moneySchema })),
  topProducts: z.array(
    z.object({ name: z.string(), quantity: z.number().int().nonnegative() }),
  ),
});
export type DashboardMetrics = z.infer<typeof dashboardSchema>;

/* ────────────────────────── Espace gestionnaire ────────────────────────── */

/** Ligne de la file de préparation : de quoi décider sans ouvrir la commande. */
export const managedOrderSchema = z.object({
  id: idSchema,
  reference: z.string(),
  status: z.enum(ORDER_STATUSES),
  total: z.number().int(),
  itemCount: z.number().int(),
  createdAt: z.iso.datetime(),
  customerName: z.string(),
  customerPhone: z.string(),
  city: z.string().nullable(),
  /**
   * Présence d'une course déjà affectée : évite une double assignation.
   *
   * Faux après un échec de livraison, bien que la course garde le `courierId`
   * de celui qui a tenté : la commande attend une NOUVELLE affectation.
   */
  hasCourier: z.boolean(),
  /**
   * La commande revient d'une tentative infructueuse et attend une décision.
   *
   * Sans ce drapeau, une commande revenue en `READY` serait indiscernable à
   * l'écran d'une commande jamais partie — et le gestionnaire relancerait une
   * course sans savoir qu'il s'agit d'un second passage.
   */
  awaitingRetry: z.boolean(),
  /** Motif du dernier échec, quand il y en a un. */
  deliveryFailureReason: z.string().nullable(),
});
export type ManagedOrder = z.infer<typeof managedOrderSchema>;

/** Indicateurs du jour, calculés par le serveur. */
const compteur = z.number().int().nonnegative();

export const managerDashboardSchema = z.object({
  revenueToday: compteur,
  ordersToday: compteur,
  toPrepare: compteur,
  activeDeliveries: compteur,
  lowStockCount: compteur,
  /** Commandes en attente depuis trop longtemps. */
  stalePendingCount: compteur,

  // ── Détail ajouté par l'administration centrale (août 2026) ──────────────
  //
  // Facultatifs, et ils le resteront : l'application et l'API ne se déploient
  // pas à la même seconde, et un champ manquant ne doit pas faire échouer la
  // validation de TOUT le tableau de bord. Un écran qui affiche six chiffres
  // sur treize reste utile ; un écran vide, non.

  /** Répartition des commandes par statut, tous âges confondus. */
  orders: z
    .object({
      pending: compteur,
      confirmed: compteur,
      preparing: compteur,
      ready: compteur,
      outForDelivery: compteur,
      delivered: compteur,
      cancelled: compteur,
    })
    .optional(),

  catalog: z
    .object({
      productCount: compteur,
      variantCount: compteur,
      /** Stock à zéro : la vente est perdue maintenant. */
      outOfStockCount: compteur,
      /** Sous le seuil sans être à zéro : elle le sera demain. */
      lowStockCount: compteur,
    })
    .optional(),

  customers: z.object({ total: compteur }).optional(),

  /** « Disponible » se déduit de l'absence de course en cours. */
  couriers: z
    .object({ total: compteur, busy: compteur, available: compteur })
    .optional(),
});
export type ManagerDashboard = z.infer<typeof managerDashboardSchema>;

/**
 * Une ligne du journal des mouvements de stock.
 *
 * `stockBefore` / `stockAfter` sont conservés bien qu'ils soient
 * recalculables : ils figent ce que le système croyait au moment du geste, et
 * un enchaînement rompu entre deux lignes signale une écriture qui a échappé
 * au journal.
 */
export const stockMovementSchema = z.object({
  id: idSchema,
  type: z.enum(STOCK_MOVEMENT_TYPES),
  /** Variation signée : `+50` à la réception, `−2` à la commande. */
  quantity: z.number().int(),
  stockBefore: z.number().int(),
  stockAfter: z.number().int(),
  reason: z.string().nullable(),
  /** Référence de la commande à l'origine du mouvement, s'il y en a une. */
  reference: z.string().nullable(),
  createdAt: z.coerce.date(),
  /** `null` = mouvement du système. L'absence d'auteur est une information. */
  actor: z.object({ name: z.string(), role: z.enum(ROLES) }).nullable(),
});
export type StockMovement = z.infer<typeof stockMovementSchema>;

export const stockMovementPageSchema = z.object({
  variant: z.object({
    variantId: idSchema,
    sku: z.string(),
    productName: z.string(),
    label: z.string(),
    stock: z.number().int(),
  }),
  data: z.array(stockMovementSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
});
export type StockMovementPage = z.infer<typeof stockMovementPageSchema>;

export const stockItemSchema = z.object({
  variantId: idSchema,
  sku: z.string(),
  productName: z.string(),
  label: z.string(),
  weightGrams: z.number().int(),
  stock: z.number().int(),
  lowStockThreshold: z.number().int(),
  isAvailable: z.boolean(),
});
export type StockItem = z.infer<typeof stockItemSchema>;

/* ───────────────────────── Direction générale ──────────────────────────── */

/** Un point de l'historique des ventes : un mois calendaire. */
export const salesPointSchema = z.object({
  /** Format `YYYY-MM`, non ambigu et triable. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  label: z.string(),
  revenue: z.number().int().nonnegative(),
  orders: z.number().int().nonnegative(),
});
export type SalesPoint = z.infer<typeof salesPointSchema>;

/** Part d'une gamme dans le chiffre d'affaires de la période. */
export const categoryShareSchema = z.object({
  categoryId: idSchema,
  name: z.string(),
  revenue: z.number().int().nonnegative(),
  share: z.number().int().min(0).max(100),
});
export type CategoryShare = z.infer<typeof categoryShareSchema>;

/**
 * Vue d'ensemble de la direction. Lecture seule, agrégée côté serveur : le
 * mobile ne recalcule aucun montant.
 */
export const executiveDashboardSchema = z.object({
  /** Mois en cours, format `YYYY-MM`. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  monthLabel: z.string(),

  revenueMonth: z.number().int().nonnegative(),
  /** Variation vs mois précédent. `null` si le mois de référence est vide. */
  revenueGrowth: z.number().nullable(),

  ordersMonth: z.number().int().nonnegative(),
  ordersGrowth: z.number().nullable(),

  /** Comptes clients créés dans le mois. */
  newCustomers: z.number().int().nonnegative(),
  averageBasket: z.number().int().nonnegative(),

  /** Courses en cours au-delà du délai de référence. */
  lateDeliveries: z.number().int().nonnegative(),

  /**
   * Livraisons closes par un gestionnaire, sans code du client.
   *
   * Suivi à part des livraisons confirmées : c'est la mesure de ce que la
   * validation par code laisse passer. Un taux qui monte signale un défaut du
   * parcours, pas un manquement des gestionnaires.
   */
  manualClosures: z.number().int().nonnegative(),
  /** Part des clôtures d'exception dans les livraisons du mois, en pourcent. */
  manualClosureRate: z.number().int().min(0).max(100),
  lowStockCount: z.number().int().nonnegative(),

  /** Récoltes réceptionnées dans le mois, en kilogrammes. */
  productionReceivedKg: z.number().int().nonnegative(),
  pendingProductionReviews: z.number().int().nonnegative(),

  sales: z.array(salesPointSchema),
  categories: z.array(categoryShareSchema),
});
export type ExecutiveDashboard = z.infer<typeof executiveDashboardSchema>;

export const courierSummarySchema = z.object({
  id: idSchema,
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string(),
  /** Courses non terminées, pour répartir la charge. */
  activeDeliveries: z.number().int().nonnegative(),
});
export type CourierSummary = z.infer<typeof courierSummarySchema>;

/* ─────────────────────────── Espace producteur ─────────────────────────── */

export const farmSchema = z.object({
  id: idSchema,
  name: z.string().max(FARM_LIMITS.maxNameLength),
  location: z.string().max(FARM_LIMITS.maxLocationLength).nullable(),
  areaHectares: z
    .number()
    .positive()
    .max(FARM_LIMITS.maxAreaHectares)
    .nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  isActive: z.boolean(),
  productionCount: z.number().int().nonnegative().optional(),
});
export type Farm = z.infer<typeof farmSchema>;

export const createFarmSchema = z.object({
  name: z.string().trim().min(2).max(FARM_LIMITS.maxNameLength),
  location: z
    .string()
    .trim()
    .max(FARM_LIMITS.maxLocationLength)
    .optional()
    .nullable(),
  areaHectares: z
    .number()
    .positive()
    .max(FARM_LIMITS.maxAreaHectares)
    .optional()
    .nullable(),
  // Coordonnées facultatives : toutes les parcelles ne sont pas relevées au GPS.
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});
export type CreateFarmInput = z.infer<typeof createFarmSchema>;

export const updateFarmSchema = createFarmSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateFarmInput = z.infer<typeof updateFarmSchema>;

export const productionSchema = z.object({
  id: idSchema,
  farmId: idSchema,
  farmName: z.string().optional(),
  season: z.string().max(PRODUCTION_LIMITS.maxSeasonLength),
  cropVariety: z.string().max(PRODUCTION_LIMITS.maxCropVarietyLength),
  quantityKg: z.number().int(),
  targetKg: z.number().int().nullable(),
  harvestedAt: z.iso.datetime().nullable(),
  status: z.enum(PRODUCTION_STATUSES),
  reviewNote: z.string().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Production = z.infer<typeof productionSchema>;

export const createProductionSchema = z.object({
  farmId: idSchema,
  season: z.string().trim().min(2).max(PRODUCTION_LIMITS.maxSeasonLength),
  cropVariety: z
    .string()
    .trim()
    .min(2)
    .max(PRODUCTION_LIMITS.maxCropVarietyLength),
  quantityKg: z
    .number()
    .int()
    .min(PRODUCTION_LIMITS.minQuantityKg)
    .max(PRODUCTION_LIMITS.maxQuantityKg),
  targetKg: z
    .number()
    .int()
    .positive()
    .max(PRODUCTION_LIMITS.maxQuantityKg)
    .optional()
    .nullable(),
  harvestedAt: z.iso.datetime().optional().nullable(),
});
export type CreateProductionInput = z.infer<typeof createProductionSchema>;

/**
 * Déclaration vue par la coopérative.
 *
 * Le gestionnaire arbitre entre plusieurs producteurs : le nom de l'exploitant
 * et son téléphone sont indispensables pour trancher ou appeler, alors qu'ils
 * sont superflus pour le producteur qui consulte ses propres déclarations.
 */
export const reviewableProductionSchema = productionSchema.extend({
  producerId: idSchema,
  producerName: z.string(),
  producerPhone: z.string(),
  farmName: z.string(),
});
export type ReviewableProduction = z.infer<typeof reviewableProductionSchema>;

export const reviewProductionSchema = z
  .object({
    status: z.enum(PRODUCTION_STATUSES),
    reviewNote: z.string().trim().max(300).optional(),
  })
  .refine(
    (value) =>
      value.status !== 'REJECTED' || (value.reviewNote?.length ?? 0) > 0,
    {
      // Un rejet sans motif laisse le producteur sans recours.
      message: 'Indiquez le motif du rejet.',
      path: ['reviewNote'],
    },
  );
export type ReviewProductionInput = z.infer<typeof reviewProductionSchema>;

/** Synthèse affichée en tête de l'espace producteur. */
export const producerOverviewSchema = z.object({
  id: idSchema,
  displayName: z.string(),
  region: z.string().nullable(),
  farmCount: z.number().int().nonnegative(),
  totalAreaHectares: z.number().nonnegative(),
  /** Cumul des récoltes réellement réceptionnées, en kilogrammes. */
  receivedKg: z.number().int().nonnegative(),
  /** Déclarations en attente de vérification. */
  pendingCount: z.number().int().nonnegative(),
});
export type ProducerOverview = z.infer<typeof producerOverviewSchema>;

/* ─────────────────────────── Enveloppes génériques ─────────────────────── */

export const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  total: z.number().int().nonnegative(),
});

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), pagination: paginationSchema });
}

/** Format d'erreur unique de l'API (jamais d'erreur technique brute en UI). */
export const apiErrorSchema = z.object({
  statusCode: z.number().int(),
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
