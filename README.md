# Creative Bungalow Registration

A mobile-friendly registration website for the Creative Bungalow event in Wayanad, December 5–6.

## Project status

- Frontend: GitHub Pages (static HTML/CSS/JavaScript)
- Database and private file storage: Supabase
- Registration fee: ₹3,000
- Capacity: 100 participants
- Payment status: pending until manually verified

## Security notes

- Never commit Supabase service-role keys, secret keys, database passwords, participant data, or payment screenshots.
- Payment screenshots must remain in a private Supabase Storage bucket.
- Do not enable public access to registration rows or uploaded payment files.
- Before accepting live registrations, configure and test the secure server-side submission function, atomic capacity limit, admin authentication, and storage access controls.

## GitHub Pages

After the frontend files are added, enable GitHub Pages in Settings → Pages and deploy from the `main` branch.
