# NOVA → Autocalls phone calls

NOVA supports the voice/text command **«позвони»** with a mandatory two-step confirmation and a saved choice of the caller number.

## Choose the number to call from

The saved caller number is stored on the current device and reused for later calls.

Useful commands:

- `Нова, покажи номера для звонка`
- `Нова, звони с +19165551234`
- `Нова, какой номер выбран`
- `Нова, сбрось исходящий номер`

NOVA asks the protected backend to verify that the selected number really belongs to the authenticated Autocalls account before saving it locally.

Autocalls' documented `POST /user/make_call` endpoint accepts the destination number and assistant ID, not a separate caller-number field. Therefore, only after the user confirms a real call, the protected backend assigns the saved number to the outbound assistant using:

`PUT /user/assistant/{id}`

with:

```json
{
  "phone_number_id": 123
}
```

Then it starts the call through:

`POST /user/make_call`.

This follows Autocalls' documented model where a number assigned to an assistant is used as the outbound Caller ID.

## User flow

1. Optionally choose and save the caller number: `Нова, звони с +19165551234`.
2. Say or type: `Нова, позвони +19165559876`.
3. NOVA repeats both the destination and the saved caller number.
4. No call is started yet and the assistant number is not changed yet.
5. Say or type: `подтверждаю звонок`.
6. Only then the protected backend validates the confirmation, validates the selected caller number, assigns it to the outbound assistant, and calls `POST /user/make_call`.

Commands `отмена` / `отмени звонок` clear the pending call without starting it.

## Required server-side environment variables

Configure these only in the server host. Never commit them to GitHub:

- `AUTOCALLS_API_KEY` — Autocalls API credential.
- `NOVA_AUTOCALLS_CALL_KEY` — a separate long random owner key used only to protect NOVA's call bridge.
- Optional: `AUTOCALLS_ASSISTANT_ID` — fixed outbound assistant integer ID.
- Optional: `AUTOCALLS_ASSISTANT_NAME`.
- Optional: `NOVA_AUTOCALLS_ALLOWED_ORIGINS` — comma-separated extra web origins.

The client stores only the separate NOVA owner key and the selected non-secret caller number metadata on the user's device. It never receives the Autocalls API key.

## Safety / billing lock

- Selecting a caller number does not start a call.
- A call is impossible from the normal `позвони` command alone.
- The second explicit confirmation is required for every real call.
- Confirmation expires after 90 seconds at the backend.
- The selected caller number is revalidated against `GET /user/phone-numbers/all` before use.
- The assistant's phone-number assignment is changed only inside the confirmed-call path.
- The bridge exposes no SMS, WhatsApp, phone-number purchase, or campaign-start endpoint.
- No real call is made if the backend secrets are not configured.
