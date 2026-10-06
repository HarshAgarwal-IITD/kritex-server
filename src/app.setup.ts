import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { ADMIN_API_KEY_SECURITY } from './common/guards/admin-api-key.guard';
import { AppConfigService } from './config/app-config.service';

export const GLOBAL_PREFIX = 'api/v1';
export const DOCS_PATH = 'api/docs';
export const DOCS_JSON_PATH = 'api/docs-json';

/**
 * HTTP-level setup shared by `main.ts`, the e2e tests and the OpenAPI export,
 * so all three see the same routes.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfigService);

  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGIN'),
    credentials: true,
  });
  app.enableShutdownHooks();
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('Kritex API')
    .setDescription(
      'Kritex ecommerce API. Errors always use `{ "error": { "code", "message", "details"? } }`.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'API key',
        description: 'Temporary admin API key (until Stage 2 auth)',
      },
      ADMIN_API_KEY_SECURITY,
    )
    .build();

  const document = SwaggerModule.createDocument(app, builder);
  return cleanupOpenApiDoc(document);
}

export function setupSwagger(app: INestApplication): void {
  // Built eagerly so a broken schema fails at boot rather than on first docs request.
  SwaggerModule.setup(DOCS_PATH, app, buildOpenApiDocument(app), {
    jsonDocumentUrl: DOCS_JSON_PATH,
  });
}
