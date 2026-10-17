import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { appConfig } from './app.config';
import { authConfig } from './auth.config';
import { cryptoConfig } from './crypto.config';
import { databaseConfig } from './database.config';
import { resetEnvCache, validateEnv } from './env.validation';
import { partnersConfig } from './partners.config';
import { redisConfig } from './redis.config';
import { storageConfig } from './storage.config';

/** Global configuration: validates the environment once at bootstrap and exposes typed namespaces. */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.ENV_FILE ?? ['.env'],
      validate: (raw) => {
        resetEnvCache();
        return validateEnv(raw);
      },
      load: [
        appConfig,
        databaseConfig,
        redisConfig,
        storageConfig,
        authConfig,
        cryptoConfig,
        partnersConfig,
      ],
    }),
  ],
})
export class ConfigModule {}
