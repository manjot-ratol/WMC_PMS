import {
  DependencyUnavailableError,
  PartnerRejectedError,
} from '../../../common/errors/app-error';
import { PartnerHttpError } from '../../../common/http/partner-http.error';
import { translateDigioError } from './digio-gateway.base';

describe('translateDigioError', () => {
  it('passes through non-partner errors and wraps non-Error values', () => {
    const e = new Error('x');
    expect(translateDigioError(e, 'op')).toBe(e);
    expect(translateDigioError('boom', 'op')).toBeInstanceOf(Error);
  });
  it('maps 5xx and transport to DependencyUnavailableError, 4xx to PartnerRejectedError', () => {
    expect(
      translateDigioError(
        new PartnerHttpError({
          partner: 'digio',
          operation: 'o',
          message: 'm',
          status: 502,
        }),
        'o',
      ),
    ).toBeInstanceOf(DependencyUnavailableError);
    expect(
      translateDigioError(
        new PartnerHttpError({
          partner: 'digio',
          operation: 'o',
          message: 'm',
          isTransport: true,
        }),
        'o',
      ),
    ).toBeInstanceOf(DependencyUnavailableError);
    const rejected = translateDigioError(
      new PartnerHttpError({
        partner: 'digio',
        operation: 'o',
        message: 'm',
        status: 404,
      }),
      'o',
    ) as PartnerRejectedError;
    expect(rejected).toBeInstanceOf(PartnerRejectedError);
    expect(rejected.details).toMatchObject({
      status: 404,
      vendorMessage: undefined,
    });
  });
});
