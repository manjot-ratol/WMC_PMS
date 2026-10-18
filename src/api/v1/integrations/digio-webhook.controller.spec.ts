import { UnauthenticatedError } from '../../../common/errors/app-error';
import { DigioWebhookController } from './digio-webhook.controller';

describe('DigioWebhookController', () => {
  const service = {
    receive: jest.fn().mockResolvedValue({ received: true, duplicate: false }),
  };
  it('verifies the checksum over the raw body and acknowledges', async () => {
    const verifier = { verify: jest.fn().mockReturnValue(true) };
    const c = new DigioWebhookController(service as never, verifier as never);
    const raw = Buffer.from('{"id":"e1"}');
    await expect(
      c.receive({ id: 'e1' }, 'abc', { rawBody: raw }),
    ).resolves.toEqual({ received: true });
    expect(verifier.verify).toHaveBeenCalledWith(raw, 'abc');
    expect(service.receive).toHaveBeenCalledWith({ id: 'e1' }, raw);
  });
  it('falls back to the serialised body when no raw body was captured and rejects bad checksums', async () => {
    const verifier = { verify: jest.fn().mockReturnValue(false) };
    const c = new DigioWebhookController(service as never, verifier as never);
    await expect(c.receive({ id: 'e2' }, undefined, {})).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(verifier.verify).toHaveBeenCalledWith(
      Buffer.from('{"id":"e2"}'),
      undefined,
    );
  });
});
