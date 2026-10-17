import { Injectable } from '@nestjs/common';
import type {
  IdempotencyPort,
  IdempotencyRecord,
} from '../../../application/ports/idempotency.port';
import type { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../prisma.service';

@Injectable()
export class IdempotencyRepository implements IdempotencyPort {
  constructor(private readonly prisma: PrismaService) {}

  async find(
    principalId: string,
    route: string,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    const row = await this.prisma.idempotencyRecord.findUnique({
      where: { principalId_route_key: { principalId, route, key } },
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) return null;
    return { ...row, responseBody: row.responseBody as unknown };
  }

  async save(record: IdempotencyRecord): Promise<void> {
    const data = {
      requestHash: record.requestHash,
      statusCode: record.statusCode,
      responseBody: record.responseBody as Prisma.InputJsonValue,
      expiresAt: record.expiresAt,
    };
    await this.prisma.idempotencyRecord.upsert({
      where: {
        principalId_route_key: {
          principalId: record.principalId,
          route: record.route,
          key: record.key,
        },
      },
      create: {
        principalId: record.principalId,
        route: record.route,
        key: record.key,
        ...data,
      },
      update: data,
    });
  }
}
