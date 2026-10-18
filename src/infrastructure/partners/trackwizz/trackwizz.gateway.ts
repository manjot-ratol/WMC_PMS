import { Inject, Injectable } from '@nestjs/common';
import type {
  As501Request,
  As501Result,
  TrackWizzGatewayPort,
} from '../../../application/ports/trackwizz-gateway.port';
import { partnersConfig } from '../../../common/config/partners.config';
import {
  DependencyUnavailableError,
  PartnerRejectedError,
} from '../../../common/errors/app-error';
import { HttpClientService } from '../../../common/http/http-client.service';
import { PartnerHttpError } from '../../../common/http/partner-http.error';
import type { As501Response } from '../../../domain/compliance/as501';
import {
  EnvelopeError,
  TrackWizzEnvelope,
  parseCryptoProfile,
  type Envelope,
} from './trackwizz-envelope';

export const AS501_PATH = '/CustomerInfo/as501';
export type TrackWizzConfig = ReturnType<typeof partnersConfig>['trackwizz'];

/** AS501 transport: headers per doc p.5, encrypted envelope per §6; the reply is verified before it is read. */
@Injectable()
export class TrackWizzGateway implements TrackWizzGatewayPort {
  private readonly config: TrackWizzConfig;
  private envelope?: TrackWizzEnvelope;

  constructor(
    private readonly http: HttpClientService,
    @Inject(partnersConfig.KEY) cfg: ReturnType<typeof partnersConfig>,
  ) {
    this.config = cfg.trackwizz;
  }

  async submit(request: As501Request): Promise<As501Result> {
    const sealed = this.crypto().seal(request);
    let res;
    try {
      res = await this.http.request<Partial<Envelope>>({
        partner: 'trackwizz',
        operation: `as501.${request.purpose.replace(/,/g, '_')}`,
        method: 'POST',
        url: `${this.config.baseUrl}${AS501_PATH}`,
        body: sealed,
        responseType: 'json',
        headers: {
          ApiToken: this.config.apiToken,
          Cluster: this.config.cluster,
          Domain: this.config.domain,
        },
        timeoutMs: this.config.timeoutMs,
      });
    } catch (err) {
      throw translate(err);
    }
    try {
      const response = this.crypto().open<As501Response>(res.data);
      return { response, envelope: res.data };
    } catch (err) {
      if (err instanceof EnvelopeError)
        throw new PartnerRejectedError('trackwizz', err.category, undefined, {
          cause: err,
          details: { partner: 'trackwizz', category: err.category },
        });
      throw err;
    }
  }

  /** Lazy so a process without TrackWizz keys still boots; the first call fails loudly instead. */
  private crypto(): TrackWizzEnvelope {
    if (!this.envelope) {
      if (!this.config.ourPrivateKeyPem || !this.config.theirPublicKeyPem)
        throw new DependencyUnavailableError(undefined, {
          details: { partner: 'trackwizz', reason: 'keys_not_configured' },
        });
      this.envelope = new TrackWizzEnvelope(
        this.config.ourPrivateKeyPem,
        this.config.theirPublicKeyPem,
        parseCryptoProfile(this.config.cryptoProfile),
      );
    }
    return this.envelope;
  }
}

function translate(err: unknown): Error {
  if (!(err instanceof PartnerHttpError))
    return err instanceof Error ? err : new Error(String(err));
  if (err.isTransport || (err.status !== undefined && err.status >= 500))
    return new DependencyUnavailableError(undefined, {
      cause: err,
      details: { partner: 'trackwizz', status: err.status },
    });
  return new PartnerRejectedError('trackwizz', err.vendorCode, undefined, {
    cause: err,
    details: { partner: 'trackwizz', status: err.status },
  });
}
