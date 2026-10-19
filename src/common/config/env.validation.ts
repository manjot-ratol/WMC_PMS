import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

function isBase64Key(bytes: number) {
  return (value: unknown): boolean => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(value))
      return false;
    return Buffer.from(value, 'base64').length === bytes;
  };
}

export class EnvSchema {
  @IsIn(['local', 'test', 'production']) APP_ENV:
    'local' | 'test' | 'production' = 'local';
  @Transform(toInt) @IsInt() @Min(1) PORT = 3000;
  @IsString() SERVICE_NAME = 'wmc-pms';
  @IsString() LOG_LEVEL = 'info';
  @IsString() @MinLength(8) INTERNAL_SERVICE_TOKEN!: string;

  @IsString() @MinLength(1) DATABASE_URL!: string;
  @IsString() @MinLength(1) REDIS_URL!: string;

  @IsString() STORAGE_ENDPOINT = 'http://localhost:9000';
  @IsString() STORAGE_ACCESS_KEY = 'minio';
  @IsString() STORAGE_SECRET_KEY = 'minio123';
  @IsString() STORAGE_BUCKET = 'pms-documents';
  @IsString() STORAGE_REGION = 'us-east-1';

  @Transform(toInt) @IsInt() @Min(60) SESSION_TTL_SECONDS = 1800;
  @Transform(toInt) @IsInt() @Min(60) PREAUTH_TTL_SECONDS = 600;
  @Transform(toInt) @IsInt() @Min(30) OTP_TTL_SECONDS = 300;
  @Transform(toInt) @IsInt() @Min(1) OTP_RESEND_AFTER_SECONDS = 30;
  @Transform(toInt) @IsInt() @Min(1) OTP_MAX_ATTEMPTS = 5;

  @IsString() @MinLength(1) FIELD_ENCRYPTION_KEY_ID = 'k1';
  @IsString() FIELD_ENCRYPTION_KEY!: string;
  @IsString() FINGERPRINT_HMAC_KEY!: string;
  @IsString() OTP_HMAC_KEY!: string;

  @IsString() DIGIO_BASE_URL = 'https://ext.digio.in:444';
  @IsOptional() @IsString() DIGIO_CLIENT_ID = '';
  @IsOptional() @IsString() DIGIO_CLIENT_SECRET = '';
  @Transform(toInt) @IsInt() @Min(1000) DIGIO_TIMEOUT_MS = 30000;
  @IsOptional() @IsString() DIGIO_WEBHOOK_SECRET = '';
  @IsString() DIGIO_KYC_TEMPLATE_NAME = 'PMS_KYC_V1';
  @IsString() DIGIO_ESIGN_SIGN_TYPE = 'aadhaar';
  @Transform(toInt) @IsInt() @Min(1) DIGIO_ESIGN_EXPIRE_DAYS = 10;
  @IsString() FUNDING_BENEFICIARY_NAME = 'PLACEHOLDER PMS POOL ACCOUNT';
  @IsString() FUNDING_BENEFICIARY_ACCOUNT_NUMBER = '000000000000';
  @IsString() FUNDING_BENEFICIARY_IFSC = 'XXXX0000000';
  @IsString() FUNDING_BENEFICIARY_BANK_NAME = 'PLACEHOLDER BANK';
  @Transform(toInt) @IsInt() @Min(60) UPLOAD_URL_TTL_SECONDS = 300;

  @IsOptional() @IsString() TRACKWIZZ_BASE_URL = '';
  @IsOptional() @IsString() TRACKWIZZ_API_TOKEN = '';
  @IsString() TRACKWIZZ_CLUSTER = 'CL1_User';
  @IsOptional() @IsString() TRACKWIZZ_DOMAIN = '';
  @IsOptional() @IsString() TRACKWIZZ_SOURCE_SYSTEM_NAME = '';
  @IsOptional() @IsString() TRACKWIZZ_OUR_PRIVATE_KEY_PEM = '';
  @IsOptional() @IsString() TRACKWIZZ_THEIR_PUBLIC_KEY_PEM = '';
  @Transform(toInt) @IsInt() @Min(1000) TRACKWIZZ_TIMEOUT_MS = 30000;
  @IsOptional() @IsString() TRACKWIZZ_CRYPTO_PROFILE = '';

