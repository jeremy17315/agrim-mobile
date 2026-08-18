/**
 * Preuve de livraison : le livreur choisit UNE méthode (décision produit v1).
 * Ces tests verrouillent les combinaisons méthode/champ, pour qu'aucune preuve
 * incomplète ne puisse être enregistrée comme valide.
 */
import {
  DELIVERY_PROOF_METHODS,
  submitDeliveryProofSchema,
} from '@agrim/contracts';

const DELIVERY_ID = '11111111-1111-4111-8111-111111111111';
const FILE_ID = '22222222-2222-4222-8222-222222222222';

const base = { deliveryId: DELIVERY_ID, position: null };

describe('submitDeliveryProofSchema', () => {
  it('expose exactement les quatre méthodes prévues', () => {
    expect(DELIVERY_PROOF_METHODS).toEqual([
      'CONFIRMATION_CODE',
      'PHOTO',
      'SIGNATURE',
      'NONE',
    ]);
  });

  describe('CONFIRMATION_CODE', () => {
    it('accepte un code à 4 chiffres', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        method: 'CONFIRMATION_CODE',
        code: '5831',
      });
      expect(r.success).toBe(true);
    });

    it('refuse une preuve sans code', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        method: 'CONFIRMATION_CODE',
      });
      expect(r.success).toBe(false);
    });

    it.each(['583', '58311', 'abcd', ''])(
      'refuse le code invalide "%s"',
      (code) => {
        const r = submitDeliveryProofSchema.safeParse({
          ...base,
          method: 'CONFIRMATION_CODE',
          code,
        });
        expect(r.success).toBe(false);
      },
    );
  });

  describe('PHOTO et SIGNATURE', () => {
    it.each(['PHOTO', 'SIGNATURE'] as const)(
      'accepte %s avec un fichier',
      (method) => {
        const r = submitDeliveryProofSchema.safeParse({
          ...base,
          method,
          fileId: FILE_ID,
        });
        expect(r.success).toBe(true);
      },
    );

    it.each(['PHOTO', 'SIGNATURE'] as const)(
      'refuse %s sans fichier',
      (method) => {
        const r = submitDeliveryProofSchema.safeParse({ ...base, method });
        expect(r.success).toBe(false);
      },
    );

    it('conserve le nom du réceptionnaire quand ce n’est pas le client', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        method: 'SIGNATURE',
        fileId: FILE_ID,
        receivedBy: 'Awa Koné',
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.receivedBy).toBe('Awa Koné');
    });
  });

  describe('NONE', () => {
    it('accepte une validation sans preuve si un motif est fourni', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        method: 'NONE',
        note: 'Client absent, colis remis au gardien',
      });
      expect(r.success).toBe(true);
    });

    it('refuse une validation sans motif', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        method: 'NONE',
      });
      expect(r.success).toBe(false);
    });

    it('refuse un motif composé uniquement d’espaces', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        method: 'NONE',
        note: '   ',
      });
      expect(r.success).toBe(false);
    });
  });

  it('accepte une position GPS complète au moment de la validation', () => {
    const r = submitDeliveryProofSchema.safeParse({
      deliveryId: DELIVERY_ID,
      method: 'CONFIRMATION_CODE',
      code: '5831',
      position: {
        latitude: 6.8189,
        longitude: -5.2767,
        accuracy: 12,
        heading: null,
        speed: null,
        recordedAt: new Date().toISOString(),
      },
    });
    expect(r.success).toBe(true);
  });

  it('refuse une latitude hors bornes', () => {
    const r = submitDeliveryProofSchema.safeParse({
      deliveryId: DELIVERY_ID,
      method: 'CONFIRMATION_CODE',
      code: '5831',
      position: {
        latitude: 120,
        longitude: -5.2767,
        accuracy: null,
        heading: null,
        speed: null,
        recordedAt: new Date().toISOString(),
      },
    });
    expect(r.success).toBe(false);
  });
});
