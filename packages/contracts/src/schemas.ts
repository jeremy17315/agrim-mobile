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
} from './enums';

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
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+225)?\s?[0-9]{10}$/, 'Numéro ivoirien invalide (10 chiffres)');

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
 * Création de commande.
 * `idempotencyKey` est OBLIGATOIRE : une reconnexion après perte réseau ne
 * doit jamais créer de commande en double (contexte connectivité dégradée).
 */
export const createOrderSchema = z.object({
  addressId: idSchema,
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
