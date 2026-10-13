import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import { IntegrationController } from './integration.controller';

/**
 * Déclenchement immédiat de la synchronisation par le site. Test unitaire :
 * pas de base, pas d'application HTTP — seule la décision d'accepter ou de
 * refuser l'appel est en jeu.
 */
function construire(jeton: string) {
  const sync = { sync: jest.fn().mockResolvedValue({ ok: true }) };
  const config = { get: (cle: string) => (cle === 'SITE_INTEGRATION_TOKEN' ? jeton : undefined) };
  const controleur = new IntegrationController(sync as never, config as never);
  return { controleur, sync };
}

describe('IntegrationController — catalogue-changed', () => {
  it('refuse toute demande tant que le jeton n’est pas configuré (fail-closed)', () => {
    const { controleur, sync } = construire('');
    expect(() => controleur.changed('')).toThrow(ServiceUnavailableException);
    expect(sync.sync).not.toHaveBeenCalled();
  });

  it('refuse un jeton absent ou faux, sans rien synchroniser', () => {
    const { controleur, sync } = construire('jeton-secret-de-test-0123456789');
    expect(() => controleur.changed(undefined)).toThrow(UnauthorizedException);
    expect(() => controleur.changed('mauvais')).toThrow(UnauthorizedException);
    expect(sync.sync).not.toHaveBeenCalled();
  });

  it('accepte le bon jeton et lance la synchronisation', () => {
    const jeton = 'jeton-secret-de-test-0123456789';
    const { controleur, sync } = construire(jeton);
    expect(controleur.changed(jeton)).toEqual({ accepted: true });
    expect(sync.sync).toHaveBeenCalledTimes(1);
  });
});
