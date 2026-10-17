import { Global, Module } from '@nestjs/common';
import { partnersConfig } from '../config/partners.config';
import { CircuitBreakerRegistry } from './circuit-breaker.registry';
import { HttpClientService } from './http-client.service';
import { PARTNER_TIMEOUTS, PartnerTimeouts } from './http-request.types';

@Global()
@Module({
  providers: [
    CircuitBreakerRegistry,
    {
      provide: PARTNER_TIMEOUTS,
      inject: [partnersConfig.KEY],
      useFactory: (p: ReturnType<typeof partnersConfig>): PartnerTimeouts => ({
        digio: p.digio.timeoutMs,
        trackwizz: p.trackwizz.timeoutMs,
        mfcentral: p.mfcentral.timeoutMs,
        ignosis: p.ignosis.timeoutMs,
        clevertap: p.clevertap.timeoutMs,
        messaging: p.messaging.timeoutMs,
      }),
    },
    HttpClientService,
  ],
  exports: [HttpClientService, CircuitBreakerRegistry],
})
export class HttpModule {}
