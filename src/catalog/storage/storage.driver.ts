/** Object storage behind `POST /admin/uploads` (CAT-6). Injected with the `STORAGE_DRIVER` token. */
export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

/** How long an upload ticket stays valid. */
export const UPLOAD_TTL_SECONDS = 15 * 60;

export interface PresignUploadInput {
  /** Object key, e.g. `products/2f0c…-combat-shirt.jpg`. */
  key: string;
  contentType: string;
  /** Declared size in bytes (the local driver enforces it; R2 relies on the client). */
  size: number;
  expiresAt: Date;
}

export interface PresignedUpload {
  uploadUrl: string;
  headers: Record<string, string>;
  publicUrl: string;
}

export interface StorageDriver {
  readonly name: 'local' | 'r2';
  presignUpload(input: PresignUploadInput): PresignedUpload;
}
