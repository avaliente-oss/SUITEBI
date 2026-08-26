begin;

-- ============================================================
-- Tarifa mensual y anual del mismo plan
--
-- Antes la periodicidad vivía en el plan, así que un plan era mensual
-- O anual. Ofrecer ambas obligaba a duplicar el plan, y con él su cupo
-- de soluciones y sus límites — dos cosas que tarde o temprano se
-- desincronizan.
--
-- Ahora la periodicidad es parte del precio: un mismo plan puede tener
-- precio mensual y precio anual, por país. El cupo y los límites siguen
-- siendo del plan, y se definen una sola vez.
-- ============================================================

-- ------------------------------------------------------------
-- 1. La periodicidad entra en la llave del precio
-- ------------------------------------------------------------

alter table public.plan_prices
  add column if not exists billing_interval text not null default 'month';

alter table public.plan_prices
  drop constraint if exists plan_prices_interval_valid;

alter table public.plan_prices
  add constraint plan_prices_interval_valid
  check (billing_interval in ('month', 'year'));

alter table public.plan_prices drop constraint if exists plan_prices_pkey;
alter table public.plan_prices add primary key (plan_id, country, billing_interval);

-- ------------------------------------------------------------
-- 2. La suscripción recuerda qué periodicidad se contrató
-- ------------------------------------------------------------

alter table public.subscriptions
  add column if not exists billing_interval text not null default 'month';

alter table public.subscriptions
  drop constraint if exists subscriptions_interval_valid;

alter table public.subscriptions
  add constraint subscriptions_interval_valid
  check (billing_interval in ('month', 'year'));

-- ------------------------------------------------------------
-- 3. Resolución del precio, ya con periodicidad
-- ------------------------------------------------------------

create or replace function public.resolve_plan_price(
  p_plan_id text,
  p_country text default null,
  p_interval text default 'month'
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'currency', pp.currency,
    'amountCents', pp.amount_cents,
    'country', pp.country,
    'billingInterval', pp.billing_interval,
    'provider', pp.provider
  )
  from public.plan_prices pp
  where pp.plan_id = p_plan_id
    and pp.billing_interval = coalesce(p_interval, 'month')
    and pp.country in (coalesce(upper(p_country), '--'), '*')
  order by case when pp.country = '*' then 1 else 0 end
  limit 1;
$$;

grant execute on function public.resolve_plan_price(text, text, text) to anon, authenticated;

drop function if exists public.resolve_plan_price(text, text);

-- ------------------------------------------------------------
-- 4. Catálogo público: devuelve TODAS las periodicidades disponibles
--
-- Así la pantalla puede ofrecer el interruptor mensual/anual sin volver
-- a consultar, y mostrar cuánto se ahorra al año.
-- ------------------------------------------------------------

create or replace function public.list_public_plans(
  p_country text default null,
  p_interval text default 'month'
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'description', p.description,
        'tagline', p.tagline,
        'priceLabel', public.format_plan_price(
          (elegido ->> 'amountCents')::bigint,
          elegido ->> 'currency',
          coalesce(p_interval, 'month'),
          p.price_label
        ),
        'priceAmountCents', (elegido ->> 'amountCents')::bigint,
        'currency', coalesce(elegido ->> 'currency', p.currency),
        'billingInterval', coalesce(p_interval, 'month'),
        'basicQuota', p.basic_solution_quota,
        'selfServe', p.is_self_serve,
        -- Todas las tarifas del plan para ese país, para poder comparar.
        'prices', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'billingInterval', x.billing_interval,
              'currency', x.currency,
              'amountCents', x.amount_cents,
              'label', public.format_plan_price(x.amount_cents, x.currency, x.billing_interval, '')
            )
            order by x.billing_interval desc
          )
          from (
            select distinct on (pp.billing_interval)
              pp.billing_interval, pp.currency, pp.amount_cents
            from public.plan_prices pp
            where pp.plan_id = p.id
              and pp.country in (coalesce(upper(p_country), '--'), '*')
            order by pp.billing_interval, case when pp.country = '*' then 1 else 0 end
          ) x
        ), '[]'::jsonb)
      )
      order by p.sort_order
    ),
    '[]'::jsonb
  )
  from public.plans p
  cross join lateral (
    select public.resolve_plan_price(p.id, p_country, p_interval) as elegido
  ) resuelto
  where p.is_self_serve or p.id = 'enterprise';
$$;

grant execute on function public.list_public_plans(text, text) to anon, authenticated;

drop function if exists public.list_public_plans(text);

-- ------------------------------------------------------------
-- 5. Alta y administración con periodicidad
-- ------------------------------------------------------------

