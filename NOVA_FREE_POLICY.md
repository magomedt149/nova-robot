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

Current policy version: **NOVA 27.2.0**
