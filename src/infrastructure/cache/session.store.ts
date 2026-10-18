import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  KEY_PREFIX,
  KV_STORE,
  type KvStorePort,
} from '../../application/ports/kv-store.port';
import {
  hashToken,
  type SessionData,
  type SessionStore,
} from '../../application/ports/token-store.port';
import { authConfig } from '../../common/config/auth.config';

@Injectable()
export class RedisSessionStore implements SessionStore {
  constructor(
    @Inject(KV_STORE) private readonly kv: KvStorePort,
    @Inject(authConfig.KEY)
    private readonly cfg: Pick<
      ReturnType<typeof authConfig>,
      'sessionTtlSeconds'
    >,
  ) {}

  async issue(data: SessionData): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.kv.setJson(this.key(token), data, this.cfg.sessionTtlSeconds);
    return token;
  }

  resolve(token: string): Promise<SessionData | null> {
    return this.kv.getJson<SessionData>(this.key(token));
  }

  async touch(token: string): Promise<void> {
    const data = await this.resolve(token);
    if (data)
      await this.kv.setJson(this.key(token), data, this.cfg.sessionTtlSeconds);
  }

  update(token: string, data: SessionData): Promise<void> {
    return this.kv.setJson(this.key(token), data, this.cfg.sessionTtlSeconds);
  }

  revoke(token: string): Promise<void> {
    return this.kv.del(this.key(token));
  }

  private key(token: string): string {
    return `${KEY_PREFIX.session}${hashToken(token)}`;
  }
}
