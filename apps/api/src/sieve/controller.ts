import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SieveDeviceLogin, SieveScrapeService } from './sieve.service';
import { SieveSession } from './model';

/** Payload for `POST /api/auth/device/code`. */
export class SieveDeviceLoginPayloadDto {
  client_name!: string;
}

/** Session returned by the device-login start. */
export class SieveDeviceLoginResponseDto {
  device_code!: string;
  user_code!: string;
  verification_uri!: string;
  verification_uri_complete!: string;
  expires_in!: number;
}

/** Compact status payload returned by `GET /sieve/scrapes/:session_id`. */
export class SieveSessionStatusDto {
  status!: string;
  message!: string;
  updated_at!: string;
}

@ApiTags('Sieve')
@Controller('sieve')
export class SieveController {
  constructor(
    private readonly deviceLogin: SieveDeviceLogin,
    private readonly scrape: SieveScrapeService,
    private readonly session: SieveSession,
  ) {}

  /**
   * Démarre le device login.
   *
   * L'appelant doit persister la session renvoyée : le run doit être durable
   * AVANT tout trafic HTTP vers Sieve. Sans clé configurée, l'endpoint répond
   * 503 — le comportement de l'application est inchangé.
   */
  @Post('device/code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a device login.' })
  @ApiOkResponse({ type: SieveDeviceLoginResponseDto })
  async deviceCode(@Body() body: SieveDeviceLoginPayloadDto) {
    if (!this.session.hasKey()) {
      throw new ServiceUnavailableException(
        'SIEVE_API_KEY is not configured; the device login is unavailable',
      );
    }
    return this.deviceLogin.start({ client_name: body.client_name });
  }

  /**
   * Poll the device-token endpoint until the user approves.
   *
   * Terminal states (`access_denied`, `expired_token`, timeout) surface as
   * 401/400/502 — a caller retries only on `authorization_pending`/`slow_down`.
   */
  @Post('device/token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Poll the device token endpoint.' })
  async deviceToken(@Body() body: { device_code: string; interval?: number }) {
    return this.deviceLogin.poll(body.device_code, body.interval ?? 5_000);
  }

  /**
   * Démarre un run de scrape.
   *
   * Le contrôleur persiste la session AVANT l'appel HTTP : un crash après le
   * retour de cet endpoint laisse une ligne reprenable. `run_id` renvoyé est
   * l'identifiant opaque à poller ensuite.
   */
  @Post('scrapes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a scrape run and persist the session first.' })
  async startScrape(
    @Body()
    body: {
      instruction: string;
      target_urls: string[];
      fields: string[];
      schema: string;
      output_schema: string;
      table_shape: string;
      compliance_mode: 'regular' | 'yolo';
    },
  ) {
    if (!this.session.hasKey()) {
      throw new ServiceUnavailableException(
        'SIEVE_API_KEY is not configured; the scrape endpoint is unavailable',
      );
    }

    // Persisté d'abord : la ligne existe même si l'appel réseau échoue.
    const session = await this.session.create({
      instruction: body.instruction,
      status: 'queued',
    });

    const run = await this.scrape.start(
      body.instruction,
      body.target_urls,
      body.fields,
      body.schema,
      body.output_schema,
      body.table_shape,
      body.compliance_mode,
    );

    await this.session.updateStatus(session.id, 'running');
    return { session_id: session.id, run_id: run.runId, status: 'running' };
  }

  /**
   * Statut d'une session persistée : la source de vérité que l'appelant
   * réconcilie. La session porte désormais TOUT ce qui suit la structure de
   * `SieveSessionRow` — l'identité est un UUID généré par l'API, jamais un
   * code de device.
   */
  @Get('scrapes/:session_id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read the status of a persisted session.' })
  @ApiOkResponse({ type: SieveSessionStatusDto })
  async getSession(@Param('session_id', ParseUUIDPipe) sessionId: string) {
    const session = await this.session.findById(sessionId);
    if (!session) throw new NotFoundException(`Sieve session ${sessionId} not found`);
    return {
      status: session.status,
      message: session.status === 'queued' ? 'Queued' : session.status,
      updated_at: session.updatedAt.toISOString(),
    };
  }
}