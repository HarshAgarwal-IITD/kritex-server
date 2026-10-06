import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { AppConfigService } from '../../config/app-config.service';
import { AdminApiKeyGuard } from './admin-api-key.guard';

const contextWith = (authorization?: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  }) as unknown as ExecutionContext;

describe('AdminApiKeyGuard', () => {
  const config = { get: jest.fn().mockReturnValue('s3cret-key') } as unknown as AppConfigService;
  const guard = new AdminApiKeyGuard(config);

  it('allows a matching bearer token', () => {
    expect(guard.canActivate(contextWith('Bearer s3cret-key'))).toBe(true);
  });

  it.each([
    ['no header', undefined],
    ['wrong key', 'Bearer nope'],
    ['missing Bearer prefix', 's3cret-key'],
    ['wrong scheme', 'Basic s3cret-key'],
    ['empty token', 'Bearer '],
    ['key prefix only', 'Bearer s3cret'],
  ])('rejects %s', (_label, header) => {
    expect(() => guard.canActivate(contextWith(header))).toThrow(UnauthorizedException);
  });
});
