export interface StoredObjectInfo {
  sizeBytes: number;
  contentType?: string;
}

export interface ObjectStoragePort {
  presignPut(
    key: string,
    contentType: string,
    expiresSeconds: number,
    maxSizeBytes?: number,
  ): Promise<string>;
  head(key: string): Promise<StoredObjectInfo | null>;
  get(key: string): Promise<Buffer>;
  put(key: string, body: Buffer | string, contentType: string): Promise<void>;
}
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
