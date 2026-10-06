import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './app.setup';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // keeps req.rawBody for webhook signature checks (Razorpay, Shiprocket)
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  configureApp(app);

  const config = app.get(AppConfigService);
  if (!config.isProduction) {
    setupSwagger(app);
  }

  const port = config.get('PORT');
  await app.listen(port);
  app.get(Logger).log(`kritex-server listening on http://localhost:${port}/api/v1`, 'Bootstrap');
}

void bootstrap();
