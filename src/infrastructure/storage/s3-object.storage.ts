import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type {
  ObjectStoragePort,
  StoredObjectInfo,
} from '../../application/ports/object-storage.port';
import { storageConfig } from '../../common/config/storage.config';
import { DependencyUnavailableError } from '../../common/errors/app-error';

export const S3_CLIENT = Symbol('S3_CLIENT');

export function createS3Client(
  cfg: ReturnType<typeof storageConfig>,
): S3Client {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true, // MinIO
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });
}

/** S3-compatible object storage (MinIO locally). Keys are namespaced by the caller; the bucket is fixed. */
@Injectable()
export class S3ObjectStorage implements ObjectStoragePort {
  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(storageConfig.KEY)
    private readonly cfg: Pick<ReturnType<typeof storageConfig>, 'bucket'>,
  ) {}

  presignPut(
    key: string,
    contentType: string,
    expiresSeconds: number,
    maxSizeBytes?: number,
  ): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.cfg.bucket,
      Key: key,
      ContentType: contentType,
      ...(maxSizeBytes ? { ContentLength: maxSizeBytes } : {}),
    });
    return this.guard('presignPut', () =>
      getSignedUrl(this.s3, cmd, {
        expiresIn: expiresSeconds,
        unhoistableHeaders: new Set(['content-type']),
      }),
    );
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    try {
      const out = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
      );
      return {
        sizeBytes: out.ContentLength ?? 0,
        contentType: out.ContentType,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw new DependencyUnavailableError(undefined, {
        cause: err,
        details: { dependency: 'object-storage', operation: 'head' },
      });
    }
  }

  async get(key: string): Promise<Buffer> {
    const out = await this.guard('get', () =>
      this.s3.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key })),
    );
    const bytes = await out.Body?.transformToByteArray();
    return Buffer.from(bytes ?? new Uint8Array());
  }

  async put(
    key: string,
    body: Buffer | string,
    contentType: string,
  ): Promise<void> {
    await this.guard('put', () =>
      this.s3.send(
        new PutObjectCommand({
          Bucket: this.cfg.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      ),
    );
  }

  private async guard<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw new DependencyUnavailableError(undefined, {
        cause: err,
        details: { dependency: 'object-storage', operation },
      });
    }
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === 'NotFound' ||
    e?.name === 'NoSuchKey' ||
    e?.$metadata?.httpStatusCode === 404
  );
}
