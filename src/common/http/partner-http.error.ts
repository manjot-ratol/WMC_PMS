import type { Partner } from './http-request.types';

export interface PartnerHttpErrorInit {
  partner: Partner;
  operation: string;
  message: string;
  status?: number;
  vendorCode?: string;
  body?: unknown;
  isTransport?: boolean;
  retryable?: boolean;
  cause?: unknown;
}

/** Raised by HttpClientService for any failed outbound call. Partner gateways translate it to domain errors. */
export class PartnerHttpError extends Error {
  readonly partner: Partner;
  readonly operation: string;
  readonly status?: number;
  readonly vendorCode?: string;
  readonly body?: unknown;
  readonly isTransport: boolean;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(init: PartnerHttpErrorInit) {
    super(init.message);
    this.name = 'PartnerHttpError';
    this.partner = init.partner;
    this.operation = init.operation;
    this.status = init.status;
    this.vendorCode = init.vendorCode;
    this.body = init.body;
    this.isTransport = init.isTransport ?? false;
    this.retryable =
      init.retryable ??
      (this.isTransport || (init.status !== undefined && init.status >= 500));
    this.cause = init.cause;
  }
}
