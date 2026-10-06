import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature V4 query-string presigning (S3-compatible: Cloudflare R2 uses region "auto").
 * Hand-rolled to avoid pulling in the AWS SDK for one function. The body is not signed
 * (`UNSIGNED-PAYLOAD`); every header in `headers` is signed and must be sent unchanged.
 */
export interface PresignInput {
  method: 'GET' | 'PUT';
  /** e.g. `<account>.r2.cloudflarestorage.com` */
  host: string;
  /** Path starting with `/`, unencoded (e.g. `/bucket/products/a b.jpg`). */
  path: string;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Signing time. */
  date: Date;
  /** Seconds, 1..604800. */
  expiresIn: number;
  /** Extra headers to sign (host is always signed). */
  headers?: Record<string, string>;
}

/** RFC 3986 encoding as SigV4 requires (encodeURIComponent leaves !'()* alone). */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

const sha256Hex = (data: string) => createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data, 'utf8').digest();

/** Returns the full presigned URL (https). */
export function presignUrl(input: PresignInput): string {
  const service = input.service ?? 's3';
  const amzDate = input.date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`;

  const headers: Record<string, string> = { host: input.host };
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    headers[name.toLowerCase()] = value.trim();
  }
  const headerNames = Object.keys(headers).sort();
  const signedHeaders = headerNames.join(';');

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(input.expiresIn),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((key) => `${uriEncode(key)}=${uriEncode(query[key])}`)
    .join('&');
  const canonicalUri = input.path.split('/').map(uriEncode).join('/');
  const canonicalHeaders = headerNames.map((name) => `${name}:${headers[name]}\n`).join('');

  const canonicalRequest = [
    input.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), service),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return `https://${input.host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
