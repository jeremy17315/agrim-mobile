import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { getApiKey } from './client';

/**
 * Durable session for a Sieve scrape run.
 *
 * The driver persists this row BEFORE contacting the Sieve API (so a crash
 * cannot lose the run) and polls the returned `run_id` afterwards to reconcile
 * status, error and follow-up turns. The single row carries everything the
 * polling loop needs to resume.
 */

/** Un tour de conversation du run, tel qu'il est conservé en base. */
export type SieveTurn = {
  role: string;
  content: string;
  created_at: string;
};

/** Forme rendue par la table `sieve_sessions`. */
export type SieveSessionRow = {
  id: string;
  instruction: string;
  status: string;
  error: string | null;
  turns: SieveTurn[];
  updatedAt: Date;
};

@Injectable()
export class SieveSession {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: { instruction: string; status?: string }): Promise<SieveSessionRow> {
    const session = await this.prisma.db.sieveSession.create({
      data: {
        instruction: input.instruction,
        status: input.status ?? 'queued',
      },
    });
    return mapSieveSession(session);
  }

  async findById(id: string): Promise<SieveSessionRow | null> {
    const session = await this.prisma.db.sieveSession.findUnique({ where: { id } });
    return session ? mapSieveSession(session) : null;
  }

  async updateStatus(id: string, status: string, error?: string): Promise<SieveSessionRow> {
    const session = await this.prisma.db.sieveSession.update({
      where: { id },
      data: { status, error: error ?? null },
    });
    return mapSieveSession(session);
  }

  async appendTurn(
    id: string,
    turn: { role: string; content: string; createdAt: Date },
  ): Promise<SieveSessionRow> {
    const current = await this.prisma.db.sieveSession.findUnique({
      where: { id },
      select: { turns: true },
    });
    const turns = parseTurns(current?.turns ?? null);
    turns.push({
      role: turn.role,
      content: turn.content,
      created_at: turn.createdAt.toISOString(),
    });
    const session = await this.prisma.db.sieveSession.update({
      where: { id },
      data: { turns: JSON.stringify(turns) },
    });
    return mapSieveSession(session);
  }

  /** La clé vient du magasin de secrets ; jamais du bundle mobile. */
  hasKey(): boolean {
    return getApiKey() !== null;
  }
}

/** `turns` est une colonne texte : on y range un tableau JSON, relu défensivement. */
function parseTurns(raw: string | null): SieveTurn[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SieveTurn[]) : [];
  } catch {
    return [];
  }
}

function mapSieveSession(row: {
  id: string;
  instruction: string;
  status: string;
  error: string | null;
  turns: string | null;
  updatedAt: Date;
}): SieveSessionRow {
  return {
    id: row.id,
    instruction: row.instruction,
    status: row.status,
    error: row.error,
    turns: parseTurns(row.turns),
    updatedAt: row.updatedAt,
  };
}