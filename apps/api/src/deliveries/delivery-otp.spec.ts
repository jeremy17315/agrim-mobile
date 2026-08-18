import {
  DELIVERY_OTP_CONFIG,
  formatOtpForDisplay,
  isOtpUsable,
  otpCodeSchema,
  verifyDeliveryOtpSchema,
} from '@agrim/contracts';

/**
 * Règles OTP, testées sans base ni HTTP.
 *
 * Ces assertions portent sur le contrat partagé : c'est lui que le backend
 * applique et que le mobile reflète, donc une divergence commence toujours ici.
 */
describe('Règles OTP de livraison', () => {
  describe('format du code', () => {
    it('accepte exactement 4 chiffres', () => {
      expect(otpCodeSchema.parse('4821')).toBe('4821');
    });

    it('conserve les zéros initiaux', () => {
      // '0007' ne doit jamais devenir 7 : le code est une chaîne, pas un nombre.
      expect(otpCodeSchema.parse('0007')).toBe('0007');
    });

    it('normalise une saisie espacée avant de valider', () => {
      // Un client qui dicte « 48 21 » ne doit pas provoquer un refus.
      expect(otpCodeSchema.parse('48 21')).toBe('4821');
      expect(otpCodeSchema.parse(' 48-21 ')).toBe('4821');
    });

    it('refuse un code trop court, trop long ou non numérique', () => {
      for (const invalid of ['123', '12345', 'abcd', '12a4', '']) {
        expect(() => otpCodeSchema.parse(invalid)).toThrow();
      }
    });
  });

  describe('schéma de vérification', () => {
    it('accepte une validation sans position', () => {
      // Le GPS est une information de traçabilité, pas une condition.
      const parsed = verifyDeliveryOtpSchema.parse({ code: '4821' });
      expect(parsed.code).toBe('4821');
      expect(parsed.position).toBeUndefined();
    });

    it('accepte une position nulle', () => {
      expect(() =>
        verifyDeliveryOtpSchema.parse({ code: '4821', position: null }),
      ).not.toThrow();
    });

    it('refuse une position hors bornes', () => {
      expect(() =>
        verifyDeliveryOtpSchema.parse({
          code: '4821',
          position: { latitude: 200, longitude: 0 },
        }),
      ).toThrow();
    });
  });

  describe('utilisabilité d’un code', () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);

    it('accepte un code frais, non utilisé, sans tentative', () => {
      expect(
        isOtpUsable({ verifiedAt: null, expiresAt: future, attempts: 0 }),
      ).toBe(true);
    });

    it('refuse un code déjà vérifié', () => {
      // Usage unique : la deuxième présentation ne vaut rien.
      expect(
        isOtpUsable({ verifiedAt: new Date(), expiresAt: future, attempts: 0 }),
      ).toBe(false);
    });

    it('refuse un code expiré', () => {
      expect(
        isOtpUsable({ verifiedAt: null, expiresAt: past, attempts: 0 }),
      ).toBe(false);
    });

    it('refuse un code dont les tentatives sont épuisées', () => {
      expect(
        isOtpUsable({
          verifiedAt: null,
          expiresAt: future,
          attempts: DELIVERY_OTP_CONFIG.maxAttempts,
        }),
      ).toBe(false);
    });
  });

  describe('paramètres', () => {
    it('impose un code à 4 chiffres', () => {
      expect(DELIVERY_OTP_CONFIG.length).toBe(4);
    });

    it('plafonne les tentatives bien en deçà des 10 000 combinaisons', () => {
      // Avec 5 essais, la probabilité de deviner est de 0,05 %.
      expect(DELIVERY_OTP_CONFIG.maxAttempts).toBeLessThanOrEqual(5);
    });

    it('borne la durée de vie', () => {
      expect(DELIVERY_OTP_CONFIG.ttlMinutes).toBeGreaterThan(0);
      expect(DELIVERY_OTP_CONFIG.ttlMinutes).toBeLessThanOrEqual(120);
    });
  });

  describe('affichage', () => {
    it('groupe les chiffres par deux', () => {
      expect(formatOtpForDisplay('4821')).toBe('48 21');
    });
  });
});
