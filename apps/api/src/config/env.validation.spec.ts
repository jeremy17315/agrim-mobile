import { validateEnv } from './env.validation';

/**
 * La validation d'environnement est la dernière barrière avant qu'une
 * configuration dangereuse ne parte en production. Elle doit échouer au
 * démarrage, pas silencieusement.
 */
describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgresql://user:pwd@127.0.0.1:5432/db',
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
  };

  it('accepte une configuration de développement minimale', () => {
    const env = validateEnv({ ...base, NODE_ENV: 'development' });
    expect(env.API_PORT).toBe(3000);
    expect(env.PUSH_ENABLED).toBe('false');
  });

  it('refuse deux secrets JWT identiques', () => {
    // Secret commun : un access token vaudrait refresh token, la révocation
    // ne protégerait plus rien.
    expect(() =>
      validateEnv({
        ...base,
        JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET,
      }),
    ).toThrow(/différents/);
  });

  it('refuse un secret absent', () => {
    const incomplete: Record<string, unknown> = { ...base };
    delete incomplete.JWT_ACCESS_SECRET;
    expect(() => validateEnv(incomplete)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuse un secret d’exemple en production', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: `dev_only_${'x'.repeat(40)}`,
      }),
    ).toThrow(/production/);
  });

  it('refuse un secret court en production', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'a'.repeat(20),
      }),
    ).toThrow(/trop courts/);
  });

  it('tolère ces mêmes valeurs hors production', () => {
    // En développement, on ne bloque pas le travail pour un secret court.
    expect(() =>
      validateEnv({ ...base, JWT_ACCESS_SECRET: 'dev_only_secret_1234' }),
    ).not.toThrow();
  });

  it('accepte une configuration de production complète', () => {
    const env = validateEnv({
      ...base,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://admin.agrim.ci',
    });
    expect(env.NODE_ENV).toBe('production');
    expect(env.CORS_ORIGINS).toBe('https://admin.agrim.ci');
  });
});
