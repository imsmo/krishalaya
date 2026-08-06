// apps/admin-api/src/modules/billing-ops/services/invoice-pdf.service.ts · hand an operator the PDF of a SaaS
// invoice (PC-56 ADMIN-1c, closes ADMIN-1-Q2).
//
// THE ROUTE TAKES AN INVOICE ID, NEVER AN OBJECT KEY. The key is resolved from the invoice's own `pdf_media_id` by a
// join. A route that accepted a key — even "just for admins" — is an arbitrary-object-read endpoint with a friendly
// name, and this realm can read every tenant's data by design (Law 11), so the blast radius would be the whole bucket.
//
// A DOWNLOAD IS AUDITED. Reading a tenant's tax document is an event about a real business, not a page view: the audit
// row records who minted the link and for which invoice. This is why the service exists rather than the console
// presigning for itself — the audit trail cannot live in a React component.
//
// THE LINK IS DELIBERATELY SHORT-LIVED (the configured window, 120s by default). A download URL for a tax document
// that survives an hour is a URL that gets pasted into a chat thread and forwarded; this one expires before the
// operator has finished explaining it. Nothing about the URL is stored: it is minted per click.
import { Injectable } from '@nestjs/common';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { AdminObjectStore } from '../../../core/media/admin-object-store';
import { MediaAssetMissingError } from '../../../core/media/media.errors';
import { BillingRepository } from '../repositories/billing.repository';
import { SaasInvoiceNotFoundError } from '../domain/billing-ops.errors';

@Injectable()
export class InvoicePdfService {
  constructor(
    private readonly audit: AdminAuditWriter,
    private readonly store: AdminObjectStore,
    private readonly repo: BillingRepository,
  ) {}

  /** Mint a time-limited download URL for one invoice's PDF.
   *  • unknown invoice → 404 (SaasInvoiceNotFoundError)
   *  • invoice exists but no PDF yet → 404 with a DISTINCT code, because "not generated yet" and "no such invoice"
   *    are different facts to somebody waiting on a document
   *  • storage unconfigured → 503 from the store (the capability is absent, nothing is broken) */
  async downloadUrl(actor: AdminRequestContext, invoiceId: string) {
    const invoice = await this.repo.getInvoice(invoiceId);
    if (!invoice) throw new SaasInvoiceNotFoundError(invoiceId);

    const asset = await this.repo.invoicePdfAsset(invoiceId);
    if (!asset) throw new MediaAssetMissingError(`invoice ${invoiceId} pdf`);

    const url = this.store.presignDownload(asset.s3Key);

    // Audited OUTSIDE a write transaction: there is no state change to bind it to, and the read must not be
    // rollback-able — the fact that a link was minted is true whether or not the operator clicks it.
    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'billing.invoice_pdf_downloaded', entityType: 'saas_invoice', entityId: invoiceId,
      // the URL itself is NEVER recorded: it is a bearer credential for the object, and an audit log is read by more
      // people than the operator who triggered it
      newValue: { mediaId: asset.mediaId, invoiceNo: asset.invoiceNo, expiresInSec: this.store.expirySec },
      reason: `invoice PDF link minted for ${asset.invoiceNo}`,
      ip: actor.ip, requestId: actor.requestId || null,
    });

    return {
      url,
      expiresInSec: this.store.expirySec,
      // a stable, human filename built from the invoice NUMBER — what appears on the document and in the tenant's
      // records, never the uuid
      fileName: `${asset.invoiceNo.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`,
      mimeType: asset.mimeType,
      bytes: asset.bytes,
    };
  }

  /** Whether this deploy can serve downloads at all — so the console can say "not available here" rather than
   *  rendering a button that 503s. */
  get available(): boolean { return this.store.configured; }
}
