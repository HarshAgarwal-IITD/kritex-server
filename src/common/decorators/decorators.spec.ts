import { type ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { CurrentUser, type SessionUser } from './current-user.decorator';
import { IS_PUBLIC_KEY, Public } from './public.decorator';
import { ROLES_KEY, Roles } from './roles.decorator';

class TestController {
  @Public()
  open() {}

  @Roles('STAFF', 'ADMIN')
  admin() {}

  me(@CurrentUser() _user: SessionUser | undefined) {}
}

@Roles('ADMIN')
class AdminOnlyController {}

function currentUserFactory() {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestController, 'me') as Record<
    string,
    { factory: (data: unknown, ctx: ExecutionContext) => unknown }
  >;
  return Object.values(args)[0].factory;
}

const contextWith = (user?: SessionUser) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;

describe('auth decorators', () => {
  const reflector = new Reflector();

  it('@Public() sets isPublic metadata', () => {
    expect(reflector.get(IS_PUBLIC_KEY, TestController.prototype.open)).toBe(true);
    expect(reflector.get(IS_PUBLIC_KEY, TestController.prototype.admin)).toBeUndefined();
  });

  it('@Roles() sets roles metadata on methods and classes', () => {
    expect(reflector.get(ROLES_KEY, TestController.prototype.admin)).toEqual(['STAFF', 'ADMIN']);
    expect(reflector.get(ROLES_KEY, AdminOnlyController)).toEqual(['ADMIN']);
  });

  it('@CurrentUser() returns req.user, or undefined when anonymous', () => {
    const user: SessionUser = {
      id: 'u1',
      email: 'a@b.co',
      name: 'A',
      role: 'CUSTOMER',
      emailVerified: true,
    };
    const factory = currentUserFactory();
    expect(factory(undefined, contextWith(user))).toBe(user);
    expect(factory(undefined, contextWith())).toBeUndefined();
  });
});
