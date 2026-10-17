import { PartnerHttpError } from './partner-http.error';
import { defaultRetryOn, withRetry } from './retry.policy';

const transport = new PartnerHttpError({
  partner: 'digio',
  operation: 'o',
  message: 'net',
  isTransport: true,
});
const server = new PartnerHttpError({
  partner: 'digio',
  operation: 'o',
  message: '503',
  status: 503,
});
const client = new PartnerHttpError({
  partner: 'digio',
  operation: 'o',
  message: '400',
  status: 400,
});

describe('retry policy', () => {
  it('defaultRetryOn retries transport and 5xx only', () => {
    expect(defaultRetryOn(transport)).toBe(true);
    expect(defaultRetryOn(server)).toBe(true);
    expect(defaultRetryOn(client)).toBe(false);
  });

  it('withRetry retries up to attempts with backoff and rethrows the last error', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(server)
      .mockRejectedValueOnce(server)
      .mockRejectedValue(server);
    const sleep = jest.fn().mockResolvedValue(undefined);
    await expect(
      withRetry(fn, { attempts: 3, backoffMs: 10 }, sleep),
    ).rejects.toBe(server);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it('withRetry does not retry non-retryable errors', async () => {
    const fn = jest.fn().mockRejectedValue(client);
    await expect(
      withRetry(fn, { attempts: 3, backoffMs: 1 }, jest.fn()),
    ).rejects.toBe(client);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('withRetry with attempts 1 calls once', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(
      withRetry(fn, { attempts: 1, backoffMs: 1 }, jest.fn()),
    ).resolves.toBe('ok');
  });
});
