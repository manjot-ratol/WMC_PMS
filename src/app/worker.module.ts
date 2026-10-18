import { Module } from '@nestjs/common';
import { JobsModule } from '../application/jobs/jobs.module';
import { AnalyticsModule } from '../infrastructure/analytics/analytics.module';
import { QueueModule } from '../infrastructure/queue/queue.module';
import { PlatformModule } from './platform.module';

/** Worker process: processors and the outbox scheduler, no HTTP. */
@Module({
  imports: [
    PlatformModule,
    QueueModule.forWorker(),
    JobsModule,
    AnalyticsModule,
  ],
})
export class WorkerModule {}
