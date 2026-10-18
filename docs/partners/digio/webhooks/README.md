# Digio webhooks (from documentation.digio.in/webhooks)

- Delivered as HTTP POST JSON; Digio treats the event as delivered on a `200` within 10 seconds, otherwise retries (at-least-once; duplicates possible).
- Payload structure: `{ id, event, entities: [...], payload: { <entity>: {...} } }`. `id` is the unique notification id to use for idempotency.
- Authentication: header `X-Digio-Checksum` = HMAC-SHA256 hex of the raw payload using the account-level webhook secret (different for sandbox and production). Optional IP allow-listing.
- Queue is per account; any failing endpoint blocks all events, so always acknowledge after durable insert.
- KRA event: `KRA.PAN.STATUS.UPDATE` with entity `kra_register` (see digikyc/kra/webhooks).
- DigiStudio events (digistudio/integration/webhooks): request created, approval requested, approved, rejected, failed, expired, action completed, action re-requested, documents pulled. We re-fetch status via `POST /client/kyc/v2/{id}/response` on every event rather than trusting the payload.
