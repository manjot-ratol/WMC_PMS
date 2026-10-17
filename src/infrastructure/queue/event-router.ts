import { Injectable } from '@nestjs/common';

export interface RouteTarget {
  queue: string;
  jobName: string;
}

/** Maps outbox event types to the queue/job that consumes them. Registered by feature modules. */
@Injectable()
export class EventRouter {
  private readonly routes = new Map<string, RouteTarget>();

  register(eventType: string, target: RouteTarget): void {
    if (this.routes.has(eventType))
      throw new Error(`Event type "${eventType}" is already routed`);
    this.routes.set(eventType, target);
  }

  route(eventType: string): RouteTarget | undefined {
    return this.routes.get(eventType);
  }
}
