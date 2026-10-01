// apps/web-tenant/src/features/auditor/realm.ts · PC-56 TENANT-9c · THE AUDITOR REALM in the console — pure helpers (no IO).
//
// W200 `/auditor` (the overview + the trail it reads), W436 `/auditor/ledger`, W437 `/auditor/compliance-pack`, W201
// `/auditor/exports`, the export chain W2500 (confirm) → W2498 (queued) / W2502 (failure) at `/auditor/exports/new` →
// `/auditor/exports/[id]` (W2498 queued / W2499 ready). Every figure the pages print is the API's; every list here mirrors
// the API's own (the console spec reads them from the API source); and every canon promise the platform cannot back is a
// sentence (`AUDITOR_REFUSED_BY_NAME`), never a tick. There is NO "verified" word composed here: the integrity lines are
// counts of what was checked and what was withheld.
import type { AuditorHashLink, AuditorOverview, AuditorOwnAccount } from '@krishalaya/sdk-js';

export const AUDITOR_HREF = '/auditor';
export const LEDGER_HREF = '/auditor/ledger';
export const PACK_HREF = '/auditor/compliance-pack';
export const EXPORTS_HREF = '/auditor/exports';
export const NEW_EXPORT_HREF = '/auditor/exports/new';
export const exportHref = (id: string) => `${EXPORTS_HREF}/${encodeURIComponent(id)}`;
export const exportDownloadHref = (id: string, token: string) => `${exportHref(id)}/download?token=${encodeURIComponent(token)}`;

/** The API's `AUDITOR_REFUSED_BY_NAME`, in its order (the spec reads it from `auditor-realm.ts`). */
export const AUDITOR_REFUSED_BY_NAME = [
  'platformSignature', 'sharedChain', 'recordedCheck', 'reversalsLinked', 'numberingGaps', 'exceptionRegister', 'accessWindow',
  'firmIdentity', 'pdfWatermark', 'byteIdentical', 'irn', 'gstPayableTie', 'ekycBlocked', 'signAttest', 'quarterClose', 'retry',
] as const;
export type AuditorRefusal = (typeof AUDITOR_REFUSED_BY_NAME)[number];
export const refusedKey = (r: AuditorRefusal) => `auditor.refused.${r}`;

/** Which refusals each page prints (the page's own canon elements). */
export const PAGE_REFUSALS: Readonly<Record<'overview' | 'ledger' | 'pack' | 'exports' | 'chain', readonly AuditorRefusal[]>> = {
  overview: ['recordedCheck', 'sharedChain', 'reversalsLinked', 'numberingGaps', 'exceptionRegister', 'accessWindow', 'firmIdentity'],
  ledger: ['sharedChain', 'platformSignature'],
  pack: ['signAttest', 'platformSignature', 'pdfWatermark', 'irn', 'gstPayableTie', 'ekycBlocked', 'quarterClose', 'sharedChain'],
  exports: ['platformSignature', 'pdfWatermark', 'byteIdentical'],
  chain: ['retry'],
};

export const AUDITOR_DATASETS = ['audit.trail', 'ledger.entries', 'compliance.pack'] as const;
export type AuditorDataset = (typeof AUDITOR_DATASETS)[number];
export const PACK_SECTIONS = ['gst', 'ledger', 'schemes', 'privacy'] as const;
export type PackSection = (typeof PACK_SECTIONS)[number];
/** The API's bounds (`auditor-realm.ts`): 92 days live, 366 for an export file, 92 for a pack section. */
export const MAX_LIVE_WINDOW_DAYS = 92;
export const MAX_EXPORT_WINDOW_DAYS = 366;
export const datasetKey = (d: string) => `auditor.dataset.${(AUDITOR_DATASETS as readonly string[]).includes(d) ? d.replace('.', '_') : 'other'}`;
export const sectionKey = (s: string) => `auditor.section.${(PACK_SECTIONS as readonly string[]).includes(s) ? s : 'other'}`;
export const isDataset = (v: unknown): v is AuditorDataset => typeof v === 'string' && (AUDITOR_DATASETS as readonly string[]).includes(v);
export const isSection = (v: unknown): v is PackSection => typeof v === 'string' && (PACK_SECTIONS as readonly string[]).includes(v);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A civil day — the cooperative's — or nothing. Never a 400 page for a hand-typed URL. */
export function dayOrUndefined(v: unknown): string | undefined {
  if (typeof v !== 'string' || !DAY.test(v)) return undefined;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? v : undefined;
}

