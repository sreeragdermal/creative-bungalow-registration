# Creative Bungalow Registration

A premium mobile-friendly registration website for **ക്രീയേറ്റീവ് ബംഗ്ലാവ്**, Wayanad, November 28–29, 2026.

## Features

- Responsive event landing page and participant form
- ₹2,999 payment instructions and JPEG/PNG screenshot upload (max 5 MB)
- Supabase backend with private screenshot storage
- Capacity enforcement at 100 active registrations
- Branded success page with registration reference
- Private admin login, screenshot review and payment status management
- Manual payment verification; uploaded screenshots are never treated as automatic proof of payment

## Project structure

- `index.html`, `styles.css`, `js/app.js`: public website
- `admin.html`, `js/admin.js`: admin dashboard
- `js/config.js`: public-safe settings (never add secret keys here)
- `supabase/migrations/`: database SQL changes
- `supabase/functions/`: Edge Function source code
- `SETUP.md`: complete setup, configuration, deployment and test guide

## Deployment status

The website source is committed, but public registration is intentionally **disabled** in `js/config.js` until the Supabase Edge Functions, Turnstile, admin membership and end-to-end tests are complete.

## Security

- Never commit Supabase secret/service-role keys, database passwords, participant records, or payment screenshots.
- Keep the `payment-screenshots` Storage bucket private.
- Do not allow anonymous browser access to registration records or screenshot objects.
- Edge Functions must keep the allowed CORS origin restricted to `https://sreeragdermal.github.io`.
- Review the [setup guide](SETUP.md) before going live.

## GitHub Pages

Repository: https://github.com/sreeragdermal/creative-bungalow-registration

Expected site URL after enabling Settings → Pages → Deploy from a branch → `main` → `/ (root)`:

https://sreeragdermal.github.io/creative-bungalow-registration/
