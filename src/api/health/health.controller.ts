import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Res,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { appConfig } from '../../common/config/app.config';
import { RedisConnection } from '../../infrastructure/cache/redis.provider';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { APP_VERSION } from '../../app/version';

export interface ReadinessReport {
  status: 'ok' | 'degraded';
  checks: Record<'postgres' | 'redis', 'ok' | 'fail'>;
}

@ApiTags('platform')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(appConfig.KEY)
    private readonly cfg: Pick<ReturnType<typeof appConfig>, 'serviceName'>,
    private readonly prisma: PrismaService,
    private readonly redis: RedisConnection,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Process is up.' })
  live(): { status: 'ok'; service: string; version: string } {
    return {
      status: 'ok',
      service: this.cfg.serviceName,
      version: APP_VERSION,
    };
  }

  @Get('ready')
  @ApiOkResponse({ description: 'All dependencies reachable.' })
  @ApiServiceUnavailableResponse({
    description: 'One or more dependencies failed.',
  })
  async ready(@Res() res: Response): Promise<void> {
    const checks: ReadinessReport['checks'] = {
      postgres: await probe(() => this.prisma.ping()),
      redis: await probe(() => this.redis.ping()),
    };
    const ok = Object.values(checks).every((c) => c === 'ok');
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: ok ? 'ok' : 'degraded',
      checks,
    } satisfies ReadinessReport);
  }
}

async function probe(fn: () => Promise<boolean>): Promise<'ok' | 'fail'> {
  try {
    return (await fn()) ? 'ok' : 'fail';
  } catch {
    return 'fail';
  }
}
