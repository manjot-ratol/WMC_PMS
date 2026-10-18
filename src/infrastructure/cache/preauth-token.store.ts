import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  KEY_PREFIX,
  KV_STORE,
  type KvStorePort,
} from '../../application/ports/kv-store.port';
import {
  hashToken,
  type PreAuthBinding,
  type PreAuthTokenStore,
} from '../../application/ports/token-store.port';
import { authConfig } from '../../common/config/auth.config';

@Injectable()
export class RedisPreAuthTokenStore implements PreAuthTokenStore {
  constructor(
    @Inject(KV_STORE) private readonly kv: KvStorePort,
    @Inject(authConfig.KEY)
    private readonly cfg: Pick<
      ReturnType<typeof authConfig>,
      'preAuthTtlSeconds'
    >,
  ) {}

  async issue(binding: PreAuthBinding): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.kv.setJson(
      `${KEY_PREFIX.preAuth}${hashToken(token)}`,
      binding,
      this.cfg.preAuthTtlSeconds,
    );
    return token;
  }

  resolve(token: string): Promise<PreAuthBinding | null> {
    return this.kv.getJson<PreAuthBinding>(
      `${KEY_PREFIX.preAuth}${hashToken(token)}`,
    );
  }

  revoke(token: string): Promise<void> {
    return this.kv.del(`${KEY_PREFIX.preAuth}${hashToken(token)}`);
  }
}
