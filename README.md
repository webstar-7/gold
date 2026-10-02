# gold

NYANSATEK Gold Dealership — multi-tenant, Supabase-backed app for gold
buying/dealership operations (purchases, dispatches, cash float,
sellers, staff, pricing by karat).

- `index.html` + `app.js` — the app. Signs in with real Supabase Auth
  and talks to a dedicated Gold Supabase project (its own tenant data,
  isolated by Row Level Security — not shared with POS or School).
- `supabase/functions/create-staff/` — the edge function that lets a
  dealership owner add staff logins without the service role key ever
  touching the browser. Deployed to the live Gold Supabase project.

Sold and provisioned through nyansatek.systems (Paystack checkout →
automatic account creation), the same pipeline as NYANSATEK POS and
School.
