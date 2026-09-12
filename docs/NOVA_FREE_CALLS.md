# NOVA FREE CALL

NOVA FREE CALL is NOVA's no-paid-API internet calling mode. It is separate from Autocalls.

## What it does

- Creates a private, hard-to-guess video meeting room URL.
- Opens the room in Jitsi Meet with camera and microphone.
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

NOVA first uses `call.tumsoev.com` only after that self-hosted route has proved that it can complete a real call. Until the self-hosted server is deployed, the normal fallback is `jitsi.member.fsf.org`, which allows the first participant to create the room without a moderator account.

`meet.jit.si` is emergency-only because its first participant must sign in as a moderator. NOVA never embeds that login flow on iPhone; it shows a Russian explanation and opens it in a top-level browser window so the login popup is not blocked.

Public instances are third-party community services. They are free for reasonable use, but their availability and policies can change. A fully controlled deployment still requires the prepared self-hosted Jitsi server.

## Reliability and speed

- The call module does not run slow provider checks during every NOVA startup.
- A failed self-hosted route switches to the anonymous fallback automatically.
- A connection timeout replaces an endless spinner with a usable recovery action.
- The PWA serves the last verified call modules immediately and refreshes them in the background.

## Safety

Autocalls real telephone calling remains protected by:

```js
const FREE_CALL_LOCK = true;
```

So NOVA FREE CALL cannot silently fall back to a billable Autocalls phone call.