export interface WindowFilters { from?: string; to?: string; cursor?: string; txnType?: string }
export function windowFilters(sp: Record<string, string | string[] | undefined>): WindowFilters {
  const one = (k: string) => { const v = sp[k]; return typeof v === 'string' ? v.trim() : undefined; };
  const f: WindowFilters = {};
  const from = dayOrUndefined(one('from')); if (from) f.from = from;
  const to = dayOrUndefined(one('to')); if (to) f.to = to;
  const c = one('cursor'); if (c && c.length <= 200 && /^[A-Za-z0-9_-]+$/.test(c)) f.cursor = c;
  const tt = one('txnType'); if (tt && /^[a-z][a-z0-9_]{0,59}$/.test(tt)) f.txnType = tt;
  return f;
}
export function ledgerHref(f: WindowFilters, cursor?: string | null): string {
  const q = new URLSearchParams();
  if (f.from) q.set('from', f.from); if (f.to) q.set('to', f.to); if (f.txnType) q.set('txnType', f.txnType);
  if (cursor) q.set('cursor', cursor);
  const s = q.toString();
  return s ? `${LEDGER_HREF}?${s}` : LEDGER_HREF;
}

/** The export chain's confirm step (W2500) for a dataset and its window. */
export function newExportHref(dataset: AuditorDataset, params: { from: string; to: string; section?: PackSection }): string {
  const q = new URLSearchParams({ step: 'confirm', dataset, from: params.from, to: params.to });
  if (params.section) q.set('section', params.section);
  return `${NEW_EXPORT_HREF}?${q.toString()}`;
}

/** The page state an API refusal is (6e-1's lesson: a flag off is a sentence, not "couldn't load"). */
export type RealmState = 'flaggedOff' | 'restricted' | 'window' | 'notFound' | 'error';
export function realmState(code: string | null | undefined, status?: number): RealmState {
  if (code === 'AUDITOR_REALM_OFF' || code === 'EXPORT_PLANE_DISABLED') return 'flaggedOff';
  if (code === 'AUDITOR_SCOPE_ONLY' || code === 'FORBIDDEN' || status === 403) return 'restricted';
  if (code === 'AUDIT_WINDOW_REFUSED') return 'window';
  if (code === 'AUDIT_ENTRY_NOT_FOUND' || code === 'EXPORT_JOB_NOT_FOUND') return 'notFound';
  return 'error';
}
export const realmStateKey = (s: RealmState) => `auditor.state.${s}`;

/** The window refusal's own words (`details.code` from AUDIT_WINDOW_REFUSED / the producer's schema). */
export const WINDOW_REFUSALS = ['DATE_INVALID', 'WINDOW_ORDER', 'WINDOW_TOO_WIDE'] as const;
export const windowRefusalKey = (code: unknown) => `auditor.window.${(WINDOW_REFUSALS as readonly string[]).includes(String(code)) ? String(code) : 'other'}`;

/* ------------------------------------------------------------------------------------------------------------- */
/* THE LEDGER'S WORDS                                                                                            */
/* ------------------------------------------------------------------------------------------------------------- */

export const LEG_KINDS = ['tenant_own', 'platform', 'member_wallet', 'other_tenant'] as const;
export const legKindKey = (k: string) => `auditor.leg.kind.${(LEG_KINDS as readonly string[]).includes(k) ? k : 'other_tenant'}`;
export const sideKey = (s: string) => `auditor.leg.side.${s === 'Dr' || s === 'Cr' ? s : 'zero'}`;
export const CHAIN_VERDICTS = ['intact', 'hash_mismatch', 'chain_break', 'incomplete', 'empty'] as const;
export const chainKey = (c: string) => `auditor.chain.${(CHAIN_VERDICTS as readonly string[]).includes(c) ? c : 'incomplete'}`;

/** One leg's hash-link verdict as a key — a WITHHELD link is its own sentence and never a tick. */
export function hashLinkKey(h: AuditorHashLink): string {
  if (h.kind === 'withheld') return `auditor.link.withheld.${h.reason}`;
  if (h.kind === 'linked') return h.genesis ? 'auditor.link.linkedGenesis' : 'auditor.link.linked';
  return `auditor.link.${h.kind}`;
}
export function hashLinkTone(h: AuditorHashLink): 'ok' | 'danger' | 'muted' {
  if (h.kind === 'linked') return 'ok';
  if (h.kind === 'withheld') return 'muted';
  return 'danger';
}
/** `9f2a1b3c…c418` — enough to compare by eye; the full hash is in the export. */
export function shortHash(h: string | null | undefined): string | null {
  if (!h) return null;
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h;
}

/** The recompute W436 prints: each term with its own sign, never a float. */
export function signedTerms(terms: readonly string[]): Array<{ sign: '−' | '+'; absMinor: string; first: boolean }> {
  return terms.map((t, i) => {
    const neg = t.startsWith('-');
    return { sign: neg ? '−' : '+', absMinor: neg ? t.slice(1) : t, first: i === 0 };
  });
}

