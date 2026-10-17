# WMC PMS backend

NestJS backend for the Portfolio Management Service. The first piece is a set of
connectors for Digio's DigiKYC **KRA** (KYC Registration Agency) APIs.

## Setup

```bash
npm install
cp .env.example .env   # then fill in DIGIO_CLIENT_ID / DIGIO_CLIENT_SECRET
npm run start:dev
```

| Variable | Purpose |
| --- | --- |
| `DIGIO_BASE_URL` | `https://ext.digio.in:444` (sandbox, default) or `https://api.digio.in` (production) |
| `DIGIO_CLIENT_ID` / `DIGIO_CLIENT_SECRET` | Digio API credentials, sent as HTTP Basic auth |
| `DIGIO_TIMEOUT_MS` | Request timeout, default 30000 |
| `DIGIO_KRA_DEFAULT_SERVICE_PROVIDER` | Optional `NDML` / `CDSL` / `CAMS` used when a request omits `service_provider` |

Digio's KRA services require your KRA credentials to be configured in Digio and,
for CVL KRA, IP whitelisting of Digio's egress IPs on the CVL side (see
https://documentation.digio.in/digikyc/kra/api_integration/).

## Digio KRA connector

Import `DigioModule` and inject `DigioKraConnector`.

```ts
import { DigioKraConnector } from './connectors/digio';

@Injectable()
export class KycService {
  constructor(private readonly kra: DigioKraConnector) {}

  async status(pan: string) {
    return this.kra.checkPanStatus({ pan_no: pan, fetch_type: 'I' });
  }

  async record(pan: string, dob: string) {
    return this.kra.fetchDetails(
      { pan_no: pan, dob, fetch_type: 'I' },
      { deserializeCodes: true },
    );
  }

  async register(payload: KraCommonRegistrationRequest) {
    return this.kra.uploadDetails({
      api_request_type: 'stateless',
      common_kra_registration_request: payload,
    });
  }
}
```

| Method | Digio endpoint | Docs |
| --- | --- | --- |
| `checkPanStatus(req, opts?)` | `POST /v3/client/kyc/kra/v2/get_pan_status` | [Check PAN status](https://documentation.digio.in/digikyc/kra/api_integration/check_pan_status/) |
| `fetchDetails(req, opts?)` | `POST /v3/client/kyc/kra/download_pan?deserialize_codes=` | [Fetch details](https://documentation.digio.in/digikyc/kra/api_integration/fetch_details/) |
| `uploadDetails(req, opts?)` | `POST /v3/client/kyc/kra/app/register` | [Upload details](https://documentation.digio.in/digikyc/kra/api_integration/upload_details/) |

Behaviour common to all three:

- Request and response types live in `src/connectors/digio/kra/kra.types.ts` and
  mirror Digio's wire format (snake_case).
- `unique_request_id` is generated (UUID) when not supplied and is also sent as
  the `X_REFERENCE_ID` header unless `opts.referenceId` overrides it.
- PAN is trimmed and upper-cased and must match `AAAAA9999A`; dates must be
  `DD/MM/YYYY`. Violations throw `DigioValidationError` before any network call.
- `fetchDetails` additionally requires `dob` (date of birth, or date of
  incorporation for entities).
- Non-2xx responses and transport failures throw `DigioApiError` carrying
  `httpStatus`, Digio's `code` / `details`, the raw `body`, the `referenceId`
  and the `path`.

Upload note from Digio: since 1 Aug 2025 CVL KRA no longer accepts PAN as proof
of identity. Send `pan_copy: 'N'` and an `app_exmt_id_proof` other than `'01'`
(for example `'02'` for UID).

KRA error codes (`ERR-xxxxx`) are listed at
https://documentation.digio.in/digikyc/kra/error_codes/ and KRA status webhooks
(`KRA.PAN.STATUS.UPDATE`) at https://documentation.digio.in/digikyc/kra/webhooks/;
the webhook payload type is `KraWebhookPayload`.

## HTTP endpoints

`KycModule` exposes the connector over HTTP (bodies in Digio's snake_case):

| Route | Wraps |
| --- | --- |
| `POST /kyc/kra/pan-status` | `checkPanStatus` |
| `POST /kyc/kra/details?deserialize_codes=true` | `fetchDetails` |
| `POST /kyc/kra/upload` | `uploadDetails` |

An optional `X-Reference-Id` header is forwarded to Digio as `X_REFERENCE_ID`.
Errors: local validation -> 400, Digio non-2xx -> 502 (Digio status/code/body
under `digio`), timeout/network -> 504.

## Postman

Import `postman/wmc_pms.postman_collection.json` and
`postman/local.postman_environment.json`. The collection has two folders:
**PMS API (local)** hits this backend; **Digio direct** hits Digio's sandbox
with Basic auth from the `digio_client_id` / `digio_client_secret` variables.

## Scripts

```bash
npm run start:dev   # watch mode
npm run build
npm test            # unit tests
npm run lint
```
