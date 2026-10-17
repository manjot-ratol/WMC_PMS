import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { databaseConfig } from '../../common/config/database.config';
import { PrismaClient } from '@prisma/client';

/** The only Prisma client in the codebase. Lives behind repositories; never injected into services. */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    @Inject(databaseConfig.KEY)
    cfg: Pick<ReturnType<typeof databaseConfig>, 'url'>,
  ) {
    super({ datasources: { db: { url: cfg.url } }, log: ['warn', 'error'] });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async ping(): Promise<boolean> {
    await this.$queryRaw`SELECT 1`;
    return true;
  }
}
