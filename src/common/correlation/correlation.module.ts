import { Global, Module } from '@nestjs/common';
import { CorrelationMiddleware } from './correlation.middleware';
import { CorrelationStore } from './correlation.store';

@Global()
@Module({
  providers: [CorrelationStore, CorrelationMiddleware],
  exports: [CorrelationStore, CorrelationMiddleware],
})
export class CorrelationModule {}
