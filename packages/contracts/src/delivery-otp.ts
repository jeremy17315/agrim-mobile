/**
 * Validation de livraison par OTP.
 *
 * Principe : la livraison n'est close que si le CLIENT communique un code à
 * quatre chiffres que le livreur saisit et que le BACKEND vérifie. Le livreur
 * ne voit jamais le code et ne peut jamais clôturer une course lui-même.
 *
 * Ce fichier est la seule source de vérité des règles OTP (longueur, durée de
 * vie, tentatives, renvoi). Le backend les applique, le mobile les reflète ;
 * aucune des deux ne les redéfinit.
 */
import { z } from 'zod';

/* ----------------------------- Paramètres -------------------------------- */

export const DELIVERY_OTP_CONFIG = {
  /** Longueur imposée : exactement 4 chiffres. */
  length: 4,

  /**
   * Durée de vie. Le code est émis au départ du livreur ; une course urbaine
   * à Yamoussoukro tient largement dans ce délai, et un code périmé se
   * régénère sans friction.
   */
  ttlMinutes: 60,

  /**
   * Tentatives autorisées avant blocage du code.
   *
   * 4 chiffres = 10 000 combinaisons. Sans plafond, une saisie automatisée
   * les épuiserait ; avec 5 essais, la probabilité de tomber juste est de
   * 0,05 %. Au-delà, il faut régénérer un code — ce qui laisse une trace.
   */
  maxAttempts: 5,

  /**
   * Délai minimal entre deux générations, pour éviter qu'un renvoi en boucle
   * ne serve de canal de harcèlement du client.
   */
  resendCooldownSeconds: 60,

  /** Renvois maximum pour une même livraison. */
  maxResends: 5,
} as const;

/* ------------------------------ Schémas ---------------------------------- */

/**
 * Code saisi par le livreur.
 *
 * Normalisation avant validation : espaces et séparateurs retirés, comme pour
 * le numéro de téléphone. Un client qui dicte « 12 34 » ne doit pas provoquer
 * un refus dû à la mise en forme.
 */
export const otpCodeSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s.-]/g, ''))
  .refine(
    (v) => new RegExp(`^[0-9]{${DELIVERY_OTP_CONFIG.length}}$`).test(v),
    `Code à ${DELIVERY_OTP_CONFIG.length} chiffres requis`,
  );

/** Position facultative, jointe à titre de traçabilité uniquement. */
const otpPositionSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .nullable()
  .optional();

/**
 * Vérification d'un OTP par le livreur.
 *
 * La position est facultative : le GPS est une information de traçabilité, en
 * aucun cas une condition de validation. Un immeuble qui bloque le signal ne
 * doit pas empêcher une livraison réelle d'être validée.
 */
export const verifyDeliveryOtpSchema = z.object({
  code: otpCodeSchema,
  position: otpPositionSchema,
});
export type VerifyDeliveryOtp = z.infer<typeof verifyDeliveryOtpSchema>;

/**
 * État de l'OTP tel qu'exposé au livreur et au client.
 *
 * `code` n'y figure pas, délibérément : cet objet transite vers l'application
 * du livreur, qui ne doit jamais connaître le code avant sa saisie.
 */
export const deliveryOtpStatusSchema = z.object({
  /** Un code actif existe-t-il ? */
  isActive: z.boolean(),
  expiresAt: z.iso.datetime().nullable(),
  attemptsRemaining: z.number().int().min(0),
  /** Vérifié : la livraison est close. */
  verifiedAt: z.iso.datetime().nullable(),
  /** Nouvelle génération possible à partir de cet instant. */
  canResendAt: z.iso.datetime().nullable(),
  resendsRemaining: z.number().int().min(0),
});
export type DeliveryOtpStatus = z.infer<typeof deliveryOtpStatusSchema>;

/* ------------------------------ Aides ------------------------------------ */

/** Mise en forme pour l'affichage côté client : « 1234 » → « 12 34 ». */
export function formatOtpForDisplay(code: string): string {
  return code.replace(/(\d{2})(?=\d)/g, '$1 ');
}

/**
 * Un OTP est-il encore utilisable ?
 *
 * Les quatre conditions sont réunies ici pour qu'aucun appelant n'en oublie
 * une. Le backend reste seul juge : cette fonction sert aussi à l'affichage.
 */
export function isOtpUsable(otp: {
  verifiedAt: Date | string | null;
  expiresAt: Date | string;
  attempts: number;
}): boolean {
  if (otp.verifiedAt) return false;
  if (otp.attempts >= DELIVERY_OTP_CONFIG.maxAttempts) return false;
  return new Date(otp.expiresAt).getTime() > Date.now();
}
