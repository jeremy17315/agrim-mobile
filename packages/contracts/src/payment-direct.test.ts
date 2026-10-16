import {
  buildUssdCode,
  isOpenablePaymentLink,
  paymentLinkToOpen,
  ussdDialUrl,
} from './payment-direct';

/**
 * « Payer depuis ce téléphone » — la question qui a motivé ce contrat.
 *
 * Un QR affiché sur l'écran ne peut pas être scanné par le téléphone qui
 * l'affiche : le client qui n'a qu'un seul appareil doit pouvoir OUVRIR un
 * lien, ou composer un code. Ces tests verrouillent deux règles :
 *
 *  1. on n'ouvre QUE ce qui a été publié, et jamais un schéma dangereux ;
 *  2. un QR au format brut (EMVCo) ne devient jamais un lien par
 *     approximation — dans ce cas, la réponse est `null`, pas une invention.
 */
describe('lien de paiement à ouvrir', () => {
  it('accepte un lien publié pour ça', () => {
    expect(
      paymentLinkToOpen({
        paymentUrl: 'https://pay.wave.com/m/M_agrim/c/ci/',
        qrPayload: null,
      }),
    ).toBe('https://pay.wave.com/m/M_agrim/c/ci/');
  });

  it('retombe sur le contenu du QR quand c’est LUI le lien (cas Wave)', () => {
    // Le QR marchand de Wave contient l’URL de paiement : inutile de demander
    // à AGRIM de saisir deux fois la même information.
    expect(
      paymentLinkToOpen({
        paymentUrl: null,
        qrPayload: 'https://pay.wave.com/m/M_agrim/c/ci/',
      }),
    ).toBe('https://pay.wave.com/m/M_agrim/c/ci/');
  });

  it('le lien publié explicitement gagne sur le contenu du QR', () => {
    expect(
      paymentLinkToOpen({
        paymentUrl: 'https://paiement.agrim.ci/wave',
        qrPayload: 'https://pay.wave.com/m/M_agrim/c/ci/',
      }),
    ).toBe('https://paiement.agrim.ci/wave');
  });

  it('un QR au format EMVCo ne donne aucun lien', () => {
    // Ce que seul le scanner de l'opérateur sait lire : ouvrir ça comme une
    // URL n'aurait aucun sens.
    expect(
      paymentLinkToOpen({
        paymentUrl: null,
        qrPayload: '00020101021126360013ci.orange.merchant5204000053039865802CI',
      }),
    ).toBeNull();
  });

  it('refuse les schémas dangereux', () => {
    for (const dangereux of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html;base64,PHNjcmlwdD4=',
      'intent://scan/#Intent;scheme=zxing;end',
    ]) {
      expect(isOpenablePaymentLink(dangereux)).toBe(false);
      expect(
        paymentLinkToOpen({ paymentUrl: dangereux, qrPayload: null }),
      ).toBeNull();
      expect(
        paymentLinkToOpen({ paymentUrl: null, qrPayload: dangereux }),
      ).toBeNull();
    }
  });

  it('accepte un envoi dans le composeur de l’opérateur', () => {
    expect(isOpenablePaymentLink('tel:+2250700050452')).toBe(true);
  });

  it('ne rend rien quand rien n’est publié', () => {
    expect(
      paymentLinkToOpen({ paymentUrl: null, qrPayload: null }),
    ).toBeNull();
    expect(paymentLinkToOpen({ paymentUrl: '   ', qrPayload: '  ' })).toBeNull();
  });
});

describe('code USSD à composer', () => {
  it('remplace le numéro et le montant, sans séparateur', () => {
    expect(
      buildUssdCode('#144*1*1*{number}*{amount}#', {
        number: '0700050452',
        amount: 18_500,
      }),
    ).toBe('#144*1*1*0700050452*18500#');
  });

  it('accepte un code fixe, sans jeton', () => {
    expect(buildUssdCode('#144#', { number: '0700050452', amount: 5000 })).toBe(
      '#144#',
    );
  });

  it('ne fabrique aucun code quand AGRIM n’en a pas publié', () => {
    expect(buildUssdCode(null, { number: '0700050452', amount: 5000 })).toBeNull();
    expect(buildUssdCode('   ', { number: '0700050452', amount: 5000 })).toBeNull();
  });

  it('arrondit un montant non entier plutôt que d’écrire une virgule', () => {
    expect(buildUssdCode('#1*{amount}#', { number: '07', amount: 1000.7 })).toBe(
      '#1*1000#',
    );
  });

  it('encode le dièse, sinon le code est tronqué à la composition', () => {
    expect(ussdDialUrl('#144*1*1*0700050452*18500#')).toBe(
      'tel:%23144*1*1*0700050452*18500%23',
    );
  });
});
