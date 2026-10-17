import { NestFactory } from '@nestjs/core';
import { AppLogger } from '../common/logging/logger.service';
import { WorkerModule } from './worker.module';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(AppLogger));
  app.enableShutdownHooks();
  await app.init();
  app.get(AppLogger).info('worker.started');
}

void main();
