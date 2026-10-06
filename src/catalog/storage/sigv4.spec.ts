import { presignUrl, uriEncode } from './sigv4';

describe('presignUrl (SigV4 query signing)', () => {
  // AWS documentation example: "Authenticating Requests: Using Query Parameters (AWS Signature Version 4)".
  it('matches the AWS reference presigned GET', () => {
    const url = presignUrl({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      date: new Date('2013-05-24T00:00:00Z'),
      expiresIn: 86400,
    });
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('signs extra headers (sorted, lower-cased) and encodes the path per segment', () => {
    const url = new URL(
      presignUrl({
        method: 'PUT',
        host: 'acct.r2.cloudflarestorage.com',
        path: '/bucket/products/a b.jpg',
        region: 'auto',
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
        date: new Date('2026-10-07T10:00:00Z'),
        expiresIn: 900,
        headers: { 'Content-Type': 'image/jpeg' },
      }),
    );
    expect(url.pathname).toBe('/bucket/products/a%20b.jpg');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(url.searchParams.get('X-Amz-Credential')).toBe('AK/20261007/auto/s3/aws4_request');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uriEncode escapes RFC 3986 reserved characters', () => {
    expect(uriEncode("a b!'()*/~")).toBe('a%20b%21%27%28%29%2A%2F~');
  });
});
