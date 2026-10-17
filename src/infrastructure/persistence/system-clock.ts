import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { ClockPort } from '../../application/ports/clock.port';
import type { IdGeneratorPort } from '../../application/ports/id-generator.port';

@Injectable()
export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}

@Injectable()
export class CryptoIdGenerator implements IdGeneratorPort {
  uuid(): string {
    return randomUUID();
  }
  prefixed(prefix: string): string {
    return `${prefix}_${randomBytes(12).toString('base64url')}`;
  }
}
