import { AppLogger } from '../common/logging/logger.service';
import { createWorkerContext } from './bootstrap';

async function main(): Promise<void> {
  const ctx = await createWorkerContext();
  ctx.enableShutdownHooks();
  ctx.get(AppLogger).info('worker.started');
}

void main();
