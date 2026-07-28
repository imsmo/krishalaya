// modules/payments/__tests__/document-pdf-badge.spec.ts · DEV-27 (Q23 billing badge) unit tests.
// No real Postgres/S3 — DocumentPdfService's collaborators (UoW, metrics, flags, media, repos,
// TenantService) are all mocked; TranslationService is real (trivial, no deps) so i18n KEY RESOLUTION
// is proven against the actual en/hi/gu bundles, not a stub. Structural PDF-content assertions mirror
// the existing gold-standard pattern in core/media/__tests__/pdf-and-exif.spec.ts (decode as latin1,
// assert the literal text is present in the content stream).
import { DocumentPdfService } from '../services/document-pdf.service';
import { TranslationService } from '../../../core/i18n/translation.service';
import { SettlementStatementRow } from '../repositories/settlement-statement.repository';

function makeService(overrides: { tenants?: any; flags?: any; media?: any; uow?: any } = {}) {
  const uow = overrides.uow ?? { run: jest.fn((_t: string, fn: any) => fn({})) };
  const metrics = { inc: jest.fn() };
  const flags = overrides.flags ?? { isEnabled: jest.fn().mockResolvedValue(true) };
  const media = overrides.media ?? { putGeneratedDocument: jest.fn().mockResolvedValue('media-1') };
  const statements: any = { setPdfMediaId: jest.fn() };
  const invoices: any = { setPdfMediaId: jest.fn(), findByOrder: jest.fn() };
  const i18n = new TranslationService();
  const tenants = overrides.tenants ?? { getMine: jest.fn().mockResolvedValue({ displayName: 'Anand FPO', legalName: 'Anand Farmers Producer Co Ltd' }) };
  const svc = new DocumentPdfService(uow as any, metrics as any, flags as any, media as any, statements, invoices, i18n, tenants as any);
  return { svc, uow, metrics, flags, media, statements, invoices, i18n, tenants };
}

const STATEMENT: SettlementStatementRow = {
  id: 'stmt-1', statementNo: 'STMT-2026-04-000001', sellerUserId: 'seller-1', periodStart: '2026-04-01', periodEnd: '2026-05-01',
  grossMinor: '1500000', commissionMinor: '52500', taxMinor: '12625', netMinor: '1434875', pdfMediaId: null, createdAt: new Date(),
};
const INVOICE = { invoiceNo: 'INV-2026-000123', orderId: 'order-1', totalMinor: '1000000', taxBreakup: { cgstMinor: '12500', sgstMinor: '12500', gstRateBps: 500 } };