create or replace function public.admin_set_plan_price(
  p_plan_id text,
  p_country text,
  p_currency text,
  p_amount_cents bigint,
  p_billing_interval text default 'month',
  p_provider text default null,
  p_provider_price_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_country text := case when trim(coalesce(p_country, '')) = '*' then '*' else upper(trim(coalesce(p_country, ''))) end;
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  if v_country <> '*' and v_country !~ '^[A-Z]{2}$' then
    raise exception 'INVALID_COUNTRY';
  end if;

  if p_amount_cents is null or p_amount_cents < 0 then
    raise exception 'INVALID_PRICE';
  end if;

  if p_billing_interval not in ('month', 'year') then
    raise exception 'INVALID_INTERVAL';
  end if;

  insert into public.plan_prices (
    plan_id, country, billing_interval, currency, amount_cents, provider, provider_price_id
  )
  values (
    p_plan_id, v_country, p_billing_interval, upper(trim(p_currency)), p_amount_cents,
    nullif(trim(coalesce(p_provider, '')), ''), nullif(trim(coalesce(p_provider_price_id, '')), '')
  )
  on conflict (plan_id, country, billing_interval) do update set
    currency = excluded.currency,
    amount_cents = excluded.amount_cents,
    provider = excluded.provider,
    provider_price_id = excluded.provider_price_id,
    updated_at = now();

  insert into public.audit_logs (actor_user_id, action, target_table, metadata)
  values (
    auth.uid(), 'admin.plan.set_price', 'plan_prices',
    jsonb_build_object('plan_id', p_plan_id, 'country', v_country,
                       'interval', p_billing_interval, 'currency', p_currency,
                       'amount_cents', p_amount_cents)
  );
end;
$$;

revoke all on function public.admin_set_plan_price(text, text, text, bigint, text, text, text) from public, anon;
grant execute on function public.admin_set_plan_price(text, text, text, bigint, text, text, text) to authenticated;

drop function if exists public.admin_set_plan_price(text, text, text, bigint, text, text);

create or replace function public.admin_list_plan_prices(p_plan_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'country', pp.country,
        'billingInterval', pp.billing_interval,
        'currency', pp.currency,
        'amountCents', pp.amount_cents,
        'label', public.format_plan_price(pp.amount_cents, pp.currency, pp.billing_interval, ''),
        'provider', pp.provider,
        'providerPriceId', pp.provider_price_id
      )
      order by case when pp.country = '*' then 0 else 1 end, pp.country, pp.billing_interval desc
    ),
    '[]'::jsonb
  )
  into v_result
  from public.plan_prices pp
  where pp.plan_id = p_plan_id;

  return v_result;
end;
$$;

revoke all on function public.admin_list_plan_prices(text) from public, anon;
grant execute on function public.admin_list_plan_prices(text) to authenticated;

create or replace function public.admin_delete_plan_price(
  p_plan_id text,
  p_country text,
  p_billing_interval text default 'month'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  delete from public.plan_prices
  where plan_id = p_plan_id
    and country = case when p_country = '*' then '*' else upper(p_country) end
    and billing_interval = p_billing_interval;

  insert into public.audit_logs (actor_user_id, action, target_table, metadata)
  values (auth.uid(), 'admin.plan.delete_price', 'plan_prices',
          jsonb_build_object('plan_id', p_plan_id, 'country', p_country, 'interval', p_billing_interval));
end;
$$;

revoke all on function public.admin_delete_plan_price(text, text, text) from public, anon;
grant execute on function public.admin_delete_plan_price(text, text, text) to authenticated;

drop function if exists public.admin_delete_plan_price(text, text);

-- ------------------------------------------------------------
-- 6. El alta autoservicio guarda la periodicidad elegida
-- ------------------------------------------------------------

create or replace function public.apply_signup_plan(
  p_organization_id uuid,
  p_plan_id text,
  p_solution_ids text[] default '{}'::text[],
  p_country text default null,
  p_billing_interval text default 'month'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.plans%rowtype;
  v_count integer;
begin
  if not public.has_organization_permission(p_organization_id, 'plan.change') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select * into v_plan from public.plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'PLAN_NOT_FOUND';
  end if;

  if p_billing_interval not in ('month', 'year') then
    raise exception 'INVALID_INTERVAL';
  end if;

  v_count := coalesce(array_length(p_solution_ids, 1), 0);
  if v_plan.basic_solution_quota is not null and v_count > v_plan.basic_solution_quota then
    raise exception 'QUOTA_EXCEEDED';
  end if;

  if p_country is not null and upper(p_country) ~ '^[A-Z]{2}$' then
    update public.organizations
    set country = upper(p_country), updated_at = now()
    where id = p_organization_id;
  end if;

  update public.subscriptions
  set plan_id = p_plan_id,
      billing_interval = p_billing_interval,
      access_status = case when v_plan.is_self_serve then access_status else 'pending' end,
      updated_at = now()
  where organization_id = p_organization_id and is_current;

  if not v_plan.is_self_serve then
    update public.organizations
    set metadata = metadata || jsonb_build_object('requested_plan', p_plan_id),
        updated_at = now()
    where id = p_organization_id;
  end if;

  if v_count > 0 then
    insert into public.organization_solutions (organization_id, solution_id, selected_by)
    select p_organization_id, sid, auth.uid()
    from unnest(p_solution_ids) as sid
    where exists (
      select 1 from public.solutions s
      where s.id = sid and s.is_active and s.pricing_type = 'basic'
    )
    on conflict do nothing;
  end if;

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'organization.signup_plan', 'organizations', p_organization_id,
    jsonb_build_object('plan_id', p_plan_id, 'solutions', p_solution_ids,
                       'country', p_country, 'interval', p_billing_interval)
  );
end;
$$;

revoke all on function public.apply_signup_plan(uuid, text, text[], text, text) from public, anon;
grant execute on function public.apply_signup_plan(uuid, text, text[], text, text) to authenticated;

drop function if exists public.apply_signup_plan(uuid, text, text[], text);

commit;
