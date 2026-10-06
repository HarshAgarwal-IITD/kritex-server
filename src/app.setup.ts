import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { SESSION_COOKIE_NAME, SESSION_SECURITY } from './common/decorators/session-auth';
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

const API_DESCRIPTION = [
  'Kritex ecommerce API. Errors always use `{ "error": { "code", "message", "details"? } }`.',
  'Money is integer paise; prices are GST-inclusive. Lists are `{ items }`, paginated lists `{ items, page, limit, total }`.',
  '',
  '**Auth** (Better Auth, mounted at `/api/v1/auth/*`, not described in this document): ' +
    '`POST /auth/sign-up/email`, `POST /auth/sign-in/email`, `POST /auth/sign-out`, `GET /auth/get-session`, ' +
    '`GET /auth/verify-email`, `POST /auth/send-verification-email`, `POST /auth/forget-password`, `POST /auth/reset-password`, ' +
    '`POST /auth/email-otp/send-verification-otp`, `POST /auth/email-otp/verify-email`, `POST /auth/sign-in/email-otp`. ' +
    'Use the `better-auth` client SDK against these. Signing in sets the `session` cookie used by every non-public route.',
].join('\n');

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('Kritex API')
    .setDescription(API_DESCRIPTION)
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
    .addCookieAuth(
      SESSION_COOKIE_NAME,
      {
        type: 'apiKey',
        in: 'cookie',
        name: SESSION_COOKIE_NAME,
        description:
          'Better Auth session cookie (httpOnly; `__Secure-` prefixed over HTTPS). Set by /api/v1/auth/sign-in/*; send requests with credentials.',
      },
      SESSION_SECURITY,
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
