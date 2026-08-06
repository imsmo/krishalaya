// packages/storage/src/sigv4-presigner.ts
// Self-contained AWS Signature V4 query-string presigner (no AWS SDK dependency — deterministic
// crypto, fully unit-testable). Produces a time-limited URL the client uses to PUT/GET an object
// directly against S3 (or MinIO/LocalStack via endpoint+path-style). The payload is UNSIGNED-PAYLOAD
// (S3 standard for presigned URLs). Credentials are never placed in logs.
//
// WHY THIS LIVES IN A PACKAGE (PC-56 ADMIN-1c, closes ADMIN-1-Q2). It began inside apps/api. When admin-api needed to
// hand a platform operator the PDF of a SaaS invoice, the cheap path was to copy this file across — and that would
// have left the monorepo with TWO implementations of URL signing: two places to fix when a signing bug is found, two
// places for an expiry default to drift, and one of them inevitably the stale one. Signing code is exactly the kind
// of code that must exist once. So it moved here (git mv, so the history that explains each line came with it) and
// both apps import it.
//
// It stays dependency-free and pure: no config, no env, no logging, no I/O. Callers supply credentials and an expiry;
// this returns a string. That is what makes it testable against the AWS worked examples and safe to share.
import { createHash, createHmac } from 'node:crypto';

export interface PresignInput {
  method: 'PUT' | 'GET';
  region: string;
  bucket: string;
  key: string;                 // object key (path within the bucket); slashes preserved
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;       // for STS/IAM-role temporary creds
  endpoint?: string | null;    // e.g. http://minio:9000 ; absent ⇒ AWS virtual-hosted
  forcePathStyle?: boolean;    // MinIO/LocalStack
  expiresSec: number;
  now?: Date;
}

const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
// S3 keys: encode each path segment but keep the '/' separators.
const encodeKey = (key: string) => key.split('/').map(enc).join('/');
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();

function amzDate(d: Date): { amz: string; date: string } {
  const amz = d.toISOString().replace(/[:-]|\.\d{3}/g, '');   // YYYYMMDDTHHMMSSZ
  return { amz, date: amz.slice(0, 8) };
}

/** Build a presigned S3 URL. Returns the full https/http URL with the V4 query signature. */
export function presignS3Url(input: PresignInput): string {
  const now = input.now ?? new Date();
  const { amz, date } = amzDate(now);
  const service = 's3';
  const scope = `${date}/${input.region}/${service}/aws4_request`;

  // host + path (virtual-hosted by default; path-style for MinIO or when forced)
  let host: string; let basePath: string;
  if (input.endpoint) {
    const u = new URL(input.endpoint);
    host = u.host;
    basePath = input.forcePathStyle ? `/${input.bucket}/${encodeKey(input.key)}` : `/${encodeKey(input.key)}`;
    if (!input.forcePathStyle) host = `${input.bucket}.${u.host}`;
  } else if (input.forcePathStyle) {
    host = `s3.${input.region}.amazonaws.com`;
    basePath = `/${input.bucket}/${encodeKey(input.key)}`;
  } else {
    host = `${input.bucket}.s3.${input.region}.amazonaws.com`;
    basePath = `/${encodeKey(input.key)}`;
  }
  const protocol = input.endpoint ? new URL(input.endpoint).protocol : 'https:';

  const signedHeaders = 'host';
  const q: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKeyId}/${scope}`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': String(input.expiresSec),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  if (input.sessionToken) q['X-Amz-Security-Token'] = input.sessionToken;

  const canonicalQuery = Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k])}`).join('&');
  const canonicalRequest = [input.method, basePath, canonicalQuery, `host:${host}\n`, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, sha256hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${input.secretAccessKey}`, date);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return `${protocol}//${host}${basePath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
