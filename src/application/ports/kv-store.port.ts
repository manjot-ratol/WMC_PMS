export interface KvStorePort {
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  getJson<T>(key: string): Promise<T | null>;
  del(key: string): Promise<void>;
  /** Atomic read-and-delete, for single-use tokens and challenges. */
  getAndDelJson<T>(key: string): Promise<T | null>;
  /** Atomic increment that preserves the key's TTL; returns the new value. */
  incr(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
}
export const KV_STORE = Symbol('KV_STORE');

export const KEY_PREFIX = {
  otpPhone: 'otp:phone:',
  otpEmail: 'otp:email:',
  rateLimit: 'rl:',
  session: 'session:',
  preAuth: 'preauth:',
  lock: 'lock:',
  progress: 'progress:',
} as const;
