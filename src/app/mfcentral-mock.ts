import { MfCentralMock } from '../infrastructure/partners/mfcentral/mfcentral-mock.server';

/** Standalone MF Central CAS stand-in for local/docker runs (never production). No real crypto, no credentials. */
const port = Number(process.env.MFCENTRAL_MOCK_PORT ?? 4011);
const mock = new MfCentralMock({
  port,
  host: process.env.MFCENTRAL_MOCK_HOST ?? '127.0.0.1',
});
void mock
  .start()
  .then(() => console.log(`MF Central mock listening on ${port}`));
