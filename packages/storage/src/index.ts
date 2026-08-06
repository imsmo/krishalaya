// packages/storage/src/index.ts · object-storage primitives shared across services.
// Deliberately tiny: one presigner, no client, no config. Anything that needs credentials or a bucket name belongs in
// the calling app, so this package can never become a place where storage policy hides.
export { presignS3Url, type PresignInput } from './sigv4-presigner';
