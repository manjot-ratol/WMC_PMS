import { randomUUID } from 'node:crypto';
import { describeWithDb, loadTestEnv } from '../../../test/support/db';
import { DependencyUnavailableError } from '../../common/errors/app-error';
import { createS3Client, S3ObjectStorage } from './s3-object.storage';

describeWithDb('S3ObjectStorage (docker minio)', () => {
  let storage: S3ObjectStorage;
  const key = `test/${randomUUID()}/file.txt`;

  beforeAll(() => {
    loadTestEnv();
    const cfg = {
      endpoint: process.env.STORAGE_ENDPOINT!,
      region: 'us-east-1',
      accessKey: process.env.STORAGE_ACCESS_KEY!,
      secretKey: process.env.STORAGE_SECRET_KEY!,
      bucket: process.env.STORAGE_BUCKET!,
    };
    storage = new S3ObjectStorage(createS3Client(cfg), cfg);
  });

  it('put / head / get round-trip and head returns null for missing keys', async () => {
    expect(await storage.head(key)).toBeNull();
    await storage.put(key, Buffer.from('hello'), 'text/plain');
    expect(await storage.head(key)).toEqual({
      sizeBytes: 5,
      contentType: 'text/plain',
    });
    expect((await storage.get(key)).toString()).toBe('hello');
  });

  it('presigned PUT uploads with the declared content type', async () => {
    const k = `test/${randomUUID()}/presigned.png`;
    const url = await storage.presignPut(k, 'image/png', 60);
    expect(url).toMatch(/^http:\/\/localhost:9000\/pms-documents\/test\//);
    const res = await fetch(url, {
      method: 'PUT',
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      headers: { 'content-type': 'image/png' },
    });
    expect(res.status).toBe(200);
    expect(await storage.head(k)).toEqual({
      sizeBytes: 4,
      contentType: 'image/png',
    });
  });

  it('maps client failures to DependencyUnavailableError', async () => {
    const bad = new S3ObjectStorage(
      createS3Client({
        endpoint: 'http://127.0.0.1:1',
        region: 'r',
        accessKey: 'a',
        secretKey: 'b',
        bucket: 'x',
      }),
      { bucket: 'x' },
    );
    await expect(bad.get('k')).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );
    await expect(bad.head('k')).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );
  });
});
