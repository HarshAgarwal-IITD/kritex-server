import { All, Controller, Post, type RawBodyRequest, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';

const MINUTE = 60_000;
/** Per-IP limits. Credential guessing and email-sending endpoints get the tightest ones. */
const SIGN_IN = { default: { limit: 10, ttl: MINUTE } };
const SENDS_EMAIL = { default: { limit: 5, ttl: MINUTE } };
const VERIFY_CODE = { default: { limit: 10, ttl: MINUTE } };
const OTHER = { default: { limit: 60, ttl: MINUTE } };

/** Hop-by-hop / length headers that must not be copied onto a re-built request or response. */
const SKIP_REQUEST_HEADERS = new Set(['content-length', 'transfer-encoding', 'connection']);
const SKIP_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'content-length',
  'transfer-encoding',
  'connection',
]);

/**
 * Mounts Better Auth at `/api/v1/auth/*` (not in the OpenAPI document; see its description).
 *
 * Better Auth runs as a fetch handler behind a Nest controller rather than as raw Express
 * middleware, so the global body parser can stay on (the request is rebuilt from `req.rawBody`),
 * and the Nest throttler, request logging and helmet headers apply to auth routes too. Responses
 * (status, JSON body `{ code, message }` on errors, `Set-Cookie`, redirects) are passed through
 * unchanged so the `better-auth` client SDK works as documented.
 */
@ApiExcludeController()
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post(['sign-in/email', 'sign-in/email-otp'])
  @Throttle(SIGN_IN)
  signIn(@Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    return this.forward(req, res);
  }

  @Post([
    'sign-up/email',
    'send-verification-email',
    'request-password-reset',
    'email-otp/send-verification-otp',
    'email-otp/request-password-reset',
    'forget-password/email-otp',
    'email-otp/request-email-change',
  ])
  @Throttle(SENDS_EMAIL)
  sendsEmail(@Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    return this.forward(req, res);
  }

  @Post([
    'reset-password',
    'email-otp/verify-email',
    'email-otp/check-verification-otp',
    'email-otp/reset-password',
    'email-otp/change-email',
    'change-password',
  ])
  @Throttle(VERIFY_CODE)
  verifyCode(@Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    return this.forward(req, res);
  }

  @All('*path')
  @Throttle(OTHER)
  other(@Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    return this.forward(req, res);
  }

  private async forward(req: RawBodyRequest<Request>, res: Response): Promise<void> {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined || SKIP_REQUEST_HEADERS.has(name)) continue;
      for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
    }

    let body: Uint8Array | string | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.rawBody && req.rawBody.length > 0) {
        body = new Uint8Array(req.rawBody);
      } else if (req.body !== undefined && req.body !== null && typeof req.body === 'object') {
        body = JSON.stringify(req.body);
        headers.set('content-type', 'application/json');
      }
    }

    const url = new URL(req.originalUrl, `${req.protocol}://${req.get('host') ?? 'localhost'}`);
    const response = await this.auth.handler(
      new Request(url, { method: req.method, headers, body }),
    );

    res.status(response.status);
    response.headers.forEach((value, name) => {
      if (!SKIP_RESPONSE_HEADERS.has(name)) res.setHeader(name, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) res.setHeader('set-cookie', cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  }
}
