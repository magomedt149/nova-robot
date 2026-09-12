# NOVA → Autocalls: FREE CALL LOCK

NOVA is configured so **no Autocalls phone call can create a charge**.

## Important limitation

Autocalls real phone calls are usage-billed. The official Autocalls documentation also states that Caller ID has per-minute charges and SIP has AI-bridge/carrier costs. Therefore NOVA cannot honestly turn a real PSTN/telephone call into a guaranteed free call.

To satisfy NOVA FREE LOCK, the protected backend now hard-blocks every `make_call` action. It does **not** send `POST /user/make_call`.

## Commands

- `Нова, позвони +19165551234` → NOVA explains that the real phone call is blocked by FREE CALL LOCK. Nothing is charged.
- `подтверждаю звонок` → still cannot override FREE CALL LOCK; nothing is charged.
- `Нова, бесплатный тест Autocalls` → runs an Autocalls `type: "test"` development conversation. This is free according to Autocalls documentation, but **it is not a telephone call and does not dial a phone number**.
- Number-list and caller-number selection commands remain available for configuration, but they do not initiate a call and do not change the assistant's caller number while FREE CALL LOCK is active.

## Backend guarantee

`netlify/functions/autocalls-call.js` contains:

```js
const FREE_CALL_LOCK = true;
```

For `action: "make_call"`, it returns a blocked response before any telephony endpoint can be called.

The only Autocalls interaction that represents a free conversation is:

```json
{
  "assistant_id": "<assistant-uuid>",
  "type": "test"
}
```

## Secrets

The backend still uses:

- `AUTOCALLS_API_KEY`
- `NOVA_AUTOCALLS_CALL_KEY`

These remain server-side and are never embedded in the public NOVA client.

## Safety

- No `/user/make_call` execution.
- No SMS.
- No WhatsApp send.
- No phone-number purchase.
- No paid campaign start.
- No override phrase can bypass FREE CALL LOCK.
