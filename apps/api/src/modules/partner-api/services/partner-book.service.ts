// modules/partner-api/services/partner-book.service.ts · PC-55 A10. The partner realm's read use-cases.
// Thin ON PURPOSE: the guard has already established WHO the caller is, migration 0090's RLS has already established
// WHAT they may see, and the repository owns the elevated-session mechanics. What is left for this layer is the part
// a partner integration actually needs to be reliable — a stable, self-describing page contract:
//   • page size is clamped by us (a cross-tenant book must never be asked for "all rows");
//   • `nextCursor` is the last row's uuid v7 id, or null when the page was not full — so an integrator loops until
//     null instead of guessing at totals (there is deliberately no COUNT: an honest cursor beats an expensive lie);
//   • every money field is a bigint minor-unit STRING (Law 2), never a float.
import { Injectable } from '@nestjs/common';
import { clampLimit } from '../domain/partner-key.rules';
import { PartnerApiRepository } from '../repositories/partner-api.repository';

export interface PartnerPage { rows: Array<Record<string, unknown>>; nextCursor: string | null; limit: number }

@Injectable()
export class PartnerBookService {
  constructor(private readonly repo: PartnerApiRepository) {}

  private page(rows: Array<Record<string, unknown>>, limit: number): PartnerPage {
    const nextCursor = rows.length === limit ? String(rows[rows.length - 1].id) : null;
    return { rows, nextCursor, limit };
  }

  async loans(partnerId: string, q: { status?: string; cursor?: string; limit?: unknown }): Promise<PartnerPage> {
    const limit = clampLimit(q.limit);
    return this.page(await this.repo.loans(partnerId, { status: q.status, cursorId: q.cursor, limit }), limit);
  }

  async loanRepayments(partnerId: string, loanId: string, limit?: unknown): Promise<PartnerPage> {
    // A loan outside this partner's book simply returns an EMPTY schedule rather than a 404: the realm must not
    // become an existence oracle for other partners' loan ids (same reasoning as the guard's opaque 401).
    const n = clampLimit(limit, 200, 500); // one loan's schedule is bounded by its own tenor
    return this.page(await this.repo.loanRepayments(partnerId, loanId, n), n);
  }

  async policies(partnerId: string, q: { status?: string; cursor?: string; limit?: unknown }): Promise<PartnerPage> {
    const limit = clampLimit(q.limit);
    return this.page(await this.repo.policies(partnerId, { status: q.status, cursorId: q.cursor, limit }), limit);
  }
}
