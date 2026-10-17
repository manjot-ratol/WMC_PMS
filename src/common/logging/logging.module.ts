import { Global, Module } from '@nestjs/common';
import { appConfig } from '../config/app.config';
import {
  AppLogger,
  LOGGER_OPTIONS,
  loggerOptionsFromConfig,
} from './logger.service';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

@Global()
@Module({
  providers: [
    {
      provide: LOGGER_OPTIONS,
      inject: [appConfig.KEY],
      useFactory: loggerOptionsFromConfig,
    },
    AppLogger,
    RequestLoggingInterceptor,
  ],
  exports: [AppLogger, RequestLoggingInterceptor],
})
export class LoggingModule {}
