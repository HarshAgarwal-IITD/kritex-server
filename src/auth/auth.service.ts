import { Inject, Injectable } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import { fromNodeHeaders } from 'better-auth/node';
import { generateId } from 'better-auth';
import { type SessionUser } from '../common/decorators/current-user.decorator';
import { roleSchema } from '../common/dto/enums';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { staffInviteMessage } from './auth-emails';
import { type Auth, isBanned } from './auth.factory';
import { MailService } from './mail/mail.service';

/** DI token for the Better Auth instance. */
export const AUTH_INSTANCE = Symbol('AUTH_INSTANCE');

/** How long a staff invite (set-password) link stays valid. */
export const INVITE_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 3; // 3 days

export interface SessionLookup {
  user: SessionUser | null;
  /** `Set-Cookie` values Better Auth wants sent back (e.g. a refreshed session expiry). */
  setCookies: string[];
}

/** Nest-side facade over Better Auth: session lookup for the guard, plus admin helpers. */
@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_INSTANCE) readonly auth: Auth,
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: AppConfigService,
  ) {}

  /** Runs a fetch `Request` through Better Auth's router. */
  handler(request: Request): Promise<Response> {
    return this.auth.handler(request);
  }

  /** Resolves the session cookie in `headers` to the signed-in user (null if none/expired/disabled). */
  async getSession(headers: IncomingHttpHeaders): Promise<SessionLookup> {
    const { headers: responseHeaders, response } = await this.auth.api.getSession({
      headers: fromNodeHeaders(headers),
      returnHeaders: true,
    });
    const setCookies = responseHeaders.getSetCookie();
    if (!response) return { user: null, setCookies };

    const { user } = response;
    if (user.banned) {
      const ban = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { banned: true, banExpires: true },
      });
      if (!ban || isBanned(ban)) return { user: null, setCookies };
    }

    const role = roleSchema.safeParse(user.role);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: role.success ? role.data : 'CUSTOMER',
        emailVerified: user.emailVerified,
      },
      setCookies,
    };
  }

  /** Signs the user out everywhere. */
  async revokeSessions(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  /**
   * Emails a staff member a set-password link. Uses Better Auth's reset-password token format, so
   * the link goes through `GET /auth/reset-password/:token` → `${WEB_URL}/reset-password?token=…`
   * and `POST /auth/reset-password` creates the credential account.
   */
  async sendStaffInvite(user: { id: string; email: string; name: string }): Promise<void> {
    const context = await this.auth.$context;
    const token = generateId(24);
    await context.internalAdapter.createVerificationValue({
      identifier: `reset-password:${token}`,
      value: user.id,
      expiresAt: new Date(Date.now() + INVITE_EXPIRES_IN_SECONDS * 1000),
    });
    const callbackURL = encodeURIComponent(`${this.config.get('WEB_URL')}/reset-password`);
    const url = `${context.baseURL}/reset-password/${token}?callbackURL=${callbackURL}`;
    await this.mail.send(await staffInviteMessage(user.email, user.name, url));
  }
}
