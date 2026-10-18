import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { partnersConfig } from '../../../../common/config/partners.config';
import { constantTimeEquals } from '../../../../common/crypto/constant-time';

export const DIGIO_CHECKSUM_HEADER = 'x-digio-checksum';

/** Digio signs webhooks with HMAC-SHA256(payload, account secret) in X-Digio-Checksum (webhooks/faq Q10). */
@Injectable()
export class DigioWebhookVerifier {
  constructor(
    @Inject(partnersConfig.KEY)
    private readonly cfg: ReturnType<typeof partnersConfig>,
  ) {}

  get configured(): boolean {
    return this.cfg.digio.webhookSecret.length > 0;
  }

  verify(rawBody: Buffer | string, checksum: string | undefined): boolean {
    if (!this.configured || !checksum) return false;
    const expected = createHmac('sha256', this.cfg.digio.webhookSecret)
      .update(rawBody)
      .digest('hex');
    return constantTimeEquals(expected, checksum.trim().toLowerCase());
  }
}
