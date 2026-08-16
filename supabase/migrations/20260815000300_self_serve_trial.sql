begin;

create or replace function public.start_trial_subscription_for_new_organization()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.created_by is not null then
    insert into public.subscriptions (
      organization_id,
      plan_id,
      is_current,
      access_status,
      current_period_start,
      trial_ends_at
    )
    values (
      new.id,
      'starter',
      true,
      'trial',
      now(),
      now() + interval '14 days'
    )
    on conflict (organization_id) where is_current do nothing;
  end if;

  return new;
end;
$$;

create trigger organizations_start_trial_subscription
after insert on public.organizations
for each row execute function public.start_trial_subscription_for_new_organization();

commit;
