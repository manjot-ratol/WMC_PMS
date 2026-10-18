import type { As501Response } from '../../domain/compliance/as501';

export interface As501Request {
  requestId: string;
  sourceSystemName: string;
  /** Comma-separated purpose codes, e.g. "01,04" or "06". */
  purpose: string;
  customerList: Record<string, unknown>[];
}
export interface As501Result {
  response: As501Response;
  /** Raw envelope as received (ciphertext only; safe to store as evidence, never to log). */
  envelope: Record<string, unknown>;
}
export interface TrackWizzGatewayPort {
  submit(request: As501Request): Promise<As501Result>;
}
export const TRACKWIZZ_GATEWAY = Symbol('TRACKWIZZ_GATEWAY');
