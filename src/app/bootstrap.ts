import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppLogger } from '../common/logging/logger.service';
import { setupSwagger } from '../common/swagger/swagger.setup';
import { ApiModule } from './api.module';
import { APP_VERSION } from './version';

export const BODY_LIMIT = '1mb';

export interface CreateAppOptions {
  /** Test hook: override providers (e.g. logger options) before the app is created. */
  overrides?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/** Builds the fully configured API application (not yet listening). */
export async function createApiApp(
  options: CreateAppOptions = {},
): Promise<INestApplication> {
  const app = options.overrides
    ? (
        await options
          .overrides(Test.createTestingModule({ imports: [ApiModule] }))
          .compile()
      ).createNestApplication<NestExpressApplication>({ bufferLogs: true })
    : await NestFactory.create<NestExpressApplication>(ApiModule, {
        bufferLogs: true,
        abortOnError: false,
      });
  app.useLogger(app.get(AppLogger));
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(json({ limit: BODY_LIMIT }));
  app.use(urlencoded({ extended: false, limit: BODY_LIMIT }));
  app.enableShutdownHooks();
  setupSwagger(app, APP_VERSION);
  return app;
}
