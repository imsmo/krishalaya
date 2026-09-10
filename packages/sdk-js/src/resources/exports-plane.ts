// @krishalaya/sdk-js · the tenant EXPORT PLANE (PC-56 TENANT-6e-2 · W2553 queued, W2554 ready).
//
// Three shared routes every dataset's export lands on; the ENQUEUE lives with each dataset (see `dairy.enqueueInsightsExport`)
// because the permission and the flag that gate an export are the ones that gate the screen it is an export of.
//
// **Read `status` first.** `queued` carries `standing` (position, and an ETA that is an estimate or `no_history`); `ready`
// carries the receipt, the fetch counts and an `available` download; `expired` keeps the receipt and says the file is
// gone; `failed` carries a code. The page never has to guess which state it is drawing.
import { HttpClient } from '../http';
import { ExportJob, ExportMintedLink } from '../types';

export class ExportsPlaneResource {
  constructor(private readonly http: HttpClient) {}

  /** W2553 / W2554 in one read. 404 for a job the caller's tenant does not own; 403 for a member without the dataset's verb. */
  async get(id: string, signal?: AbortSignal): Promise<ExportJob> {
    return (await this.http.request<ExportJob>('GET', `exports/${encodeURIComponent(id)}`, { signal })).data;
  }

  /** *"Download (link valid 15 min)"*: mints the signed link and audits the mint with its jti. Refused unless the file is
   *  ready and still within retention (`EXPORT_NOT_READY` / `EXPORT_FILE_EXPIRED`). */
  async mintLink(id: string): Promise<ExportMintedLink> {
    return (await this.http.request<ExportMintedLink>('POST', `exports/${encodeURIComponent(id)}/link`, {})).data;
  }

  /**
   * THE BYTES. Presents the link beside the session and hands back the raw `Response` to stream — the console's route
   * handler pipes it to the browser. Every attempt is logged server-side, refused ones included; a refusal arrives as
   * an `SdkError` whose `details.outcome` names it (`refused_expired`, `refused_wrong_job`, …).
   */
  async openDownload(id: string, token: string, signal?: AbortSignal): Promise<Response> {
    return this.http.requestRaw('GET', `exports/${encodeURIComponent(id)}/download`, { query: { token }, signal });
  }
}
