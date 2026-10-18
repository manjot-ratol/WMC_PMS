import type { ExecutionContext } from '@nestjs/common';
import { bearerTokenValueFromContext } from './session-token.decorator';

const ctx = (req: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

describe('bearerTokenValueFromContext', () => {
  it('prefers the pre-auth token, then the session token, then empty', () => {
    expect(
      bearerTokenValueFromContext(
        ctx({ preauthToken: 'p', sessionToken: 's' }),
      ),
    ).toBe('p');
    expect(bearerTokenValueFromContext(ctx({ sessionToken: 's' }))).toBe('s');
    expect(bearerTokenValueFromContext(ctx({}))).toBe('');
  });
});
