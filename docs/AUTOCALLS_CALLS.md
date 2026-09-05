# NOVA → Autocalls phone calls

NOVA supports the voice/text command **«позвони»** with a mandatory two-step confirmation.

## User flow

1. Say or type: `Нова, позвони +19165551234`.
2. NOVA normalizes and repeats the number.
3. No call is started yet.
4. Say or type: `подтверждаю звонок`.
5. Only then NOVA sends the request to the protected server-side bridge.
6. The bridge discovers an active outbound Autocalls assistant (or uses `AUTOCALLS_ASSISTANT_ID`) and calls:
   `POST https://app.autocalls.ai/api/user/make_call`.

Commands `отмена` / `отмени звонок` clear the pending call.

## Required server-side environment variables

Configure these only in the server host. Never commit them to GitHub:

- `AUTOCALLS_API_KEY` — Autocalls API credential.
- `NOVA_AUTOCALLS_CALL_KEY` — a separate long random owner key used only to protect NOVA's call bridge.
- Optional: `AUTOCALLS_ASSISTANT_ID` — fixed outbound assistant integer ID.
- Optional: `AUTOCALLS_ASSISTANT_NAME`.
- Optional: `NOVA_AUTOCALLS_ALLOWED_ORIGINS` — comma-separated extra web origins.

The client stores only the separate NOVA owner key on the user's device. It never receives the Autocalls API key.

## Safety / billing lock

- A call is impossible from the normal command alone.
- The second explicit confirmation is required.
- Confirmation expires after 90 seconds at the backend.
- The bridge exposes no SMS, WhatsApp, phone-number purchase, or campaign-start endpoint.
- No real call is made if the backend secrets are not configured.
