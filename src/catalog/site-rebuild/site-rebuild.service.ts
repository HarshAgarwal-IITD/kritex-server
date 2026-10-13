import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';

/**
 * TD-38: the storefront prerenders catalog pages at build time, so their HTML shows the catalog as of
 * the last deploy until the page refetches. After admin catalog edits, call the Vercel deploy hook
 * (VERCEL_DEPLOY_HOOK_URL) once things go quiet, so a burst of edits costs one rebuild. Unset = off.
 */
@Injectable()
export class SiteRebuildService implements OnModuleDestroy {
  private readonly logger = new Logger(SiteRebuildService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly config: AppConfigService) {}

  /** Queue a rebuild; another call before it fires pushes it back. */
  schedule(): void {
    const url = this.config.get('VERCEL_DEPLOY_HOOK_URL');
    if (!url) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.trigger(url);
      },
      this.config.get('SITE_REBUILD_DELAY_SECONDS') * 1000,
    );
    this.timer.unref();
  }

  private async trigger(url: string): Promise<void> {
    try {
      const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`deploy hook answered ${res.status}`);
      this.logger.log('Storefront rebuild requested after catalog changes');
    } catch (e) {
      this.logger.warn(
        `Storefront rebuild request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}
