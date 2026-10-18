import { createHmac } from 'node:crypto';
import { DigioWebhookVerifier } from './digio-webhook.verifier';

describe('DigioWebhookVerifier', () => {
  const secret = 'whsec';
  const verifier = new DigioWebhookVerifier({
    digio: { webhookSecret: secret },
  } as never);
  const body = '{"id":"evt_1","event":"KRA.PAN.STATUS.UPDATE"}';
  const sig = createHmac('sha256', secret).update(body).digest('hex');

  it('accepts a correct checksum (case-insensitive) and rejects wrong or missing ones', () => {
    expect(verifier.verify(body, sig)).toBe(true);
    expect(verifier.verify(body, sig.toUpperCase())).toBe(true);
    expect(verifier.verify(body, 'deadbeef')).toBe(false);
    expect(verifier.verify(body, undefined)).toBe(false);
    expect(verifier.verify(Buffer.from(body + ' '), sig)).toBe(false);
  });
  it('is not configured without a secret and then rejects everything', () => {
    const none = new DigioWebhookVerifier({
      digio: { webhookSecret: '' },
    } as never);
    expect(none.configured).toBe(false);
    expect(none.verify(body, sig)).toBe(false);
    expect(verifier.configured).toBe(true);
  });
});
