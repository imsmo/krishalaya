// modules/esg/domain/esg-export.ts · PC-56 TENANT-9d · W424's honest alternative, as pure rows and notes.
//
// W424 promises *"signed, reproducible, and blocked if any number lacks its method"*. The guard is the right law; the
// signature is the absent key (F-11, founder-physical). So the file carries ONLY the figures a published method backs with a
// recorded fact, one row per figure with its method cited beside it (the canon's "method appendix", built), the cooperative's
// PUBLISHED disclosures as words, and — on the RECEIPT — every metric left out, by name, with why. Blocking the whole file
// until eleven methods exist would make an export impossible; the canon's own guard text says *"Remove the metric or publish
// its method to proceed"* — the export removes it and says so.
import type { LangMap } from '../../../core/i18n/lang-map';
import type { Fact, Freshness, MethodRow, Verdict } from './esg-rules';

export const ESG_METRICS_DATASET = 'esg.metrics';

export const ESG_EXPORT_HEADER = [
  'pillar', 'metric_code', 'metric_name', 'row_kind', 'method_ref', 'method_version', 'method_text',
  'figure', 'value', 'as_of', 'zone', 'source_tables', 'disclosure_text', 'disclosure_published_at',
] as const;

/** Printed first on every ESG receipt (F-11, ADMIN-5c: a digest is not a signature). */
export const ESG_UNSIGNED_NOTE = 'unsigned — no signing key on this platform (founder-physical); the sha256 on this receipt is a content hash, not a signature';

export interface EsgEntry {
  method: MethodRow; verdict: Verdict; fact: Fact | null; freshness: Freshness | null;
  name: LangMap; methodText: LangMap | null;
}
export interface PublishedDisclosure { metricCode: string; texts: Record<string, string>; publishedAt: string }

const pick = (m: LangMap | null, lang: string): string | null => (m ? (m[lang] ?? m.en) : null);

/** One row per FIGURE of a printable fact — the numbers a spreadsheet can sum, each beside its method. */
export function figuresOf(f: Fact): Array<[string, string | number | boolean | null]> {
  switch (f.kind) {
    case 'omov': return [
      ['closed_resolutions_with_snapshot', f.closedWithSnapshot], ['ballots_cast', f.ballots], ['eligible_at_close', f.eligibleAtClose],
      ['max_ballots_per_member_per_resolution', f.maxBallotsPerMember], ['resolutions_ballots_over_recorded_roll', f.overRoll],
      ['closed_before_snapshot_not_counted', f.notRecordedCloses],
    ];
    case 'adulteration': return [
      ['window_from', f.from], ['window_to', f.to], ['pours_recorded', f.pours], ['pours_flagged', f.flaggedPours],
      ['pours_flagged_water', f.waterFlagged], ['quality_reviews_opened', f.reviewsOpened], ['quality_reviews_retested', f.retested],
      ['last_flagged_day_in_window', f.lastFlaggedDay],
    ];
    case 'audit_trail': return [
      ['append_only_for_tenant_role', f.appendOnly], ['tenant_role_can_update', f.canUpdate], ['tenant_role_can_delete', f.canDelete],
      ['tenant_role_can_truncate', f.canTruncate], ['audit_trail_hash_columns', f.hashColumns.length ? f.hashColumns.join(' ') : 'none'],
      ['money_ledger_hash_chained', f.ledgerChained],
    ];
    default: return [];
  }
}

export function exportRows(entries: readonly EsgEntry[], disclosures: readonly PublishedDisclosure[], lang: string): Array<Array<string | number | boolean | null>> {
  const rows: Array<Array<string | number | boolean | null>> = [];
  for (const e of entries) {
    if (e.verdict !== 'published_with_fact' || !e.fact) continue;           // THE GATE, again — the file cannot widen it
    const m = e.method;
    for (const [figure, value] of figuresOf(e.fact)) {
      rows.push([m.pillar, m.metricCode, pick(e.name, lang), 'figure', m.methodRef, m.methodVersion, pick(e.methodText, lang),
        figure, value, e.freshness?.asOf ?? null, e.freshness?.zone ?? null, m.sourceTables.join(' '), null, null]);
    }
  }
  const byCode = new Map(entries.map((e) => [e.method.metricCode, e]));
  for (const d of disclosures) {
    const e = byCode.get(d.metricCode);
    if (!e) continue;
    rows.push([e.method.pillar, d.metricCode, pick(e.name, lang), 'disclosure', null, null, null, null, null, null, null, null,
      d.texts[lang] ?? d.texts.en ?? Object.values(d.texts)[0] ?? null, d.publishedAt]);
  }
  return rows;
}

/** The receipt's notes: unsigned first, then every refusal by name, then what the file is and is not. */
export function exportNotes(entries: readonly EsgEntry[], ctx: { zone: string; today: string; lang: string; langFallback: boolean; disclosures: number }): string[] {
  const notes: string[] = [ESG_UNSIGNED_NOTE];
  for (const e of entries) {
    if (e.verdict === 'published_with_fact') continue;
    const m = e.method;
    const why = e.verdict === 'no_programme' ? 'no programme recorded on this platform (the platform does not issue or sell credits)'
      : e.verdict === 'no_method' ? 'no method published — no method, no metric'
        : `method ${m.methodRef} v${m.methodVersion} published, nothing recorded for it yet — no figure, never a zero`;
    notes.push(`excluded: ${m.metricCode} — ${why}`);
  }
  const included = entries.filter((e) => e.verdict === 'published_with_fact').map((e) => e.method.metricCode);
  notes.push(`included: ${included.length ? included.join(', ') : 'none'} — each figure carries its method reference and text (the method appendix)`);
  notes.push(`${ctx.disclosures} published disclosure(s) included as the cooperative's own words; a disclosure is never a figure`);
  notes.push(`computed on read over live records, ${ctx.today} in ${ctx.zone}; a re-run can differ — not claimed byte-identical`);
  notes.push('no audience-specific shape, no document id, no verify URL, no watermark, no PDF — CSV only');
  if (ctx.langFallback) notes.push(`requested language not active; names and methods in en`);
  notes.push('carbon: the platform records no carbon programme and does not issue or sell credits');
  return notes;
}
