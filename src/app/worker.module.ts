import { Module } from '@nestjs/common';
import { QueueModule } from '../infrastructure/queue/queue.module';
import { PlatformModule } from './platform.module';

/** Worker process: processors and the outbox scheduler, no HTTP. */
@Module({ imports: [PlatformModule, QueueModule.forWorker()] })
export class WorkerModule {}
