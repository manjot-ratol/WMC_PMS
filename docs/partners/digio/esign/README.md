# Digio eSign (DigiSign) — extracted from documentation.digio.in/digisign (2026-10-18)

- Create sign request: `POST /v2/client/document/uploadpdf` (`post_uploadPdfFile.min.json`): `file_name`, `file_data` (base64 PDF), `signers[{identifier, name, reason, sign_type, signature_mode}]`, `expire_in_days`, `display_on_page`, `generate_access_token`, `reference_id`, `custom_reference`, `notify_signers`. Response: `id` (DID…), `agreement_status` (`draft|requested|completed|expired|failed`), `signing_parties[{identifier,status}]` with status `requested|signed|expired|sequenced|cancelled|removed|failed|skipped`, `access_token{id, validTill}` for the SDK.
- Document details: `GET /v2/client/document/{docId}` (`get_getDocumentObject.min.json`), same shape.
- Download signed PDF: `GET /v2/client/document/download?document_id=DID…` (`get_downloadDocument.min.json`), binary.
- Cancel: `POST /v2/client/document/{docId}/cancel` (`post_cancelSignRequest.min.json`).
- Webhooks: events `DOC.SIGNED`, `DOC.SIGN.REJECTED`, `DOC.SIGN.FAILED` through the account-level webhook endpoint (`X-Digio-Checksum`); the payload carries the document object with its `id`. We re-fetch the document on every event rather than trusting the payload.
- Auth: HTTP Basic (client id / secret); sandbox `https://ext.digio.in:444`.
