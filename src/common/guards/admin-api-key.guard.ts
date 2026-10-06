import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { AppConfigService } from '../../config/app-config.service';

/** Name of the OpenAPI security scheme registered in `buildOpenApiDocument`. */
export const ADMIN_API_KEY_SECURITY = 'adminApiKey';

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * TEMPORARY (Stage 0/1): protects admin routes with `Authorization: Bearer <ADMIN_API_KEY>`.
 * Replaced by Better Auth sessions + `@Roles('STAFF','ADMIN')` in Stage 2 (AUTH-2).
 */
@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

    // Hash both sides so timingSafeEqual gets equal-length buffers.
    if (!token || !timingSafeEqual(sha256(token), sha256(this.config.get('ADMIN_API_KEY')))) {
      throw new UnauthorizedException('Missing or invalid admin API key');
    }
    return true;
  }
}
