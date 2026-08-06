// apps/admin-api/src/modules/support-oversight/__tests__/admin2c-support-export.spec.ts · PC-56 ADMIN-2c.
//
// TWO CLASSES OF BUG THIS FILE EXISTS TO CATCH, both of which are invisible on screen:
//
//   1. A COLUMN/ROW MISMATCH. The columns are declared in the domain; the rows come from the repository. If a key is
//      renamed on one side only, `toCsv` renders an EMPTY COLUMN — the file downloads, the header looks right, and the
//      data is silently missing. So every report's declared columns are asserted against the keys the repository
//      actually produces, using the same shapes the SQL returns.
//   2. A PRIVACY DECISION SILENTLY REVERSED. The verbatim report carries a farmer's own words and deliberately does NOT
//      carry the person who wrote them; the scores report carries neither. Those are decisions, not accidents, and a
//      later edit that adds `respondentUserId` to a column list should fail a test rather than ship.
import {
  SUPPORT_EXPORT_REPORTS, isSupportExportReport, supportExportColumns, containsVerbatim,
  supportExportFileName, NOT_EXPORTABLE, csvCell, toCsv,
} from '../domain/support-export';

describe('the report vocabulary', () => {
  it('offers exactly the five support reports', () => {
    expect([...SUPPORT_EXPORT_REPORTS]).toEqual(['tickets', 'sla_breaches', 'csat', 'csat_verbatims', 'csat_reviews']);
    expect(isSupportExportReport('csat_verbatims')).toBe(true);
    expect(isSupportExportReport('coaching')).toBe(false);   // see below — this absence is the point
    expect(isSupportExportReport(undefined)).toBe(false);
    expect(isSupportExportReport('')).toBe(false);
  });

  it('names COACHING as deliberately not exportable, with the reason', () => {
    // a missing case reads as an oversight; a named refusal reads as a decision, and the next person to look for a
    // coaching export finds the reasoning instead of adding one
    expect(Object.keys(NOT_EXPORTABLE)).toEqual(['coaching']);
    expect(NOT_EXPORTABLE.coaching).toMatch(/named people/i);
    expect(SUPPORT_EXPORT_REPORTS as readonly string[]).not.toContain('coaching');
  });

  it('every report declares at least one column and repeats none', () => {
    for (const r of SUPPORT_EXPORT_REPORTS) {
      const cols = supportExportColumns(r);
      expect(cols.length).toBeGreaterThan(0);
      expect(new Set(cols).size).toBe(cols.length);
    }
  });
});

describe('THE PRIVACY DECISIONS, asserted so a later edit cannot quietly reverse them', () => {
  it('never exports a respondent, a requester, or any contact detail — in ANY report', () => {
    // a support CSV must not be able to become a list of named people and what they complained about
    const forbidden = ['respondentUserId', 'requesterUserId', 'email', 'phone', 'msisdn', 'name', 'agentName', 'agentEmail'];
    for (const r of SUPPORT_EXPORT_REPORTS) {
      for (const bad of forbidden) {
        expect(supportExportColumns(r)).not.toContain(bad);
      }
    }
  });

  it('puts the WORDS in the verbatim report and the SCORES in the scores report, and does not mix them', () => {
    expect(supportExportColumns('csat_verbatims')).toContain('comment');
    expect(supportExportColumns('csat_verbatims')).toContain('commentLanguage');
    // the plain CSAT report is for trend analysis and does not need anybody's free text
    expect(supportExportColumns('csat')).not.toContain('comment');
  });

  it('identifies an agent only by opaque id, and only where the report is about performance', () => {
    expect(supportExportColumns('csat')).toContain('agentUserId');
    // the verbatim file pairs somebody's words with nobody
    expect(supportExportColumns('csat_verbatims')).not.toContain('agentUserId');
  });

  it('NAMES the reviewer on the reviews report — the platform is accountable for its own verdicts', () => {
    // the asymmetry is deliberate: an anonymous judgement about somebody's work is what this wave refuses
    expect(supportExportColumns('csat_reviews')).toContain('reviewerAdminId');
    expect(supportExportColumns('csat_reviews')).toContain('finding');
  });

  it('flags which reports contain free text somebody wrote about themselves', () => {
    expect(containsVerbatim('csat_verbatims')).toBe(true);
    expect(containsVerbatim('csat_reviews')).toBe(true);      // a finding is free text too
    expect(containsVerbatim('csat')).toBe(false);
    expect(containsVerbatim('tickets')).toBe(false);
    expect(containsVerbatim('sla_breaches')).toBe(false);
  });
});

describe('honest columns', () => {
  it('exports ratedAtIsEstimated as a real column, not a footnote', () => {
    // 0099's backfill has no recorded rating time; a spreadsheet has no room for a caveat that lives only on a screen
    expect(supportExportColumns('csat')).toContain('ratedAtIsEstimated');
    expect(supportExportColumns('csat_verbatims')).toContain('ratedAtIsEstimated');
  });

  it('puts the TARGET beside the overrun on the breach report', () => {
    // a tenant may read this in an argument about a missed promise, and an overrun with no target is uncheckable
    const cols = supportExportColumns('sla_breaches');
    expect(cols).toContain('dueAt');
    expect(cols).toContain('overdueMinutes');
    expect(cols).toContain('breachKind');
  });
});

