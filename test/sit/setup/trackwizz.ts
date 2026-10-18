import * as fs from 'node:fs';
import * as path from 'node:path';
import { TrackWizzMock } from '../../../src/infrastructure/partners/trackwizz/trackwizz-mock.server';

const dir = path.resolve(__dirname, '..', '..', 'fixtures', 'trackwizz');
/** The in-process AS501 stand-in used by every SIT suite that runs the worker (real crypto path with test keys). */
export function createTrackWizzMock(
  port = Number(
    new URL(process.env.TRACKWIZZ_BASE_URL ?? 'http://127.0.0.1:8099').port ||
      8099,
  ),
): TrackWizzMock {
  return new TrackWizzMock({
    port,
    theirPrivateKeyPem: fs.readFileSync(
      path.join(dir, 'their_private.pem'),
      'utf8',
    ),
    ourPublicKeyPem: fs.readFileSync(path.join(dir, 'our_public.pem'), 'utf8'),
  });
}
