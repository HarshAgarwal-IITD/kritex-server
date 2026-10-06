import { extname } from 'node:path';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../common/decorators/public.decorator';
import { AppException } from '../common/exceptions/app.exception';
import {
  LOCAL_UPLOADS_ROUTE,
  LocalDiskStorageDriver,
  UploadTooLargeError,
} from './storage/local-disk.driver';
import { STORAGE_DRIVER, type StorageDriver } from './storage/storage.driver';

const keyParamsSchema = z.object({
  folder: z.string().regex(/^[a-z0-9-]+$/),
  file: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/),
});
class KeyParamsDto extends createZodDto(keyParamsSchema) {}

const putQuerySchema = z.object({
  expires: z.coerce.number().int().positive(),
  size: z.coerce.number().int().positive(),
  sig: z.string().regex(/^[0-9a-f]{64}$/),
});
class PutQueryDto extends createZodDto(putQuerySchema) {}

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
};

/**
 * Target of the local driver's "presigned" URLs (CAT-6, dev only): `PUT` stores the bytes,
 * `GET` serves them. Authorised by the HMAC ticket, not a session, hence `@Public()`.
 * 404 unless STORAGE_DRIVER=local. Not part of the API contract.
 */
@ApiExcludeController()
@Public()
@Controller(LOCAL_UPLOADS_ROUTE)
export class LocalUploadsController {
  constructor(@Inject(STORAGE_DRIVER) private readonly storage: StorageDriver) {}

  @Put(':folder/:file')
  @HttpCode(200)
  async put(
    @Param() params: KeyParamsDto,
    @Query() query: PutQueryDto,
    @Req() req: Request,
  ): Promise<{ key: string; size: number }> {
    const driver = this.localDriver();
    const key = `${params.folder}/${params.file}`;
    const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim();
    if (!driver.verify(key, contentType, query.size, query.expires, query.sig)) {
      throw new AppException(
        'UPLOAD_TICKET_INVALID',
        HttpStatus.FORBIDDEN,
        'Upload URL is invalid or expired (check the Content-Type header)',
      );
    }
    try {
      const size = await driver.write(key, req, query.size);
      return { key, size };
    } catch (error) {
      if (error instanceof UploadTooLargeError) {
        throw new AppException('PAYLOAD_TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE, error.message);
      }
      throw error;
    }
  }

  @Get(':folder/:file')
  get(@Param() params: KeyParamsDto, @Res() res: Response): void {
    const driver = this.localDriver();
    const path = driver.pathFor(`${params.folder}/${params.file}`);
    if (!path) throw notFound();
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream');
    res.sendFile(path, { maxAge: '1h' }, (error) => {
      if (error && !res.headersSent) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
      }
    });
  }

  private localDriver(): LocalDiskStorageDriver {
    if (!(this.storage instanceof LocalDiskStorageDriver)) throw notFound();
    return this.storage;
  }
}

function notFound(): AppException {
  return new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'File not found');
}