// ---------------------------------------------------------------------------
// THE COLUMN/ROW CONTRACT. These row shapes mirror exactly what the repository's
// mappers return (support-oversight.repository.ts, the export* methods).
// ---------------------------------------------------------------------------
const REPO_ROW_KEYS: Record<string, string[]> = {
  tickets: ['ticketNo', 'tenantSlug', 'severity', 'status', 'sla', 'createdAt', 'firstRespondedAt', 'resolvedAt'],
  sla_breaches: ['ticketNo', 'tenantSlug', 'severity', 'status', 'breachKind', 'dueAt', 'overdueMinutes', 'createdAt'],
  // exportCsat serves BOTH csat and csat_verbatims from one query, so its row is the union of the two column sets
  csat: ['ticketNo', 'tenantSlug', 'score', 'ratedAt', 'ratedAtIsEstimated', 'severity', 'agentUserId',
    'comment', 'commentLanguage', 'reviewCount', 'latestVerdict'],
  csat_verbatims: ['ticketNo', 'tenantSlug', 'score', 'ratedAt', 'ratedAtIsEstimated', 'severity', 'agentUserId',
    'comment', 'commentLanguage', 'reviewCount', 'latestVerdict'],
  csat_reviews: ['ticketNo', 'tenantSlug', 'score', 'verdict', 'finding', 'reviewerAdminId', 'reviewedAt', 'coachingCreated'],
};

describe('every declared column is actually produced by the repository', () => {
  it.each([...SUPPORT_EXPORT_REPORTS])('%s renders no empty column', (report) => {
    const declared = supportExportColumns(report);
    const produced = new Set(REPO_ROW_KEYS[report]);
    const missing = declared.filter((c) => !produced.has(c));
    // a declared column the query does not produce downloads as an empty column: header right, data gone
    expect(missing).toEqual([]);
  });
});

describe('CSV shaping is the SHARED implementation, not a second copy', () => {
  it('re-exports the billing guard rather than reimplementing it', () => {
    // one implementation of the injection defence in this realm, tested once, used twice — a second copy is how one of
    // them ends up missing the fix
    const billing = require('../../billing-ops/domain/billing-export');
    expect(csvCell).toBe(billing.csvCell);
    expect(toCsv).toBe(billing.toCsv);
  });

  it('defuses a formula a farmer could have typed into a comment', () => {
    // this is not hypothetical here: the verbatim column is free text a person wrote, and a support CSV is exactly the
    // file a desk lead opens in Excel
    expect(csvCell('=HYPERLINK("http://evil","refund status")')).toBe('"\'=HYPERLINK(""http://evil"",""refund status"")"');
    expect(csvCell('+91 users affected')).toBe("'+91 users affected");
    expect(csvCell('-500 rupees')).toBe("'-500 rupees");
    expect(csvCell('@channel')).toBe("'@channel");
  });

  it('keeps a multi-line comment from forging extra rows', () => {
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
  });

  it('renders an empty cell for a missing value, never the word null', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    // and a false is a real value, not a missing one
    expect(csvCell(false)).toBe('false');
    expect(csvCell(0)).toBe('0');
  });

  it('always writes a header, even with no rows', () => {
    // a file with no header is indistinguishable from a failed download
    const csv = toCsv(supportExportColumns('csat_verbatims'), []);
    expect(csv).toBe('ticketNo,tenantSlug,score,commentLanguage,comment,ratedAt,ratedAtIsEstimated');
  });

  it('emits columns in the DECLARED order regardless of key order in the row', () => {
    const csv = toCsv(supportExportColumns('csat_reviews'), [{
      coachingCreated: true, reviewedAt: '2026-08-05T10:00:00.000Z', reviewerAdminId: 'adm-1',
      finding: 'agent closed without answering', verdict: 'agent_at_fault', score: 1,
      tenantSlug: 'kolhapur-fpo', ticketNo: 'KV-T-88',
    }]);
    const [, row] = csv.split('\r\n');
    expect(row).toBe('KV-T-88,kolhapur-fpo,1,agent_at_fault,agent closed without answering,adm-1,2026-08-05T10:00:00.000Z,true');
  });
});

describe('the filename carries its own provenance', () => {
  it('embeds report, day and receipt id, matching the billing convention', () => {
    const name = supportExportFileName('csat_verbatims', '9f1c2b7a-1111-4222-8333-444455556666', '2026-08-06T11:22:33.000Z');
    expect(name).toBe('krishalaya-support-csat_verbatims-2026-08-06-9f1c2b7a.csv');
  });

  it('survives a junk receipt id and a junk timestamp without producing a broken filename', () => {
    const name = supportExportFileName('tickets', '///', 'not-a-date');
    expect(name).toMatch(/^krishalaya-support-tickets-\d{4}-\d{2}-\d{2}-receipt\.csv$/);
  });
});
