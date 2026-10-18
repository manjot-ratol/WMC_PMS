import { Module } from '@nestjs/common';
import { AuthModule } from '../common/auth/auth.module';
import { ConfigModule } from '../common/config/config.module';
import { CorrelationModule } from '../common/correlation/correlation.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { HttpModule } from '../common/http/http.module';
import { LoggingModule } from '../common/logging/logging.module';
import { CacheModule } from '../infrastructure/cache/cache.module';
import { DigioModule } from '../infrastructure/partners/digio/digio.module';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module';
import { StorageModule } from '../infrastructure/storage/storage.module';
import { DocumentsModule } from '../infrastructure/documents/documents.module';

/** Cross-cutting modules shared by the api and worker processes. */
@Module({
  imports: [
    ConfigModule,
    CorrelationModule,
    LoggingModule,
    CryptoModule,
    HttpModule,
    PersistenceModule,
    CacheModule,
    AuthModule,
    DigioModule,
    StorageModule,
    DocumentsModule,
  ],
})
export class PlatformModule {}
