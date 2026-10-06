import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthService } from '../../auth/auth.service';
import type { AppConfigService } from '../../config/app-config.service';
import type { SessionUser } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import { AuthGuard } from './auth.guard';

class Routes {
  @Public()
  open() {}

  @Roles('STAFF', 'ADMIN')
  admin() {}

  plain() {}
}

@Public()
class PublicController {
  @Roles('ADMIN')
  adminOnly() {}

  open() {}
}

const COOKIE = 'better-auth.session_token=abc.def';
const user = (role: SessionUser['role']): SessionUser => ({
  id: 'u1',
  email: 'a@b.co',
  name: 'A',
  role,
  emailVerified: true,
});

function setup(sessionUser: SessionUser | null, setCookies: string[] = []) {
  const auth = { getSession: jest.fn().mockResolvedValue({ user: sessionUser, setCookies }) };
  const config = {
    get: (key: string) =>
      key === 'CORS_ORIGIN' ? ['http://localhost:8080'] : 'http://localhost:8080',
  };
  const guard = new AuthGuard(
    new Reflector(),
    auth as unknown as AuthService,
    config as unknown as AppConfigService,
  );
  return { guard, auth };
}

function context(
  cls: object,
  handler: string,
  req: { method?: string; headers?: Record<string, string> } = {},
) {
  const request: Record<string, unknown> = {
    method: req.method ?? 'GET',
    headers: req.headers ?? {},
  };
  const response = { append: jest.fn() };
  const ctx = {
    getType: () => 'http',
    getHandler: () => (cls as { prototype: Record<string, unknown> }).prototype[handler],
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
  return { ctx, request, response };
}

describe('AuthGuard', () => {
  it('allows @Public() routes without a session and does not look one up', async () => {
    const { guard, auth } = setup(null);
    await expect(guard.canActivate(context(Routes, 'open').ctx)).resolves.toBe(true);
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it('attaches the user on public routes when a session cookie is present', async () => {
    const { guard } = setup(user('B2B_CUSTOMER'), ['better-auth.session_token=new']);
    const { ctx, request, response } = context(Routes, 'open', { headers: { cookie: COOKIE } });
    await guard.canActivate(ctx);
    expect(request.user).toEqual(user('B2B_CUSTOMER'));
    expect(response.append).toHaveBeenCalledWith('Set-Cookie', ['better-auth.session_token=new']);
  });

  it('denies undecorated routes without a session (401 UNAUTHORIZED)', async () => {
    const { guard } = setup(null);
    await expect(guard.canActivate(context(Routes, 'plain').ctx)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    });
    await expect(
      guard.canActivate(context(Routes, 'plain', { headers: { cookie: COOKIE } }).ctx),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('allows any signed-in user on undecorated routes', async () => {
    const { guard } = setup(user('CUSTOMER'));
    await expect(
      guard.canActivate(context(Routes, 'plain', { headers: { cookie: COOKIE } }).ctx),
    ).resolves.toBe(true);
  });

  it.each([
    ['CUSTOMER', false],
    ['B2B_CUSTOMER', false],
    ['STAFF', true],
    ['ADMIN', true],
  ] as const)('@Roles(STAFF, ADMIN) with %s → allowed=%s', async (role, allowed) => {
    const { guard } = setup(user(role));
    const result = guard.canActivate(context(Routes, 'admin', { headers: { cookie: COOKIE } }).ctx);
    if (allowed) await expect(result).resolves.toBe(true);
    else await expect(result).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('@Roles() on a method wins over @Public() on the class', async () => {
    const { guard } = setup(null);
    await expect(
      guard.canActivate(context(PublicController, 'adminOnly').ctx),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(guard.canActivate(context(PublicController, 'open').ctx)).resolves.toBe(true);
  });

  it('rejects cookie-authenticated mutations from a foreign Origin (CSRF)', async () => {
    const { guard } = setup(user('CUSTOMER'));
    const post = (origin?: string) =>
      guard.canActivate(
        context(Routes, 'plain', {
          method: 'POST',
          headers: { cookie: COOKIE, ...(origin && { origin }) },
        }).ctx,
      );
    await expect(post('https://evil.example')).rejects.toMatchObject({ code: 'INVALID_ORIGIN' });
    await expect(post('http://localhost:8080')).resolves.toBe(true);
    await expect(post()).resolves.toBe(true); // non-browser client
  });
});
