import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { tap, type Observable } from 'rxjs';
import { SiteRebuildService } from './site-rebuild.service';

/** On an admin catalog controller: every successful write queues a storefront rebuild (TD-38). */
@Injectable()
export class SiteRebuildInterceptor implements NestInterceptor {
  constructor(private readonly rebuild: SiteRebuildService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const { method } = context.switchToHttp().getRequest<Request>();
    if (method === 'GET' || method === 'HEAD') return next.handle();
    return next.handle().pipe(tap(() => this.rebuild.schedule()));
  }
}
