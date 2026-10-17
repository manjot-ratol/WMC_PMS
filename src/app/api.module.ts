import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { HealthModule } from '../api/health/health.module';
import { CorrelationMiddleware } from '../common/correlation/correlation.middleware';
import { ErrorEnvelopeFilter } from '../common/errors/error-envelope.filter';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { RequestLoggingInterceptor } from '../common/logging/request-logging.interceptor';
import { createValidationPipe } from '../common/validation/validation.pipe';
import { QueueModule } from '../infrastructure/queue/queue.module';
import { PlatformModule } from './platform.module';

@Module({
  imports: [PlatformModule, QueueModule.forApi(), HealthModule],
  providers: [
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*path');
  }
}
