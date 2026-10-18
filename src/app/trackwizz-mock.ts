import * as fs from 'node:fs';
import * as path from 'node:path';
import { TrackWizzMock } from '../infrastructure/partners/trackwizz/trackwizz-mock.server';

/**
 * Standalone AS501 stand-in for local/docker runs (never production). Keys come from env (escaped PEM) or from
 * the test fixtures directory; the mock plays TrackWizz, so it needs TrackWizz's private key and our public key.
 */
const pem = (v: string | undefined): string | undefined =>
  v ? v.replace(/\\n/g, '\n') : undefined;
const fixtures =
  process.env.TRACKWIZZ_MOCK_KEY_DIR ??
  path.resolve(__dirname, '..', '..', 'test', 'fixtures', 'trackwizz');
const read = (name: string): string =>
  fs.readFileSync(path.join(fixtures, name), 'utf8');
const port = Number(process.env.TRACKWIZZ_MOCK_PORT ?? 8099);
const mock = new TrackWizzMock({
  port,
  host: process.env.TRACKWIZZ_MOCK_HOST ?? '127.0.0.1',
  theirPrivateKeyPem:
    pem(process.env.TRACKWIZZ_MOCK_THEIR_PRIVATE_KEY_PEM) ??
    read('their_private.pem'),
  ourPublicKeyPem:
    pem(process.env.TRACKWIZZ_MOCK_OUR_PUBLIC_KEY_PEM) ??
    read('our_public.pem'),
});
void mock
  .start()
  .then(() => console.log(`TrackWizz mock listening on ${port}`));
