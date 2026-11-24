// apps/admin-api/src/modules/platform-pages/domain/platform-page.state.ts · PC-56 LEGAL-1 (Law 5 — the transitions live in ONE place).
//
// The same table as 0177's tenant guard, apps/api's domain/page-acts.ts and 0242's `cms_pages_platform_guard` (the database is the second
// layer): draft → published | archived, published → archived; archived is final. A published version's words never change — a new
// version is a new draft.
export type PageStatus = 'draft' | 'published' | 'archived';

const NEXT: Readonly<Record<PageStatus, readonly PageStatus[]>> = Object.freeze({
  draft: ['published', 'archived'],
  published: ['archived'],
  archived: [],
});

export function canTransition(from: PageStatus, to: PageStatus): boolean {
  return NEXT[from]?.includes(to) ?? false;
}

/** Which grant an archive needs: abandoning a DRAFT is the author's act; taking a LIVE page down is the checker's (it changes what every
 *  buyer reads — the storefront then says "not published yet"). */
export function archivePermissionFor(status: PageStatus): 'platform.pages.manage' | 'platform.pages.publish' {
  return status === 'published' ? 'platform.pages.publish' : 'platform.pages.manage';
}

export type PublishVerdict = 'ok' | 'maker_unnamed' | 'maker_is_checker';
/**
 * MAKER ≠ CHECKER on a POLICY page (0242's trigger says the same, 23514). The maker is the author (`created_by`) AND the last editor
 * (`last_edited_by_admin_id`) — either may not publish. A version with NEITHER named (a seeded draft nobody has adopted) cannot be published
 * at all: one operator alone would otherwise put unreviewed words live. Two NULLs never compare equal (two-person-rule.ts's lesson).
 */
export function publishVerdict(v: { pageKind: string; createdBy: string | null; lastEditedByAdminId: string | null }, publisher: string): PublishVerdict {
  if (v.pageKind !== 'policy') return 'ok';
  if (!v.createdBy && !v.lastEditedByAdminId) return 'maker_unnamed';
  if (!publisher || publisher === v.createdBy || publisher === v.lastEditedByAdminId) return 'maker_is_checker';
  return 'ok';
}
