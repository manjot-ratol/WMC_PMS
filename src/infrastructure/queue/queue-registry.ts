import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';

/** Lazily creates one BullMQ Queue per name on the shared connection, and owns that connection's shutdown. */
@Injectable()
export class QueueRegistry implements OnModuleDestroy {
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly connection: Redis) {}

  get(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection });
      this.queues.set(name, q);
    }
    return q;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
  }

  /** Queues share one ioredis client; closing them does not close it, so the registry does. */
  async onModuleDestroy(): Promise<void> {
    await this.closeAll();
    if (this.connection.status !== 'end') await this.connection.quit();
  }
}
