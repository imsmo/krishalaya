// apps/admin-api/src/modules/support-oversight/services/support-macros.service.ts · authoring the desk's canned
// answers (PC-56 ADMIN-2, canon W053; tables in migration 0096).
//
// WHY A MACRO IS A TRUST OBJECT, NOT A PRODUCTIVITY ONE. Twelve questions make up most of a support desk's day, and
// they are questions about money: when will my payout arrive, why was my KYC rejected, where is my order. If agents
// retype those answers, the answers drift — and two farmers asking the same question get different promises. A macro is
// how a platform says the same true thing twice.
//
// So the rules this service enforces are about the ANSWER, not about convenience: an English body is mandatory (it is
// what the desk reviews the others against), only LIVE languages are allowed (an unreviewed machine translation pasted
// to a farmer is worse than English), and archiving never deletes (a macro used on a ticket must stay readable, or that
// ticket's history becomes a reply nobody can account for).
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { SupportOversightRepository } from '../repositories/support-oversight.repository';
import { assertSlug, assertBodies, missingLanguages } from '../domain/macro';
import { DuplicateMacroError, MacroNotFoundError } from '../domain/support-oversight.errors';
import { CreateMacroDto, ToggleMacroDto } from '../dto/support-oversight.dto';

@Injectable()
export class SupportMacrosService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: SupportOversightRepository,
  ) {}

  /** The list, with each macro's MISSING languages computed — the gap is invisible unless something names it. */
  async list() {
    const rows = await this.repo.listMacros();
    return {
      items: rows.map((m) => ({
        ...m,
        missingLanguages: missingLanguages((m.languages as string[]) ?? []),
      })),
    };
  }

  async bodies(macroId: string) {
    const bodies = await this.repo.macroBodies(macroId);
    if (bodies.length === 0) throw new MacroNotFoundError(macroId);
    return { macroId, bodies };
  }

  async create(actor: AdminRequestContext, dto: CreateMacroDto) {
    const slug = assertSlug(dto.slug);                       // 422 with the reason
    const bodies = assertBodies(dto.bodies);                 // 422; English required, live languages only
    const id = randomUUID();

    return this.pool.withTx(async (client) => {
      // Checked inside the tx so two authors racing on the same shortcut cannot both win (the UNIQUE index is the
      // backstop; this is the friendly 409).
      if (await this.repo.slugTaken(client, slug)) throw new DuplicateMacroError(slug);

      await this.repo.insertMacro(client, {
        id, slug, title: dto.title.trim(), categoryId: dto.categoryId ?? null,
        notes: dto.notes?.trim() || null, bodies, actorUserId: actor.userId,
      });
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'support.macro_created', entityType: 'support_macro', entityId: id,
        newValue: {
          slug, title: dto.title.trim(),
          languages: bodies.map((b) => b.languageCode),
          missingLanguages: missingLanguages(bodies.map((b) => b.languageCode)),
        },
        reason: dto.notes?.trim() || `macro /${slug} created`,
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, slug, languages: bodies.map((b) => b.languageCode), missingLanguages: missingLanguages(bodies.map((b) => b.languageCode)) };
    });
  }

  /** Archive or restore. The row survives either way — see the header. */
  async toggle(actor: AdminRequestContext, id: string, dto: ToggleMacroDto) {
    return this.pool.withTx(async (client) => {
      const changed = await this.repo.setMacroActive(client, id, dto.active !== false, actor.userId);
      if (!changed) throw new MacroNotFoundError(id);
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: dto.active === false ? 'support.macro_archived' : 'support.macro_restored',
        entityType: 'support_macro', entityId: id,
        newValue: { isActive: dto.active !== false },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, isActive: dto.active !== false };
    });
  }
}
