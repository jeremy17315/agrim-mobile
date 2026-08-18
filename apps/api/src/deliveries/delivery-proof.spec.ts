/**
 * Preuve de livraison : le livreur retient UNE méthode, ou DEUX combinées
 * (décision produit v1). Aucune livraison ne peut être validée sans preuve.
 *
 * Ces tests verrouillent deux risques :
 *  - une preuve incomplète acceptée (méthode retenue sans son champ) ;
 *  - un fichier résiduel enregistré comme preuve alors que sa méthode
 *    n'a pas été retenue.
 */
import {
  DELIVERY_PROOF_METHODS,
  submitDeliveryProofSchema,
} from '@agrim/contracts';

const DELIVERY_ID = '11111111-1111-4111-8111-111111111111';
const PHOTO_ID = '22222222-2222-4222-8222-222222222222';
const SIGN_ID = '33333333-3333-4333-8333-333333333333';

const base = { deliveryId: DELIVERY_ID, position: null };

describe('submitDeliveryProofSchema', () => {
  it('expose exactement les trois méthodes prévues', () => {
    expect(DELIVERY_PROOF_METHODS).toEqual([
      'CONFIRMATION_CODE',
      'PHOTO',
      'SIGNATURE',
    ]);
  });

  describe('méthode unique', () => {
    it('accepte le code seul', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['CONFIRMATION_CODE'],
        code: '5831',
      });
      expect(r.success).toBe(true);
    });

    it('accepte la photo seule', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['PHOTO'],
        photoFileId: PHOTO_ID,
      });
      expect(r.success).toBe(true);
    });

    it('accepte la signature seule', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['SIGNATURE'],
        signatureFileId: SIGN_ID,
      });
      expect(r.success).toBe(true);
    });
  });

  describe('combinaison de deux méthodes', () => {
    it('accepte code + photo', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['CONFIRMATION_CODE', 'PHOTO'],
        code: '5831',
        photoFileId: PHOTO_ID,
      });
      expect(r.success).toBe(true);
    });

    it('accepte code + signature', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['CONFIRMATION_CODE', 'SIGNATURE'],
        code: '5831',
        signatureFileId: SIGN_ID,
      });
      expect(r.success).toBe(true);
    });

    it('accepte photo + signature', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['PHOTO', 'SIGNATURE'],
        photoFileId: PHOTO_ID,
        signatureFileId: SIGN_ID,
      });
      expect(r.success).toBe(true);
    });

    it('refuse une combinaison incomplète (code + photo sans la photo)', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['CONFIRMATION_CODE', 'PHOTO'],
        code: '5831',
      });
      expect(r.success).toBe(false);
    });
  });

  describe('bornes de sélection', () => {
    it('refuse une liste vide : au moins une preuve est exigée', () => {
      const r = submitDeliveryProofSchema.safeParse({ ...base, methods: [] });
      expect(r.success).toBe(false);
    });

    it('refuse trois méthodes', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['CONFIRMATION_CODE', 'PHOTO', 'SIGNATURE'],
        code: '5831',
        photoFileId: PHOTO_ID,
        signatureFileId: SIGN_ID,
      });
      expect(r.success).toBe(false);
    });

    it('refuse une méthode en double', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['PHOTO', 'PHOTO'],
        photoFileId: PHOTO_ID,
      });
      expect(r.success).toBe(false);
    });
  });

  describe('champs requis manquants', () => {
    it('refuse le code annoncé mais absent', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['CONFIRMATION_CODE'],
      });
      expect(r.success).toBe(false);
    });

    it.each(['583', '58311', 'abcd', ''])(
      'refuse le code invalide "%s"',
      (code) => {
        const r = submitDeliveryProofSchema.safeParse({
          ...base,
          methods: ['CONFIRMATION_CODE'],
          code,
        });
        expect(r.success).toBe(false);
      },
    );

    it('refuse la photo annoncée mais absente', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['PHOTO'],
      });
      expect(r.success).toBe(false);
    });

    it('refuse la signature annoncée mais absente', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['SIGNATURE'],
      });
      expect(r.success).toBe(false);
    });
  });

  describe('champs étrangers à la sélection', () => {
    it('refuse une photo transmise alors que seul le code est retenu', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['CONFIRMATION_CODE'],
        code: '5831',
        photoFileId: PHOTO_ID,
      });
      expect(r.success).toBe(false);
    });

    it('refuse un code transmis alors que seule la signature est retenue', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['SIGNATURE'],
        signatureFileId: SIGN_ID,
        code: '5831',
      });
      expect(r.success).toBe(false);
    });
  });

  describe('métadonnées', () => {
    it('conserve le nom du réceptionnaire quand ce n’est pas le client', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['SIGNATURE'],
        signatureFileId: SIGN_ID,
        receivedBy: 'Awa Koné',
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.receivedBy).toBe('Awa Koné');
    });

    it('accepte une position GPS complète au moment de la validation', () => {
      const r = submitDeliveryProofSchema.safeParse({
        deliveryId: DELIVERY_ID,
        methods: ['CONFIRMATION_CODE'],
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
        methods: ['CONFIRMATION_CODE'],
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
});
