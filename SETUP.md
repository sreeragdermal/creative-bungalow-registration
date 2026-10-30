# Creative Bungalow — setup and deployment

This project uses GitHub Pages for the public static frontend and Supabase for the database, private payment screenshots and administrator review.

**Registrations are deliberately disabled initially.** Do not set `registrationEnabled` to `true` or promote the site until all backend configuration and checks are complete.

## Files in this repository

- `index.html`, `styles.css`, `js/app.js`: public event page and form.
- `admin.html`, `js/admin.js`: administrator login and payment review UI.
- `js/config.js`: public Supabase URL, publishable key, Turnstile site key, event settings.
- `supabase/migrations/20261029000000_registration_capacity.sql`: atomic capacity function.
- `supabase/functions/submit-registration/index.ts`: validates the form, verifies Turnstile, uploads the image privately, and calls the capacity function.
- `supabase/functions/admin-registration-action/index.ts`: checks the Supabase session and admin membership before listing records, creating short-lived screenshot links, and updating payment status.

## 1. Database function

The original two tables and RLS policies were created in Supabase SQL Editor. To add the atomic limit:

1. Open this repository file: `supabase/migrations/20261029000000_registration_capacity.sql`.
2. Copy its full SQL into Supabase → SQL Editor → New query.
3. Run it once and confirm it reports success.

This function obtains a transaction-scoped advisory lock, counts non-cancelled registrations and inserts under the same database transaction. It returns an error after the 100th active place is reached. Only the privileged `service_role` can execute it; do not grant it to `anon` or `authenticated`.

If SQL reports an error, stop and review it instead of loosening the permissions.

## 2. Configure Cloudflare Turnstile

The form requires server-verified anti-spam protection.

1. Create a Turnstile widget in the Cloudflare dashboard.
2. Allow the hostname `sreeragdermal.github.io`.
3. Copy its **site key** into `turnstileSiteKey` in `js/config.js`.
4. Keep the **secret key** private. In Supabase → Edge Functions → Secrets, set:
   - `TURNSTILE_SECRET_KEY` = your Turnstile secret key.
   - `ALLOWED_ORIGINS` = `https://sreeragdermal.github.io`

Do not put the Turnstile secret in GitHub. Do not add a wildcard origin.

## 3. Publishable key

Open Supabase → Project Settings → API Keys and copy the **publishable** key (normally starts with `sb_publishable_`). Put it into `supabasePublishableKey` in `js/config.js`.

A publishable key is intended for public browser code, but it is only safe with correctly configured database permissions. Never put a Supabase secret key, service-role key, or database password in this repository.

The project URL is already configured in `js/config.js`; verify it matches the Supabase project where the tables and bucket were created.

## 4. Keep storage private

The `payment-screenshots` bucket must stay private. It is expected to have no public read/upload policies because server-side functions use the managed Supabase secret for file operations. The admin function creates signed screenshot URLs for five minutes, and only after it verifies the signed-in user's admin membership.

Do not make this bucket public. Do not give the public browser role permission to read registration rows or the screenshot bucket.

## 5. Deploy the Edge Functions

Deploy these names exactly:

- `submit-registration` from `supabase/functions/submit-registration/index.ts`
- `admin-registration-action` from `supabase/functions/admin-registration-action/index.ts`

You can open Edge Functions in the Supabase dashboard, deploy each function, and paste the matching source file. If deploying through the dashboard editor, set **Verify JWT** to OFF for these two functions because they perform their own request checks:
- `submit-registration` requires the exact allowed Origin and a valid server-verified Turnstile token.
- `admin-registration-action` validates the user's Supabase Auth bearer token and requires an entry in `registration_admins`.

The Edge Functions use Supabase-managed `SUPABASE_URL`, `SUPABASE_SECRET_KEYS` (key name `default`), and `SUPABASE_PUBLISHABLE_KEYS` environment variables when available, with legacy key fallbacks. Never add a secret value to `js/config.js`.

After deployment, inspect logs for errors, but do not share logs if they contain personal data or tokens.

## 6. Create your administrator

1. In Supabase → Authentication → Users, create an administrator account using an email address you control and a strong password.
2. Copy that user's UUID from the user details.
3. In SQL Editor, run the following after replacing the placeholder with the exact UUID:
   ```sql
   insert into public.registration_admins (user_id)
   values ('REPLACE_WITH_ADMIN_AUTH_USER_UUID')
   on conflict (user_id) do nothing;
   ```
4. Do not add a public sign-up form. Only add trusted admins to this table.

## 7. Enable GitHub Pages

1. Open the repository Settings → Pages.
2. Choose **Deploy from a branch**.
3. Select `main` and the `/ (root)` folder, then save.
4. Wait for GitHub Pages to publish:
   `https://sreeragdermal.github.io/creative-bungalow-registration/`

GitHub Pages hosts the HTML/CSS/JavaScript only; it does not run the Edge Functions.

## 8. Test before opening registration

- Confirm the landing page loads over HTTPS with no console errors.
- Confirm `admin.html` rejects signed-in users who are not in `registration_admins`.
- Create one labelled test registration in a controlled test run. Confirm the record exists, the screenshot is in the private bucket and payment status is `pending`.
- Confirm anonymous browser requests cannot select registration rows, list screenshots or download a screenshot without a short-lived signed URL.
- Confirm the admin dashboard can view the test screenshot and mark payment verified/rejected.
- Confirm an attempted 101st active registration gets rejected by the database function.
- Delete test records and test screenshots before launch if they should not remain.
- Review the Supabase Security Advisor before launch.

Only when these checks have passed, update `registrationEnabled: false` to `registrationEnabled: true` in `js/config.js` and commit it. This is the final switch that opens the public form.

## Event settings currently shown

- Event: `ക്രീയേറ്റീവ് ബംഗ്ലാവ്`
- Dates: November 28–29, 2026
- Venue: Wayanad, Kerala
- Registration fee: ₹2,999
- Capacity: 100
- UPI ID in current config: `dummy@okicici`

Replace the UPI ID if the real payment account differs before launch.
