-- Accept the current ₹2,999 registration fee while preserving existing ₹3,000 rows.
alter table public.registrations
  drop constraint if exists registrations_fee_amount_check;

alter table public.registrations
  add constraint registrations_fee_amount_check
  check (fee_amount in (2999, 3000));
