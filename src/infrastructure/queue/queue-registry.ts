import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';

/** Lazily creates one BullMQ Queue per name on the shared connection. */
@Injectable()
export class QueueRegistry {
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
}
