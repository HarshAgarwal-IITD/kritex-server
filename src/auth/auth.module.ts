import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthController } from './auth.controller';
import { AuthOptionsController } from './auth-options.controller';
import { createAuth } from './auth.factory';
import { AUTH_INSTANCE, AuthService } from './auth.service';
import { MailService } from './mail/mail.service';

/**
 * Better Auth (ADR-004) mounted at `/api/v1/auth/*`, plus the dev mail transport. Global so the
 * AuthGuard (registered as APP_GUARD in AppModule) and other modules can inject AuthService.
 */
@Global()
@Module({
  controllers: [AuthController, AuthOptionsController],
  providers: [
    MailService,
    {
      provide: AUTH_INSTANCE,
      inject: [PrismaService, MailService, AppConfigService],
      useFactory: (prisma: PrismaService, mail: MailService, config: AppConfigService) =>
        createAuth({
          prisma,
          mail,
          env: {
            NODE_ENV: config.get('NODE_ENV'),
            BETTER_AUTH_SECRET: config.get('BETTER_AUTH_SECRET'),
            BETTER_AUTH_URL: config.get('BETTER_AUTH_URL'),
            WEB_URL: config.get('WEB_URL'),
            CORS_ORIGIN: config.get('CORS_ORIGIN'),
            AUTH_COOKIE_DOMAIN: config.get('AUTH_COOKIE_DOMAIN'),
            GOOGLE_CLIENT_ID: config.get('GOOGLE_CLIENT_ID'),
            GOOGLE_CLIENT_SECRET: config.get('GOOGLE_CLIENT_SECRET'),
          },
        }),
    },
    AuthService,
  ],
  exports: [AuthService, MailService],
})
export class AuthModule {}
