import type { Logger } from '@nestjs/common';

/**
 * Fire-and-forget work started by event listeners (emails, invoice PDFs), so a slow provider never
 * delays the request that emitted the event. Failures are logged, never thrown. `drain()` waits for
 * everything in flight (tests, shutdown).
 */
export class BackgroundTasks {
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly logger: Logger) {}

  run(label: string, work: () => Promise<unknown>): void {
    const task: Promise<void> = (async () => {
      try {
        await work();
      } catch (err) {
        this.logger.error({ err: (err as Error).message, task: label }, `${label} failed`);
      }
    })().finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }
}
