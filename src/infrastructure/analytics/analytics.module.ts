import { Module } from '@nestjs/common';
import { ANALYTICS_SINK } from '../../application/ports/analytics-outbox.port';
import { partnersConfig } from '../../common/config/partners.config';
import { HttpClientService } from '../../common/http/http-client.service';
import { AppLogger } from '../../common/logging/logger.service';
import { AnalyticsDispatcherProcessor } from './analytics-dispatcher.processor';
import { AnalyticsDispatcherScheduler } from './analytics-dispatcher.scheduler';
import { CleverTapGateway } from './clevertap.gateway';
import { LogAnalyticsSink } from './log-analytics.sink';

/** Worker-only: the CleverTap dispatcher (or the local log sink when CLEVERTAP_ENABLED=false). */
@Module({
  providers: [
    CleverTapGateway,
    LogAnalyticsSink,
    {
      provide: ANALYTICS_SINK,
      inject: [partnersConfig.KEY, HttpClientService, AppLogger],
      useFactory: (
        cfg: ReturnType<typeof partnersConfig>,
        http: HttpClientService,
        logger: AppLogger,
      ) =>
        cfg.clevertap.enabled
          ? new CleverTapGateway(http, cfg)
          : new LogAnalyticsSink(logger),
    },
    AnalyticsDispatcherProcessor,
    AnalyticsDispatcherScheduler,
  ],
  exports: [ANALYTICS_SINK],
})
export class AnalyticsModule {}
