import { appConfig } from '../common/config/app.config';
import { AppLogger } from '../common/logging/logger.service';
import { createApiApp } from './bootstrap';

async function main(): Promise<void> {
  const app = await createApiApp();
  const cfg = app.get<ReturnType<typeof appConfig>>(appConfig.KEY);
  await app.listen(cfg.port);
  app.get(AppLogger).info('api.started', { port: cfg.port, env: cfg.env });
}

void main();
