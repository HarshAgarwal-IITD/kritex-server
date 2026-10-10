import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AuthService } from '../../auth/auth.service';
import { AppConfigService } from '../../config/app-config.service';
import { type SessionUser } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { REQUIRE_VERIFIED_EMAIL_KEY } from '../decorators/verified-email.decorator';
import type { Role } from '../dto/enums';
import { AppException } from '../exceptions/app.exception';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Matches Better Auth's session cookie (`better-auth.session_token`, `__Secure-` prefixed on https). */
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/;

/**
 * Global guard (ADR-004, AUTH-2). Every route needs a signed-in user unless it is `@Public()`;
 * `@Roles(...)` additionally restricts by role (and wins over `@Public()`), and
 * `@RequireVerifiedEmail()` requires a verified email.
 *
 * - The session user is attached to `req.user` on every route when a session cookie is present
 *   (public routes too, e.g. so the catalog can show B2B prices), and read via `@CurrentUser()`.
 * - CSRF (with SameSite=Lax): a mutating request that carries the session cookie must not come
 *   from a browser origin outside the CORS allowlist.
 *
 * Errors: 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 403 `EMAIL_NOT_VERIFIED`, 403 `INVALID_ORIGIN`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    config: AppConfigService,
  ) {
    this.allowedOrigins = new Set([...config.get('CORS_ORIGIN'), config.get('WEB_URL')]);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets);
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    // @RequireVerifiedEmail() on a method wins over @Public() on its class (like @Roles).
    const requireVerified = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRE_VERIFIED_EMAIL_KEY,
      targets,
    );

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: SessionUser }>();
    const hasSessionCookie = SESSION_COOKIE.test(req.headers.cookie ?? '');

    if (hasSessionCookie) {
      this.checkOrigin(req);
      const { user, setCookies } = await this.auth.getSession(req.headers);
      if (setCookies.length > 0) http.getResponse<Response>().append('Set-Cookie', setCookies);
      if (user) req.user = user;
    }

    if (isPublic && !roles && !requireVerified) return true;
    if (!req.user) {
      throw new AppException('UNAUTHORIZED', HttpStatus.UNAUTHORIZED, 'Sign in required');
    }
    if (roles && roles.length > 0 && !roles.includes(req.user.role)) {
      throw new AppException('FORBIDDEN', HttpStatus.FORBIDDEN, 'Not allowed for your role');
    }
    if (requireVerified && !req.user.emailVerified) {
      throw new AppException(
        'EMAIL_NOT_VERIFIED',
        HttpStatus.FORBIDDEN,
        'Verify your email address first',
      );
    }
    return true;
  }

  private checkOrigin(req: Request): void {
    if (SAFE_METHODS.has(req.method)) return;
    const origin = req.headers.origin;
    // Non-browser clients send no Origin; SameSite=Lax already keeps cross-site cookies off.
    if (!origin) return;
    if (!this.allowedOrigins.has(origin)) {
      throw new AppException('INVALID_ORIGIN', HttpStatus.FORBIDDEN, 'Origin not allowed');
    }
  }
}
