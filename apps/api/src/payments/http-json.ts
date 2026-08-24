/**
 * Le seul point de contact réseau des pilotes de paiement.
 *
 * Toutes les erreurs — HTTP, réseau, JSON illisible — sont traduites en
 * `PaymentGatewayError`. Un module métier ne doit jamais voir passer une
 * exception `fetch` brute, dont le message est en anglais et fuite l'URL
 * interne du fournisseur.
 */
import { PaymentGatewayError } from './payment.provider';

/** Timeout borné : 1 à 60 secondes. Un paiement bloqué n'est pas un paiement. */
export function boundedTimeout(raw: string | undefined, fallback = 20): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(60, Math.max(1, parsed));
}

export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  timeoutSeconds = 20,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'AbortError'
        ? `délai de ${timeoutSeconds}s dépassé`
        : 'connexion impossible';
    throw new PaymentGatewayError(
      `Fournisseur de paiement injoignable (${reason}).`,
    );
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();

  if (!response.ok) {
    // Tronqué : la réponse d'erreur d'un agrégateur peut être une page HTML
    // entière, qui n'a rien à faire dans nos journaux.
    throw new PaymentGatewayError(
      `Réponse ${response.status} du fournisseur : ${raw.slice(0, 400)}`,
    );
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new PaymentGatewayError(
      'Réponse illisible du fournisseur de paiement.',
    );
  }
}

/** Lecture défensive : les agrégateurs changent le type d'un champ sans prévenir. */
export function readString(source: unknown, key: string): string {
  if (typeof source !== 'object' || source === null) return '';
  const value = (source as Record<string, unknown>)[key];
  if (value === null || value === undefined) return '';
  return String(value);
}

export function readObject(
  source: unknown,
  key: string,
): Record<string, unknown> {
  if (typeof source !== 'object' || source === null) return {};
  const value = (source as Record<string, unknown>)[key];
  if (typeof value !== 'object' || value === null) return {};
  return value as Record<string, unknown>;
}
