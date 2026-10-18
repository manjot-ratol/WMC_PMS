import { Global, Module } from '@nestjs/common';
import { OBJECT_STORAGE } from '../../application/ports/object-storage.port';
import { storageConfig } from '../../common/config/storage.config';
import {
  createS3Client,
  S3_CLIENT,
  S3ObjectStorage,
} from './s3-object.storage';

@Global()
@Module({
  providers: [
    {
      provide: S3_CLIENT,
      inject: [storageConfig.KEY],
      useFactory: createS3Client,
    },
    { provide: OBJECT_STORAGE, useClass: S3ObjectStorage },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
