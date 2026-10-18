import * as fs from 'node:fs';
import * as path from 'node:path';
import { TrackWizzMock } from './server';

/** Standalone mock for local runs: `npx ts-node tools/trackwizz-mock/main.ts` (keys from test/fixtures/trackwizz). */
const dir = path.resolve(
  __dirname,
  '..',
  '..',
  'test',
  'fixtures',
  'trackwizz',
);
const mock = new TrackWizzMock({
  port: Number(process.env.TRACKWIZZ_MOCK_PORT ?? 8099),
  theirPrivateKeyPem: fs.readFileSync(
    path.join(dir, 'their_private.pem'),
    'utf8',
  ),
  ourPublicKeyPem: fs.readFileSync(path.join(dir, 'our_public.pem'), 'utf8'),
});
void mock
  .start()
  .then(() =>
    console.log(
      `TrackWizz mock listening on ${process.env.TRACKWIZZ_MOCK_PORT ?? 8099}`,
    ),
  );
