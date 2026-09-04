# NOVA FREE LOCK

NOVA 27.2 uses a free-only default policy.

## Permanent rules

- Local/browser execution is always preferred.
- Paid APIs are disabled by default.
- Saved Remote GPU URL/token never starts compute automatically.
- Text commands never auto-submit Remote GPU jobs.
- Full Auto GPU and automatic Remote GPU recovery are disabled.
- Every manual Remote GPU submit, test, or recovery requires an explicit on-screen confirmation.
- Netlify production deploys only when `.netlify-release` changes.
- Netlify Deploy Preview and branch deploys are skipped automatically.
- GitHub Actions workflows are manual-only; ordinary pushes do not start runners.
- A paid deploy, paid API, credit-consuming render, or other billable action must not be started without the owner's explicit permission.

Current policy version: **NOVA 27.2.1**

## Runtime automation

- NOVA 27.2.1 includes `nova-free-runtime.js`.
- Old FULL AUTO / Auto Recovery flags are repaired to OFF on startup and when returning to the app.
- Automatic update checks run only on free static hosts such as GitHub Pages; they are disabled on `*.netlify.app`.
- On Netlify, the Service Worker uses cache-first for same-origin static files to reduce web requests and bandwidth.
- Notebook translation and YouTube tools use local virtual routes under `/__nova_free__/`.
- Automatic fallback to Netlify Functions is disabled in FREE mode.
- A local command such as “диагностика NOVA” reports FREE LOCK/PWA/network status without a network request.
- GitHub Pages is prepared for zero-build branch publishing with `.nojekyll`.
