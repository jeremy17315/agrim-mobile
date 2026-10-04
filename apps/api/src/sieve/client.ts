// Sieve HTTP boundary — no secrets, no config read.

/** Parsed API key from the secret store. Never printed, never logged. */
export function getApiKey(): string | null {
  const raw = process.env.SIEVE_API_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Base URL of the Sieve scrape API.
 * Configured via SIEVE_BASE_URL; the endpoint returned by the device-login
 * endpoint in the contract is used for the actual API calls instead.
 */
export const SIEVE_API_BASE_URL = (() => {
  const raw = process.env.SIEVE_BASE_URL;
  if (!raw) return 'https://scrape.usesieve.com';
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : 'https://scrape.usesieve.com';
})();

/**
 * Send a request to the Sieve scrape API on the device's behalf.
 *
 * Callers own the lifecycle: the run is persisted to the `sieve_sessions`
 * table (by the caller that owns the session) BEFORE this call, and polled
 * AFTER. The HTTP layer here is intentionally dumb — it records the outcome
 * and never interprets "queued" / "running" status beyond returning it.
 */
export async function sendSieveRequest<T>(
  path: string,
  init: RequestInit & { apiKey: string },
): Promise<T> {
  const url = new URL(path, SIEVE_API_BASE_URL);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  url.searchParams.set('api_key', init.apiKey);
  try {
    const response = await fetch(url.toString(), {
      ...init,
      headers: {
        ...init.headers,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    const raw: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const { message, cause } = parseErrorShape(raw);
      if (response.status === 401) {
        throw new SieveAuthError(message ?? 'Unauthenticated', { cause });
      }
      throw new SieveApiError(response.status, message ?? 'API error', { cause });
    }
    if (response.status === 204) return undefined as T;
    return raw as T;
  } finally {
    clearTimeout(timeout);
  }
}

function parseErrorShape(raw: unknown): { message?: string; cause?: unknown } {
  if (raw == null) return {};
  if (typeof raw === 'string') return { message: raw };
  if (typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  if (typeof obj.message === 'string' && obj.message.length > 0) return { message: obj.message };
  if (typeof obj.error === 'string' && obj.error.length > 0) return { message: obj.error };
  return {};
}

export class SieveAuthError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SieveAuthError';
  }
}

export class SieveApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SieveApiError';
    this.status = status;
  }
}
