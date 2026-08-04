// @krishalaya/sdk-js · media resource (core/media). Two-step upload: requestUpload() returns a presigned PUT
// ticket → the HOST uploads the raw bytes to ticket.uploadUrl (S3, NOT the API; the SDK never proxies file
// bytes) → confirmUpload() records size + sha256 (+image dims). Downloads are presigned + only for clean assets.
// Both POSTs are mutations and accept an Idempotency-Key (Law 3) so a retry/replay can't create duplicate assets.
import { HttpClient } from '../http';
import { MediaKind, MediaUploadTicket, MediaConfirmResult, MediaDownloadLink } from '../types';

export class MediaResource {
  constructor(private readonly http: HttpClient) {}

  /** Step 1: ask the API for a presigned PUT URL for a file of this kind/mime/size. */
  async requestUpload(input: { kind: MediaKind; mimeType: string; declaredBytes: number }, idempotencyKey: string): Promise<MediaUploadTicket> {
    return (await this.http.request<MediaUploadTicket>('POST', 'media/upload-url', { idempotencyKey, body: input })).data;
  }

  /** Step 3 (after the client PUTs the bytes to ticket.uploadUrl): confirm real size + sha256 (+dims). */
  async confirmUpload(mediaId: string, input: { bytes: number; sha256: string; width?: number; height?: number }, idempotencyKey: string): Promise<MediaConfirmResult> {
    return (await this.http.request<MediaConfirmResult>('POST', `media/${encodeURIComponent(mediaId)}/confirm`, { idempotencyKey, body: input })).data;
  }

  /** Presigned GET for a clean, visible asset (404/typed error otherwise). */
  async downloadUrl(mediaId: string, signal?: AbortSignal): Promise<MediaDownloadLink> {
    return (await this.http.request<MediaDownloadLink>('GET', `media/${encodeURIComponent(mediaId)}/download-url`, { signal })).data;
  }
}
