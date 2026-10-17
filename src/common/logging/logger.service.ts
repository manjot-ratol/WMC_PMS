import { Inject, Injectable, LoggerService, Optional } from '@nestjs/common';
import pino, { Logger as PinoLogger } from 'pino';
import { appConfig } from '../config/app.config';
import { CorrelationStore } from '../correlation/correlation.store';
import { redact } from './redaction';

export interface LoggerOptions {
  level: string;
  serviceName: string;
  pretty: boolean;
  stream?: NodeJS.WritableStream;
}

export const LOGGER_OPTIONS = Symbol('LOGGER_OPTIONS');

export function loggerOptionsFromConfig(
  cfg: ReturnType<typeof appConfig>,
): LoggerOptions {
  return {
    level: cfg.logLevel,
    serviceName: cfg.serviceName,
    pretty: cfg.env === 'local',
  };
}

/**
 * Structured JSON logger. Every line carries the correlation context automatically and every
 * field passes through redaction, so callers never have to remember either.
 */
@Injectable()
export class AppLogger implements LoggerService {
  private pino: PinoLogger;
  private moduleName?: string;

  constructor(
    private readonly store: CorrelationStore,
    @Optional() @Inject(LOGGER_OPTIONS) options?: LoggerOptions,
  ) {
    const opts = options ?? {
      level: 'info',
      serviceName: 'wmc-pms',
      pretty: false,
    };
    this.pino = pino(
      {
        level: opts.level,
        base: { service: opts.serviceName },
        timestamp: pino.stdTimeFunctions.isoTime,
        transport:
          opts.pretty && !opts.stream
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
      },
      opts.stream,
    );
  }

  /** Cheap clone sharing the pino instance, stamped with a module name. */
  child(module: string): AppLogger {
    const clone = Object.create(AppLogger.prototype) as AppLogger;
    Object.assign(clone, {
      store: this.store,
      pino: this.pino,
      moduleName: module,
    });
    return clone;
  }

  debug(msg: string, fields?: Record<string, unknown>): void {
    this.pino.debug(this.enrich(fields), msg);
  }
  info(msg: string, fields?: Record<string, unknown>): void {
    this.pino.info(this.enrich(fields), msg);
  }
  warn(msg: string, fields?: Record<string, unknown>): void {
    this.pino.warn(this.enrich(fields), msg);
  }
  error(msg: string, fields?: Record<string, unknown>): void {
    this.pino.error(this.enrich(fields), msg);
  }

  // Nest LoggerService surface (used by the framework itself)
  log(message: unknown, context?: string): void {
    this.pino.info(this.enrich({ module: context }), String(message));
  }
  verbose(message: unknown, context?: string): void {
    this.pino.trace(this.enrich({ module: context }), String(message));
  }
  fatal(message: unknown, context?: string): void {
    this.pino.fatal(this.enrich({ module: context }), String(message));
  }

  private enrich(fields?: Record<string, unknown>): Record<string, unknown> {
    const ctx = this.store.get();
    return {
      correlationId: ctx?.correlationId ?? 'none',
      requestId: ctx?.requestId,
      principalId: ctx?.principalId,
      reviewerId: ctx?.reviewerId,
      module: this.moduleName,
      ...(redact(fields ?? {}) as Record<string, unknown>),
    };
  }
}
