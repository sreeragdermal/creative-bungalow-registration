-- Update the server-enforced registration fee to ₹3,499 for new registrations.
-- Existing participant records retain their recorded fee amounts.
create or replace function public.create_registration_with_capacity(
  p_full_name text,
  p_mobile text,
  p_place text,
  p_email text,
  p_designation text,
  p_experience text,
  p_work_mode text,
  p_attended_previous_season boolean,
  p_payment_screenshot_path text,
  p_fee_amount integer default 3499
)
returns table (id uuid, registration_code text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_active_count integer;
begin
  if p_fee_amount <> 3499 then
    raise exception using message = 'INVALID_FEE_AMOUNT', errcode = '22023';
  end if;

  if p_work_mode not in ('Freelance', 'On-site') then
    raise exception using message = 'INVALID_WORK_MODE', errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('creative-bungalow-registration-capacity')
  );

  select pg_catalog.count(*)::integer
    into v_active_count
    from public.registrations r
    where r.registration_status <> 'cancelled';

  if v_active_count >= 100 then
    raise exception using message = 'REGISTRATION_CAPACITY_REACHED', errcode = 'P0001';
  end if;

  return query
    insert into public.registrations as r (
      full_name, mobile, place, email, designation, experience,
      work_mode, attended_previous_season, fee_amount,
      payment_screenshot_path, payment_status, registration_status
    )
    values (
      p_full_name, p_mobile, p_place, p_email, p_designation, p_experience,
      p_work_mode, p_attended_previous_season, 3499,
      p_payment_screenshot_path, 'pending', 'submitted'
    )
    returning r.id, r.registration_code;
end;
$function$;

revoke all on function public.create_registration_with_capacity(
  text, text, text, text, text, text, text, boolean, text, integer
) from public, anon, authenticated;

grant execute on function public.create_registration_with_capacity(
  text, text, text, text, text, text, text, boolean, text, integer
) to service_role;

alter table public.registrations
  drop constraint if exists registrations_fee_amount_check;

alter table public.registrations
  add constraint registrations_fee_amount_check
  check (fee_amount in (2999, 3000, 3499));