/** A transaction's Σ line as a key: foots / does not / cannot be footed here (a leg is not this cooperative's). */
export function footKey(f: { complete: boolean; foots: boolean }): string {
  if (!f.complete) return 'auditor.foot.incomplete';
  return f.foots ? 'auditor.foot.foots' : 'auditor.foot.notFoot';
}

/** W200's integrity tile: what was CHECKED and what was WITHHELD, as separate lines with counts — never one "verified". */
export function integrityLines(i: AuditorOverview['integrity']): Array<{ key: string; params: Record<string, number | string>; tone: 'ok' | 'danger' | 'muted' }> {
  const out: Array<{ key: string; params: Record<string, number | string>; tone: 'ok' | 'danger' | 'muted' }> = [];
  const z = i.zeroSum;
  out.push({ key: 'auditor.integrity.zeroSum', params: { foot: z.foot, checked: z.checked }, tone: z.notFoot > 0 ? 'danger' : z.checked === 0 ? 'muted' : 'ok' });
  if (z.notFoot > 0) out.push({ key: 'auditor.integrity.notFoot', params: { n: z.notFoot }, tone: 'danger' });
  if (z.incomplete > 0) out.push({ key: 'auditor.integrity.incomplete', params: { n: z.incomplete }, tone: 'muted' });
  for (const a of i.ownAccounts) out.push(...ownAccountLines(a));
  if (i.ownAccounts.length === 0) out.push({ key: 'auditor.integrity.noOwnAccount', params: {}, tone: 'muted' });
  out.push({ key: 'auditor.integrity.shared', params: {}, tone: 'muted' });
  return out;
}
export function ownAccountLines(a: AuditorOwnAccount): Array<{ key: string; params: Record<string, number | string>; tone: 'ok' | 'danger' | 'muted' }> {
  return [
    { key: chainKey(a.chain), params: { account: a.accountCode, n: a.chainChecked ?? a.entryCount }, tone: a.chain === 'intact' ? 'ok' : a.chain === 'hash_mismatch' || a.chain === 'chain_break' ? 'danger' : 'muted' },
    { key: a.headMatches === null ? 'auditor.head.notJudged' : a.headMatches ? 'auditor.head.matches' : 'auditor.head.differs', params: { account: a.accountCode }, tone: a.headMatches === false ? 'danger' : a.headMatches ? 'ok' : 'muted' },
    { key: a.balanceEqualsSum ? 'auditor.balance.equal' : 'auditor.balance.drift', params: { account: a.accountCode }, tone: a.balanceEqualsSum ? 'ok' : 'danger' },
  ];
}

/** W200's "What the auditor can see": each line links where its read code lands. */
export const SCOPE_HREFS: Readonly<Record<string, string>> = { ledger: LEDGER_HREF, trail: `${AUDITOR_HREF}#trail`, kyc: '/kyc', governance: '/governance/register', reports: '/invoices' };
export const scopeKey = (code: string) => `auditor.scope.${code}`;

/** The read-log purposes (0181's vocabulary) — the "This view, logged" tile names them. */
export const READ_PURPOSES = ['auditor_overview', 'trail_page', 'trail_entry', 'trail_reveal', 'ledger_page', 'compliance_pack', 'export_list', 'export_enqueue'] as const;
export const purposeKey = (p: string) => `auditor.purpose.${(READ_PURPOSES as readonly string[]).includes(p) ? p : 'other'}`;

/** The trail list's role cell: a recorded role, or the words for a row no writer gave one. */
export function roleCellKey(e: { actorRole: string | null; actorRoleRecorded?: boolean }): string | null {
  return e.actorRole ? null : 'auditor.role.notRecorded';
}

/** "Retry" on the canon's mutate chain is a page load — refused by name; it is never a mutation. */
export function retryIsMutation(): false { return false; }

/** Every auditor export page carries the unsigned sentence (the founder-physical signing-key debt). */
export const UNSIGNED_EXPORT_KEY = 'auditor.unsigned';

/** The enqueue's refusals the chain's failure step names (anything else → the generic sentence). */
export const ENQUEUE_FAILURES = ['EXPORT_PARAMS_INVALID', 'EXPORT_TOO_MANY_OPEN', 'EXPORT_PLANE_DISABLED', 'EXPORT_DATASET_UNKNOWN', 'AUDITOR_REALM_OFF', 'AUDITOR_SCOPE_ONLY', 'FORBIDDEN', 'AUDITOR_READ_ONLY'] as const;
export const enqueueFailureKey = (code: string) => `auditor.chain.failure.${(ENQUEUE_FAILURES as readonly string[]).includes(code) ? code : 'generic'}`;
