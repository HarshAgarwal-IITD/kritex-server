import { presignUrl } from './sigv4';
import type { PresignUploadInput, PresignedUpload, StorageDriver } from './storage.driver';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Public bucket URL (custom domain / r2.dev), no trailing slash needed. */
  publicUrl: string;
}

/** Cloudflare R2 (S3 API): presigned PUT straight from the browser to the bucket. */
export class R2StorageDriver implements StorageDriver {
  readonly name = 'r2' as const;

  constructor(
    private readonly config: R2Config,
    private readonly now: () => Date = () => new Date(),
  ) {}

  presignUpload(input: PresignUploadInput): PresignedUpload {
    const signedAt = this.now();
    const expiresIn = Math.max(
      1,
      Math.round((input.expiresAt.getTime() - signedAt.getTime()) / 1000),
    );
    const headers = { 'Content-Type': input.contentType };
    const uploadUrl = presignUrl({
      method: 'PUT',
      host: `${this.config.accountId}.r2.cloudflarestorage.com`,
      path: `/${this.config.bucket}/${input.key}`,
      region: 'auto',
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      date: signedAt,
      expiresIn,
      headers,
    });
    return {
      uploadUrl,
      headers,
      publicUrl: `${this.config.publicUrl.replace(/\/+$/, '')}/${input.key}`,
    };
  }
}
