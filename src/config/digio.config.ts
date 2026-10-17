import { registerAs } from '@nestjs/config';

export const DIGIO_SANDBOX_BASE_URL = 'https://ext.digio.in:444';
export const DIGIO_PRODUCTION_BASE_URL = 'https://api.digio.in';

export type KraServiceProvider = 'NDML' | 'CDSL' | 'CAMS';

export interface DigioConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
  kraDefaultServiceProvider?: KraServiceProvider;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value.trim();
}

export const digioConfig = registerAs('digio', (): DigioConfig => {
  const timeoutRaw = process.env.DIGIO_TIMEOUT_MS;
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('DIGIO_TIMEOUT_MS must be a positive number');
  }

  const provider = process.env.DIGIO_KRA_DEFAULT_SERVICE_PROVIDER?.trim();
  if (provider && !['NDML', 'CDSL', 'CAMS'].includes(provider)) {
    throw new Error(
      'DIGIO_KRA_DEFAULT_SERVICE_PROVIDER must be one of NDML, CDSL, CAMS',
    );
  }

  return {
    baseUrl: (process.env.DIGIO_BASE_URL ?? DIGIO_SANDBOX_BASE_URL).replace(
      /\/+$/,
      '',
    ),
    clientId: requireEnv('DIGIO_CLIENT_ID'),
    clientSecret: requireEnv('DIGIO_CLIENT_SECRET'),
    timeoutMs,
    kraDefaultServiceProvider: provider as KraServiceProvider | undefined,
  };
});
