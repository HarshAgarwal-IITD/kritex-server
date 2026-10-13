import type { AppConfigService } from '../../config/app-config.service';
import { SiteRebuildService } from './site-rebuild.service';

const configWith = (env: Record<string, unknown>) =>
  ({ get: (key: string) => env[key] }) as unknown as AppConfigService;

describe('SiteRebuildService', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;
  });
  afterEach(() => jest.useRealTimers());

  it('calls the deploy hook once, after the last of a burst of edits', async () => {
    const service = new SiteRebuildService(
      configWith({
        VERCEL_DEPLOY_HOOK_URL: 'https://api.vercel.com/hook',
        SITE_REBUILD_DELAY_SECONDS: 120,
      }),
    );
    service.schedule();
    await jest.advanceTimersByTimeAsync(60_000);
    service.schedule();
    await jest.advanceTimersByTimeAsync(119_000);
    expect(fetchMock).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.vercel.com/hook',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does nothing without a hook URL', async () => {
    const service = new SiteRebuildService(configWith({ SITE_REBUILD_DELAY_SECONDS: 0 }));
    service.schedule();
    await jest.runAllTimersAsync();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('survives a failing hook', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const service = new SiteRebuildService(
      configWith({
        VERCEL_DEPLOY_HOOK_URL: 'https://api.vercel.com/hook',
        SITE_REBUILD_DELAY_SECONDS: 0,
      }),
    );
    service.schedule();
    await expect(jest.runAllTimersAsync()).resolves.toBeUndefined();
  });
});