describe('DocumentPdfService — Q23 billing badge (pure render, structural assertions)', () => {
  it('renderStatement: tenant brand name + platform badge appear in the header, before the body', () => {
    const { svc } = makeService();
    const bytes = svc.renderStatement(STATEMENT, { tenantName: 'Anand FPO', badgeText: 'Powered by Krishi Verse' });
    const text = bytes.toString('latin1');
    expect(text).toContain('Anand FPO');
    expect(text).toContain('Powered by Krishi Verse');
    // header lines precede the body content in the same content stream
    expect(text.indexOf('Anand FPO')).toBeLessThan(text.indexOf('Seller: seller-1'));
    expect(text.indexOf('Powered by Krishi Verse')).toBeLessThan(text.indexOf('Seller: seller-1'));
    // structural PDF validity untouched by the header addition
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('renderInvoice: same header law applied to trade invoices', () => {
    const { svc } = makeService();
    const bytes = svc.renderInvoice(INVOICE, { tenantName: 'Anand FPO', badgeText: 'Powered by Krishi Verse' });
    const text = bytes.toString('latin1');
    expect(text).toContain('Anand FPO');
    expect(text).toContain('Powered by Krishi Verse');
    expect(text.indexOf('Powered by Krishi Verse')).toBeLessThan(text.indexOf('Order: order-1'));
  });

  it('honest degrade (Law 12): unknown tenant name never fabricates a placeholder — badge still renders alone', () => {
    const { svc } = makeService();
    const bytes = svc.renderStatement(STATEMENT, { tenantName: null, badgeText: 'Powered by Krishi Verse' });
    const text = bytes.toString('latin1');
    expect(text).toContain('Powered by Krishi Verse');
    expect(text).not.toMatch(/Unknown|Tenant N\/A|Untitled/i);
  });

  it('badge value is never one without the other: brandHeaderLines never omits the platform badge, with or without a tenant name', () => {
    const { svc } = makeService();
    const withName = svc.renderStatement(STATEMENT, { tenantName: 'Anand FPO', badgeText: 'Powered by Krishi Verse' }).toString('latin1');
    const withoutName = svc.renderStatement(STATEMENT, { tenantName: null, badgeText: 'Powered by Krishi Verse' }).toString('latin1');
    expect(withName).toContain('Powered by Krishi Verse');
    expect(withoutName).toContain('Powered by Krishi Verse');
  });

  describe('storeStatementPdf / storeInvoicePdf — tenant-scoped resolution (Law 1) + honest degrade', () => {
    it('resolves the REAL tenant name via TenantService.getMine(tenantId) — never a client-supplied value', async () => {
      const tenants = { getMine: jest.fn().mockResolvedValue({ displayName: 'Anand FPO', legalName: 'Anand Farmers Producer Co Ltd' }) };
      const media = { putGeneratedDocument: jest.fn().mockResolvedValue('media-1') };
      const { svc } = makeService({ tenants, media });
      await svc.storeStatementPdf('tenant-abc', STATEMENT);
      expect(tenants.getMine).toHaveBeenCalledWith('tenant-abc');
      const pdfArg: Buffer = media.putGeneratedDocument.mock.calls[0][1];
      expect(pdfArg.toString('latin1')).toContain('Anand FPO');
    });

    it('degrades honestly when the tenant record is unreadable — omits the name, still stores a badge-bearing PDF', async () => {
      const tenants = { getMine: jest.fn().mockRejectedValue(new Error('tenant not found')) };
      const media = { putGeneratedDocument: jest.fn().mockResolvedValue('media-2') };
      const { svc } = makeService({ tenants, media });
      const mediaId = await svc.storeStatementPdf('tenant-missing', STATEMENT);
      expect(mediaId).toBe('media-2');
      const pdfArg: Buffer = media.putGeneratedDocument.mock.calls[0][1];
      const text = pdfArg.toString('latin1');
      expect(text).toContain('Powered by Krishi Verse');
      expect(text).not.toMatch(/Unknown|Tenant N\/A|Untitled/i);
    });

    it('flag OFF (default): renderer never runs, never touches media/tenant lookups (unaffected by this batch)', async () => {
      const flags = { isEnabled: jest.fn().mockResolvedValue(false) };
      const tenants = { getMine: jest.fn() };
      const media = { putGeneratedDocument: jest.fn() };
      const { svc } = makeService({ flags, tenants, media });
      const result = await svc.storeStatementPdf('tenant-abc', STATEMENT);
      expect(result).toBeNull();
      expect(tenants.getMine).not.toHaveBeenCalled();
      expect(media.putGeneratedDocument).not.toHaveBeenCalled();
    });
  });

  describe('i18n key resolution (Law 3) — doc.poweredByKrishiVerse across en/hi/gu', () => {
    it('resolves distinct, real strings per language from the actual bundles (not the literal key)', () => {
      const i18n = new TranslationService();
      const en = i18n.t('doc.poweredByKrishiVerse', 'en');
      const hi = i18n.t('doc.poweredByKrishiVerse', 'hi');
      const gu = i18n.t('doc.poweredByKrishiVerse', 'gu');
      expect(en).toBe('Powered by Krishi Verse');
      expect(hi).not.toBe('doc.poweredByKrishiVerse');
      expect(gu).not.toBe('doc.poweredByKrishiVerse');
      expect(hi).not.toBe(en);
      expect(gu).not.toBe(en);
      expect(hi).toContain('Krishi Verse');   // brand name kept in Latin script, sms.otp convention
      expect(gu).toContain('Krishi Verse');
    });

    it('an unregistered locale falls back to English (TranslationService\'s own degrade law)', () => {
      const i18n = new TranslationService();
      expect(i18n.t('doc.poweredByKrishiVerse', 'fr')).toBe('Powered by Krishi Verse');
    });

    it('this renderer\'s own WinAnsi-only constraint: hi/gu badge TEXT actually printed into the PDF stays', () => {
      // The badge PRINTED into this specific (Helvetica/WinAnsi-only) PDF generator always resolves to the
      // ASCII-safe EN string today, even when 'hi'/'gu' is requested — Devanagari/Gujarati would otherwise
      // become "?" mojibake (escapePdf's own drop-non-WinAnsi rule). Proven here via the public render path
      // rather than asserted from a private method, exercising the exact behavior a caller would see.
      const { svc } = makeService();
      const bytesHi = svc.renderStatement(STATEMENT, { tenantName: null, badgeText: 'Powered by Krishi Verse' });
      // this only proves the CALLER contract (badgeText is caller-supplied to the pure render); the
      // resolution/fallback itself is exercised end-to-end via storeStatementPdf below.
      expect(bytesHi.toString('latin1')).toContain('Powered by Krishi Verse');
    });

    it('storeStatementPdf(lang="hi"): resolves through TranslationService but the PDF byte stream carries the WinAnsi-safe EN fallback, never "?" mojibake', async () => {
      const media = { putGeneratedDocument: jest.fn().mockResolvedValue('media-3') };
      const { svc } = makeService({ media });
      await svc.storeStatementPdf('tenant-abc', STATEMENT, 'hi');
      const pdfArg: Buffer = media.putGeneratedDocument.mock.calls[0][1];
      const text = pdfArg.toString('latin1');
      expect(text).toContain('Powered by Krishi Verse');   // ASCII-safe fallback, not garbled Devanagari
      expect(text).not.toContain('?????');                  // the mojibake pattern this guard prevents
    });
  });
});
