import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { SESSION_COOKIE_NAME, SESSION_SECURITY } from './common/decorators/session-auth';
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
  '**Auth** (Better Auth 1.7, mounted at `/api/v1/auth/*`, not described as operations here). ' +
    'Use the `better-auth` client SDK (`createAuthClient({ baseURL: <origin>, basePath: "/api/v1/auth", plugins: [emailOTPClient()] })`) ' +
    'with `credentials: "include"`. These routes answer in Better Auth\'s own shape: errors are `{ "code", "message" }` ' +
    '(e.g. `EMAIL_NOT_VERIFIED`, `INVALID_EMAIL_OR_PASSWORD`, `ACCOUNT_DISABLED`); throttled requests get the standard 429 error.',
  '- Email + password: `POST /auth/sign-up/email` `{ name, email, password, callbackURL? }` (sends a verification link; no session until verified), ' +
    '`POST /auth/sign-in/email` `{ email, password, rememberMe? }`, `POST /auth/sign-out`, `GET /auth/get-session`.',
  '- Email verification: `GET /auth/verify-email?token=&callbackURL=` (the emailed link; signs the user in), ' +
    '`POST /auth/send-verification-email` `{ email, callbackURL? }`.',
  '- Password reset: `POST /auth/request-password-reset` `{ email, redirectTo }` → emailed link → `GET /auth/reset-password/:token` ' +
    'redirects to `redirectTo?token=…` → `POST /auth/reset-password` `{ token, newPassword }` (revokes other sessions).',
  '- Email OTP (6 digits, 5 min, 3 attempts): `POST /auth/email-otp/send-verification-otp` `{ email, type: sign-in | email-verification | forget-password }`, ' +
    '`POST /auth/sign-in/email-otp` `{ email, otp }`, `POST /auth/email-otp/verify-email` `{ email, otp }`, ' +
    '`POST /auth/email-otp/reset-password` `{ email, otp, password }`.',
  '- Throttles per IP: sign-in 10/min; endpoints that send email 5/min; code/token checks 10/min; everything else 60/min.',
  '',
  'Signing in sets the httpOnly, SameSite=Lax `better-auth.session_token` cookie (`__Secure-` prefixed over https), the `session` ' +
    'security scheme below. Every route without a `security` requirement is public; the rest answer 401 `UNAUTHORIZED` without a ' +
    'session and 403 `FORBIDDEN` for a disallowed role. Cookie-authenticated mutations from an Origin outside the CORS allowlist get ' +
    '403 `INVALID_ORIGIN`.',
].join('\n');

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('Kritex API')
    .setDescription(API_DESCRIPTION)
    .setVersion('1.0')
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
