# NOVA FREE CALL

NOVA FREE CALL is NOVA's no-paid-API internet calling mode. It is separate from Autocalls.

## What it does

- Creates a private, hard-to-guess audio-only meeting room URL.
- Opens the room in Jitsi Meet.
- The other person joins by opening the same link.
- No Autocalls API key, phone-number purchase, SMS, campaign, or `/user/make_call` endpoint is used.
- The room link is generated locally in the browser and the last room is stored locally on the device.

## Commands

- `Нова, бесплатный звонок`
- `Нова, позвони бесплатно`
- `Нова, интернет-звонок`
- `NOVA free call`

The NOVA home screen also has a **FREE CALL** button.

## Important distinction

This is an **internet call**, not a PSTN/mobile telephone-number call. Calling an arbitrary normal phone number requires a telecom/SIP/PSTN carrier, which can charge termination or per-minute fees.

The default public provider is `meet.jit.si`. Jitsi is open source and the public instance is offered at no charge for reasonable use, but its public service terms may impose usage limits or change. For a fully controlled deployment, NOVA can later point the same feature at a self-hosted Jitsi server.

## Safety

Autocalls real telephone calling remains protected by:

```js
const FREE_CALL_LOCK = true;
```

So NOVA FREE CALL cannot silently fall back to a billable Autocalls phone call.
