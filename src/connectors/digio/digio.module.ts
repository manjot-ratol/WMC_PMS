import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { digioConfig } from '../../config/digio.config';
import { DigioHttpClient } from './digio-http.client';
import { DigioKraConnector } from './kra/kra.connector';

/**
 * Digio connectors. Import this module wherever a service needs to talk to
 * Digio; inject `DigioKraConnector` for the KRA APIs.
 */
@Module({
  imports: [ConfigModule.forFeature(digioConfig), HttpModule],
  providers: [DigioHttpClient, DigioKraConnector],
  exports: [DigioKraConnector],
})
export class DigioModule {}
