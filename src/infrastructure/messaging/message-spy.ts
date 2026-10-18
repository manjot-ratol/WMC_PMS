import { Injectable } from '@nestjs/common';

export interface SpiedMessage {
  channel: 'SMS' | 'EMAIL';
  to: string;
  otp: string;
  at: Date;
}

/** In-memory capture of sent OTPs for local runs and SIT. Never registered in production. */
@Injectable()
export class MessageSpy {
  readonly messages: SpiedMessage[] = [];

  record(m: Omit<SpiedMessage, 'at'>): void {
    this.messages.push({ ...m, at: new Date() });
  }

  lastFor(to: string): SpiedMessage | undefined {
    return [...this.messages].reverse().find((m) => m.to === to);
  }

  clear(): void {
    this.messages.length = 0;
  }
}
