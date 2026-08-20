/**
 * Parrainage.
 *
 * Chaque compte dispose d'un code personnel, partageable, qui identifie son
 * parrain lors de l'inscription d'un filleul. La récompense se déclenche à
 * la PREMIÈRE commande réellement LIVRÉE du filleul — jamais à la simple
 * inscription, pour limiter la création de faux comptes.
 *
 * Valeurs PROVISOIRES (section 33) : montant et déclencheur non communiqués
 * officiellement par AGRIM. Modifiables ici sans toucher au reste du code —
 * exactement comme PROVISIONAL_PRICING et PROVISIONAL_DELIVERY dans
 * company.ts.
 */
import { z } from 'zod';

export const REFERRAL_CODE_LENGTH = 6;

export const PROVISIONAL_REFERRAL = {
  /** Crédit accordé au PARRAIN quand son filleul est livré pour la première fois. */
  referrerRewardXof: 1000,
} as const;

/* ------------------------------ Schémas ---------------------------------- */

export const referralCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    new RegExp(`^[A-Z0-9]{${REFERRAL_CODE_LENGTH}}$`),
    'Code de parrainage invalide',
  );

export const referralSummarySchema = z.object({
  code: z.string(),
  creditBalanceXof: z.number().int().min(0),
  referralsCount: z.number().int().min(0),
});
export type ReferralSummary = z.infer<typeof referralSummarySchema>;
