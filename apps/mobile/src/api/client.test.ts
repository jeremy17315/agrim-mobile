import { z } from 'zod';

import { apiRequest, setTokenProvider } from './client';
import { ApiError, NetworkError, describeError } from './errors';

/**
 * Le client API est le seul point de sortie réseau de l'application.
 * Ces tests verrouillent trois garanties :
 *  - une réponse non conforme au contrat est rejetée, pas propagée ;
 *  - aucune erreur technique brute n'atteint l'utilisateur ;
 *  - le token n'est jamais envoyé sur une route publique.
 */

const schema = z.object({ ok: z.boolean() });

function mockFetch(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  setTokenProvider(() => null);
  jest.restoreAllMocks();
});

describe('apiRequest', () => {
  it('valide et renvoie une réponse conforme', async () => {
    mockFetch({ ok: true });
    await expect(
      apiRequest({ path: '/test', schema, isPublic: true }),
    ).resolves.toEqual({
      ok: true,
    });
  });

  it('rejette une réponse non conforme au contrat', async () => {
    mockFetch({ ok: 'oui' });
    await expect(
      apiRequest({ path: '/test', schema, isPublic: true }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('traduit un code métier en message lisible', async () => {
    mockFetch(
      { statusCode: 401, code: 'INVALID_CREDENTIALS' },
      { status: 401 },
    );
    await expect(
      apiRequest({ path: '/auth/login', schema, isPublic: true }),
    ).rejects.toThrow('Numéro ou mot de passe incorrect.');
  });

  it('n’expose jamais un code technique inconnu à l’utilisateur', async () => {
    mockFetch(
      { statusCode: 500, code: 'PRISMA_P2025_RECORD_NOT_FOUND' },
      { status: 500 },
    );
    await expect(
      apiRequest({ path: '/test', schema, isPublic: true }),
    ).rejects.toThrow(
      'Le service rencontre un problème. Réessayez dans un moment.',
    );
  });

  it('transforme une panne réseau en NetworkError explicite', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch')) as never;
    await expect(
      apiRequest({ path: '/test', schema, isPublic: true }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('attache le token sur une route protégée', async () => {
    const fn = mockFetch({ ok: true });
    setTokenProvider(() => 'jeton-test');
    await apiRequest({ path: '/auth/me', schema });

    const headers = fn.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jeton-test');
  });

  it('n’attache jamais le token sur une route publique', async () => {
    const fn = mockFetch({ ok: true });
    setTokenProvider(() => 'jeton-test');
    await apiRequest({ path: '/products', schema, isPublic: true });

    const headers = fn.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('ignore les paramètres de requête non définis', async () => {
    const fn = mockFetch({ ok: true });
    await apiRequest({
      path: '/products',
      query: { search: 'Sika', category: undefined, page: 1 },
      schema,
      isPublic: true,
    });

    const url = String(fn.mock.calls[0]?.[0]);
    expect(url).toContain('search=Sika');
    expect(url).toContain('page=1');
    expect(url).not.toContain('category');
  });
});

describe('describeError', () => {
  it('rend lisible une erreur inconnue', () => {
    expect(describeError(new Error('ECONNREFUSED 127.0.0.1:5432'))).toBe(
      'Une erreur est survenue. Réessayez.',
    );
  });

  it('conserve le message métier d’une ApiError', () => {
    const error = new ApiError({
      status: 409,
      code: 'PHONE_ALREADY_USED',
      message: 'Déjà pris.',
    });
    expect(describeError(error)).toBe('Déjà pris.');
  });
});
