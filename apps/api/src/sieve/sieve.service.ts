import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import {
  SIEVE_API_BASE_URL,
  sendSieveRequest,
} from './client';
import type {
  SieveDeviceLoginPayload,
  SieveDeviceLoginResponse,
  SieveDeviceTokenResponse,
  SieveScrapeRun,
  SieveScrapeRunResponse,
  SieveScrapeSession,
  SieveFollowupTurn,
} from './types';
import { parseSieveEnv } from './config';

/**
 * Device login against the Sieve scrape API.
 *
 * Follows the approved contract (device flow):
 *   POST /api/auth/device/code  → { device_code, user_code, verification_uri, … }
 *   (user approves once in the browser)
 *   POST /api/auth/device/token → { access_token, … }  (poll with device_code)
 *
 * Status mapping:
 *   authorization_pending / slow_down → retry after interval
 *   access_denied / expired_token     → error
 *   verified                          → proceed to scrape
 */
@Injectable()
export class SieveDeviceLogin {
  private readonly logger = new Logger(SieveDeviceLogin.name);
  private env = parseSieveEnv(process.env);

  /**
   * Start the device login.
   *
   * Returns the session the caller persists (in `sieve_sessions`) BEFORE the
   * polling loop begins — the contract requires the run to be durable before
   * any Sieve HTTP call.
   */
  async start(payload: SieveDeviceLoginPayload): Promise<SieveScrapeSession> {
    if (!this.env.SIEVE_API_KEY) {
      this.logger.warn('SIEVE_API_KEY unset: serving the login workflow without contacting the API');
      return {
        run_id: '',
        user_code: '',
        verification_uri: '',
        status: 'error',
      };
    }

    const body: SieveDeviceLoginPayload = { client_name: payload.client_name };
    const response = await sendSieveRequest<SieveDeviceLoginResponse>(
      `${SIEVE_API_BASE_URL}/api/auth/device/code`,
      { method: 'POST', apiKey: this.env.SIEVE_API_KEY, body: JSON.stringify(body) },
    );

    return {
      run_id: response.device_code,
      user_code: response.user_code,
      verification_uri: response.verification_uri,
      status: 'authorization_pending',
      started_at: new Date().toISOString(),
    };
  }

  /**
   * Poll the Token endpoint until the user approves, the code expires, or the
   * device_code is denied.
   *
   * Retries only on `authorization_pending` / `slow_down`; every other outcome
   * is terminal and surfaced as an error.
   */
  async poll(
    deviceCode: string,
    intervalMs = 5_000,
  ): Promise<SieveDeviceTokenResponse> {
    if (!this.env.SIEVE_API_KEY) {
      throw new ServiceUnavailableException(
        'SIEVE_API_KEY is not configured; device login cannot complete',
      );
    }

    const body = JSON.stringify({ device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    let deadline = Date.now() + 600_000; // 10 minutes (contract: expires_in ~600)

    while (Date.now() < deadline) {
      const response = await sendSieveRequest<SieveDeviceTokenResponse>(
        `${SIEVE_API_BASE_URL}/api/auth/device/token`,
        { method: 'POST', apiKey: this.env.SIEVE_API_KEY, body },
      );

      if (response.access_token) return response;

      // Expected polling states: "authorization_pending" / "slow_down".
      // Anything else is either terminal (access_denied / expired_token) or an
      // unexpected API problem — both are surfaced here rather than retried.
      const error = response as unknown as Record<string, unknown>;
      const errorDescription =
        typeof error.error_description === 'string' ? error.error_description : undefined;

      switch (error.error) {
        case 'authorization_pending':
          this.logger.debug(`device login pending, retrying in ${intervalMs}ms`);
          await this.sleep(intervalMs);
          continue;
        case 'slow_down':
          this.logger.debug(`device login slow_down, backing off to ${intervalMs * 2}ms`);
          await this.sleep(intervalMs * 2);
          continue;
        case 'access_denied':
          throw new UnauthorizedException(
            `device login refused: ${errorDescription ?? 'user declined'}`,
          );
        case 'expired_token':
          throw new BadRequestException('device code expired before approval');
        default:
          // Unexpected statuses (network, 5xx, unmodelled) → do not retry blindly.
          throw new BadGatewayException(
            `device login failed: ${errorDescription ?? error.error ?? 'unknown'}`,
          );
      }
    }

    throw new BadRequestException('device login timed out before the user could approve');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Start a scrape run, persist the session deterministically, and poll it.
 *
 * Contract positions this service as the sole owner of the HTTP call to
 * `POST /api/scrapes`. The caller persists the session BEFORE this method is
 * called (durable before any network), and polls the returned `session_id`
 * afterwards via `GET /sieve/scrapes/:session_id`.
 */
@Injectable()
export class SieveScrapeService {
  private env = parseSieveEnv(process.env);

  async start(
    instruction: string,
    targetUrls: string[],
    fields: string[],
    schema: string,
    outputSchema: string,
    tableShape: string,
    complianceMode: 'regular' | 'yolo',
  ): Promise<{ runId: string; sessionId: string }> {
    if (!this.env.SIEVE_API_KEY) {
      throw new ServiceUnavailableException(
        'SIEVE_API_KEY is not configured; scrape run cannot start',
      );
    }

    const run: SieveScrapeRun = {
      instruction,
      target_urls: targetUrls,
      fields,
      schema,
      output_schema: outputSchema,
      table_shape: tableShape,
      compliance_mode: complianceMode,
    };

    const payload = { run };
    const response = await sendSieveRequest<SieveScrapeRunResponse>(
      `${SIEVE_API_BASE_URL}/api/scrapes`,
      { method: 'POST', apiKey: this.env.SIEVE_API_KEY, body: JSON.stringify(payload) },
    );

    // The run_id is the opaque identifier the driver persists and later uses
    // for polling the follow-up `/messages` endpoint.
    return {
      runId: response.run_id,
      sessionId: response.run_id,
    };
  }

  /**
   * Poll a run's status until it leaves `queued`/`running`.
   *
   * The caller owns persisting the session AFTER this method returns so the
   * terminal state is reconciled back into the database (status, error, turns).
   */
  async pollStatus(runId: string): Promise<SieveScrapeRunResponse> {
    if (!this.env.SIEVE_API_KEY) {
      throw new ServiceUnavailableException(
        'SIEVE_API_KEY is not configured; scrape poll cannot complete',
      );
    }

    return sendSieveRequest<SieveScrapeRunResponse>(
      `${SIEVE_API_BASE_URL}/api/scrapes/${encodeURIComponent(runId)}`,
      { method: 'GET', apiKey: this.env.SIEVE_API_KEY },
    );
  }

  /**
   * Fetch the follow-up messages (turns) for a completed run.
   *
   * The driver resumes only this session's row when it is `running` again,
   * so the turn records live in this table alongside the run.
   */
  async fetchMessages(runId: string): Promise<SieveFollowupTurn[]> {
    if (!this.env.SIEVE_API_KEY) {
      throw new ServiceUnavailableException(
        'SIEVE_API_KEY is not configured; follow-up /messages cannot complete',
      );
    }

    const raw = await sendSieveRequest<{ data: SieveFollowupTurn[] }>(
      `${SIEVE_API_BASE_URL}/api/scrapes/${encodeURIComponent(runId)}/messages`,
      { method: 'GET', apiKey: this.env.SIEVE_API_KEY },
    );

    return raw.data ?? [];
  }
}
