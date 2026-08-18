/**
 * Preuve de livraison v1 (décision produit) :
 *  - SIGNATURE par défaut, PHOTO en repli, combinables ;
 *  - au moins une preuve exigée, deux au maximum ;
 *  - le nom du réceptionnaire est obligatoire avec une signature.
 *
 * Ces tests verrouillent trois risques :
 *  - une preuve incomplète acceptée (méthode retenue sans son fichier) ;
 *  - un fichier résiduel enregistré comme preuve alors que sa méthode
 *    n'a pas été retenue ;
 *  - une signature anonyme, inexploitable en cas de litige.
 */
import {
  DELIVERY_PROOF_DEFAULT_METHOD,
  DELIVERY_PROOF_METHODS,
  submitDeliveryProofSchema,
} from '@agrim/contracts';

const DELIVERY_ID = '11111111-1111-4111-8111-111111111111';
const SIGN_ID = '22222222-2222-4222-8222-222222222222';
const PHOTO_ID = '33333333-3333-4333-8333-333333333333';

const base = { deliveryId: DELIVERY_ID, position: null };

describe('submitDeliveryProofSchema', () => {
  it('expose exactement les deux méthodes retenues', () => {
    expect(DELIVERY_PROOF_METHODS).toEqual(['SIGNATURE', 'PHOTO']);
  });

  it('propose la signature comme méthode par défaut', () => {
    expect(DELIVERY_PROOF_DEFAULT_METHOD).toBe('SIGNATURE');
  });

  describe('méthode unique', () => {
    it('accepte la signature avec le nom du réceptionnaire', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['SIGNATURE'],
        signatureFileId: SIGN_ID,
        receivedBy: 'Awa Koné',
      });
      expect(r.success).toBe(true);
    });

    it('accepte la photo seule, sans nom', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['PHOTO'],
        photoFileId: PHOTO_ID,
      });
      expect(r.success).toBe(true);
    });
  });

  describe('combinaison signature + photo', () => {
    it('accepte les deux preuves ensemble', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['SIGNATURE', 'PHOTO'],
        signatureFileId: SIGN_ID,
        photoFileId: PHOTO_ID,
        receivedBy: 'Awa Koné',
      });
      expect(r.success).toBe(true);
    });

    it('refuse la combinaison si la photo annoncée manque', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['SIGNATURE', 'PHOTO'],
        signatureFileId: SIGN_ID,
        receivedBy: 'Awa Koné',
      });
      expect(r.success).toBe(false);
    });
  });

  describe('bornes de sélection', () => {
    it('refuse une liste vide : au moins une preuve est exigée', () => {
      const r = submitDeliveryProofSchema.safeParse({ ...base, methods: [] });
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

    it('refuse une méthode retirée du contrat', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['CONFIRMATION_CODE'],
      });
      expect(r.success).toBe(false);
    });
  });

  describe('champs requis manquants', () => {
    it('refuse la signature annoncée mais absente', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['SIGNATURE'],
        receivedBy: 'Awa Koné',
      });
      expect(r.success).toBe(false);
    });

    it('refuse la photo annoncée mais absente', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['PHOTO'],
      });
      expect(r.success).toBe(false);
    });
  });

  describe('nom du réceptionnaire', () => {
    it('refuse une signature sans nom', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['SIGNATURE'],
        signatureFileId: SIGN_ID,
      });
      expect(r.success).toBe(false);
    });

    it('refuse un nom composé uniquement d’espaces', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['SIGNATURE'],
        signatureFileId: SIGN_ID,
        receivedBy: '   ',
      });
      expect(r.success).toBe(false);
    });

    it('n’exige pas de nom pour une photo seule', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['PHOTO'],
        photoFileId: PHOTO_ID,
      });
      expect(r.success).toBe(true);
    });
  });

  describe('champs étrangers à la sélection', () => {
    it('refuse une photo transmise alors que seule la signature est retenue', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['SIGNATURE'],
        signatureFileId: SIGN_ID,
        receivedBy: 'Awa Koné',
        photoFileId: PHOTO_ID,
      });
      expect(r.success).toBe(false);
    });

    it('refuse une signature transmise alors que seule la photo est retenue', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['PHOTO'],
        photoFileId: PHOTO_ID,
        signatureFileId: SIGN_ID,
      });
      expect(r.success).toBe(false);
    });
  });

  describe('position GPS', () => {
    it('accepte une position complète au moment de la validation', () => {
      const r = submitDeliveryProofSchema.safeParse({
        deliveryId: DELIVERY_ID,
        methods: ['SIGNATURE'],
        signatureFileId: SIGN_ID,
        receivedBy: 'Awa Koné',
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

    it('accepte une position nulle (GPS indisponible)', () => {
      const r = submitDeliveryProofSchema.safeParse({
        ...base,
        methods: ['PHOTO'],
        photoFileId: PHOTO_ID,
      });
      expect(r.success).toBe(true);
    });

    it('refuse une latitude hors bornes', () => {
      const r = submitDeliveryProofSchema.safeParse({
        deliveryId: DELIVERY_ID,
        methods: ['PHOTO'],
        photoFileId: PHOTO_ID,
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
