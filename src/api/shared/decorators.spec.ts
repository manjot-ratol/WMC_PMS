import type { ExecutionContext } from '@nestjs/common';
import { clientIpFromContext } from './client-ip.decorator';

const ctx = (req: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

describe('clientIpFromContext', () => {
  it('prefers req.ip, then the socket address, then unknown', () => {
    expect(clientIpFromContext(ctx({ ip: '1.1.1.1' }))).toBe('1.1.1.1');
    expect(
      clientIpFromContext(ctx({ socket: { remoteAddress: '2.2.2.2' } })),
    ).toBe('2.2.2.2');
    expect(clientIpFromContext(ctx({}))).toBe('unknown');
  });
});