  @IsString() MFCENTRAL_BASE_URL = 'https://uatservices.mfcentral.com';
  @IsOptional() @IsString() MFCENTRAL_CLIENT_ID = '';
  @IsOptional() @IsString() MFCENTRAL_CLIENT_SECRET = '';
  @IsOptional() @IsString() MFCENTRAL_USERNAME = '';
  @IsOptional() @IsString() MFCENTRAL_PASSWORD = '';
  @IsOptional() @IsString() MFCENTRAL_ENCRYPTION_KEY = '';
  @IsOptional() @IsString() MFCENTRAL_PRIVATE_JWK = '';
  @Transform(toInt) @IsInt() @Min(1000) MFCENTRAL_TIMEOUT_MS = 30000;
  @IsIn(['remote', 'local']) MFCENTRAL_CRYPTO_MODE: 'remote' | 'local' =
    'remote';
  @IsString() MFCENTRAL_APP_URL = 'https://mfc-cas-uat.mfcentral.com';
  /** Browser-facing URL MF Central sends the investor back to (our callback). */
  @IsString() MFCENTRAL_REDIRECT_URL =
    'http://localhost:3000/v1/integrations/mfcentral/callback';
  /** Front-end page the callback redirects the browser to once the payload is stored. */
  @IsString() MFCENTRAL_RETURN_URL =
    'http://localhost:5173/onboarding/portfolio-import';
  @Transform(toInt) @IsInt() @Min(1) PORTFOLIO_IMPORT_TTL_MINUTES = 15;
  /** 32-byte key MF Central issued for the hand-off URL payload (AES-256-CBC, used raw). */
  @IsOptional() @IsString() MFCENTRAL_URL_ENCRYPTION_KEY = '';
  /** UAT only: MF Central's test PANs are bound to their registered test mobile; when set, every CAS request carries this mobile instead of the customer's. Refused in production. */
  @IsOptional() @IsString() MFCENTRAL_TEST_MOBILE_OVERRIDE = '';

  @Transform(toBool) @IsBoolean() CLEVERTAP_ENABLED = false;
  @IsString() CLEVERTAP_BASE_URL = 'https://in1.api.clevertap.com';
  @IsOptional() @IsString() CLEVERTAP_ACCOUNT_ID = '';
  @IsOptional() @IsString() CLEVERTAP_PASSCODE = '';

  @IsString() SMTP_HOST = 'localhost';
  @Transform(toInt) @IsInt() @Min(1) SMTP_PORT = 1025;
  @IsString() MAIL_FROM = 'no-reply@wmc-pms.local';
}

export type ValidatedEnv = EnvSchema;

const KEY_CHECKS: Array<[keyof EnvSchema, number]> = [
  ['FIELD_ENCRYPTION_KEY', 32],
  ['FINGERPRINT_HMAC_KEY', 32],
  ['OTP_HMAC_KEY', 32],
];

/** Validates raw environment and returns typed values; throws one error naming every problem. */
export function validateEnv(raw: Record<string, unknown>): ValidatedEnv {
  const env = plainToInstance(EnvSchema, raw, { exposeDefaultValues: true });
  const problems: string[] = validateSync(env, {
    skipMissingProperties: false,
  }).map(
    (e) =>
      `${e.property}: ${Object.values(e.constraints ?? {}).join(', ') || 'invalid'}`,
  );
  for (const [key, bytes] of KEY_CHECKS) {
    if (typeof env[key] === 'string' && !isBase64Key(bytes)(env[key])) {
      problems.push(`${key}: must be base64 of exactly ${bytes} bytes`);
    }
  }
  if (problems.length) {
    throw new Error(
      `Invalid environment configuration:\n  - ${problems.join('\n  - ')}`,
    );
  }
  return env;
}

let cached: ValidatedEnv | undefined;
/** Validated process.env, memoised; tests may call resetEnvCache(). */
export function env(): ValidatedEnv {
  cached ??= validateEnv(process.env);
  return cached;
}
export function resetEnvCache(): void {
  cached = undefined;
}
