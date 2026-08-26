begin;

-- ============================================================
-- País de la organización y precios por país
--
-- Por qué precio por país y no una conversión automática desde USD:
-- una suscripción recurrente tiene monto fijo en moneda fija. Si el
-- precio se derivara del tipo de cambio, el cobro del cliente cambiaría
-- solo, mes con mes, sin que nadie lo decidiera. Aquí el precio de cada
-- país lo fija una persona y no se mueve hasta que alguien lo cambie.
--
-- El país también determina qué proveedor de pago se usa, porque las
-- cuentas de Mercado Pago son por país y Stripe depende del país de la
-- entidad que factura.
-- ============================================================

-- ------------------------------------------------------------
-- 1. País de la organización
-- ------------------------------------------------------------

alter table public.organizations
  add column if not exists country text;

alter table public.organizations
  drop constraint if exists organizations_country_format;

alter table public.organizations
  add constraint organizations_country_format
  check (country is null or country ~ '^[A-Z]{2}$');

-- ------------------------------------------------------------
-- 2. Precios por plan y país
--
-- La fila con country = '*' es el precio por defecto: se usa cuando no
-- hay una específica para el país de la organización.
-- ------------------------------------------------------------

create table if not exists public.plan_prices (
  plan_id text not null references public.plans(id) on delete cascade,
  country text not null,
  currency text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  provider text,
  provider_price_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, country),
  constraint plan_prices_country_format check (country = '*' or country ~ '^[A-Z]{2}$'),
  constraint plan_prices_provider_valid check (provider is null or provider in ('mercadopago', 'stripe'))
);

alter table public.plan_prices enable row level security;

create trigger plan_prices_set_updated_at
before update on public.plan_prices
for each row execute function public.set_updated_at();

-- Se migra el precio único que existía hoy a la fila por defecto.
insert into public.plan_prices (plan_id, country, currency, amount_cents)
select p.id, '*', p.currency, p.price_amount_cents
from public.plans p
where p.price_amount_cents is not null
on conflict (plan_id, country) do nothing;

-- ------------------------------------------------------------
-- 3. Resolución del precio aplicable
-- ------------------------------------------------------------

create or replace function public.resolve_plan_price(p_plan_id text, p_country text default null)
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
    'provider', pp.provider
  )
  from public.plan_prices pp
  where pp.plan_id = p_plan_id
    and pp.country in (coalesce(upper(p_country), '--'), '*')
  -- El precio específico del país gana sobre el genérico.
  order by case when pp.country = '*' then 1 else 0 end
  limit 1;
$$;

grant execute on function public.resolve_plan_price(text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 4. Catálogo público, ya sensible al país
-- ------------------------------------------------------------

create or replace function public.list_public_plans(p_country text default null)
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
          (precio ->> 'amountCents')::bigint,
          precio ->> 'currency',
          p.billing_interval,
          p.price_label
        ),
        'priceAmountCents', (precio ->> 'amountCents')::bigint,
        'currency', coalesce(precio ->> 'currency', p.currency),
        'billingInterval', p.billing_interval,
        'basicQuota', p.basic_solution_quota,
        'selfServe', p.is_self_serve
      )
      order by p.sort_order
    ),
    '[]'::jsonb
  )
  from public.plans p
  cross join lateral (
    select public.resolve_plan_price(p.id, p_country) as precio
  ) resuelto
  where p.is_self_serve or p.id = 'enterprise';
$$;

grant execute on function public.list_public_plans(text) to anon, authenticated;

-- Se retira la versión sin país para que PostgREST no dude entre dos.
drop function if exists public.list_public_plans();

-- ------------------------------------------------------------
-- 5. País en el alta autoservicio
-- ------------------------------------------------------------

create or replace function public.apply_signup_plan(
  p_organization_id uuid,
  p_plan_id text,
  p_solution_ids text[] default '{}'::text[],
  p_country text default null
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
    jsonb_build_object('plan_id', p_plan_id, 'solutions', p_solution_ids, 'country', p_country)
  );
end;
$$;

revoke all on function public.apply_signup_plan(uuid, text, text[], text) from public, anon;
grant execute on function public.apply_signup_plan(uuid, text, text[], text) to authenticated;

drop function if exists public.apply_signup_plan(uuid, text, text[]);

-- ------------------------------------------------------------
-- 6. Administración de precios y país
-- ------------------------------------------------------------

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
        'currency', pp.currency,
        'amountCents', pp.amount_cents,
        'provider', pp.provider,
        'providerPriceId', pp.provider_price_id
      )
      order by case when pp.country = '*' then 0 else 1 end, pp.country
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

create or replace function public.admin_set_plan_price(
  p_plan_id text,
  p_country text,
  p_currency text,
  p_amount_cents bigint,
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

  insert into public.plan_prices (plan_id, country, currency, amount_cents, provider, provider_price_id)
  values (p_plan_id, v_country, upper(trim(p_currency)), p_amount_cents,
          nullif(trim(coalesce(p_provider, '')), ''), nullif(trim(coalesce(p_provider_price_id, '')), ''))
  on conflict (plan_id, country) do update set
    currency = excluded.currency,
    amount_cents = excluded.amount_cents,
    provider = excluded.provider,
    provider_price_id = excluded.provider_price_id,
    updated_at = now();

  insert into public.audit_logs (actor_user_id, action, target_table, metadata)
  values (
    auth.uid(), 'admin.plan.set_price', 'plan_prices',
    jsonb_build_object('plan_id', p_plan_id, 'country', v_country,
                       'currency', p_currency, 'amount_cents', p_amount_cents)
  );
end;
$$;

revoke all on function public.admin_set_plan_price(text, text, text, bigint, text, text) from public, anon;
grant execute on function public.admin_set_plan_price(text, text, text, bigint, text, text) to authenticated;

create or replace function public.admin_delete_plan_price(p_plan_id text, p_country text)
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
    and country = case when p_country = '*' then '*' else upper(p_country) end;

  insert into public.audit_logs (actor_user_id, action, target_table, metadata)
  values (auth.uid(), 'admin.plan.delete_price', 'plan_prices',
          jsonb_build_object('plan_id', p_plan_id, 'country', p_country));
end;
$$;

revoke all on function public.admin_delete_plan_price(text, text) from public, anon;
grant execute on function public.admin_delete_plan_price(text, text) to authenticated;

create or replace function public.admin_set_organization_country(
  p_organization_id uuid,
  p_country text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_country text := nullif(upper(trim(coalesce(p_country, ''))), '');
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  if v_country is not null and v_country !~ '^[A-Z]{2}$' then
    raise exception 'INVALID_COUNTRY';
  end if;

  update public.organizations
  set country = v_country, updated_at = now()
  where id = p_organization_id;

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (auth.uid(), 'admin.organization.set_country', 'organizations', p_organization_id,
          jsonb_build_object('country', v_country));
end;
$$;

revoke all on function public.admin_set_organization_country(uuid, text) from public, anon;
grant execute on function public.admin_set_organization_country(uuid, text) to authenticated;

-- El listado admin ahora incluye el país de cada organización.
create or replace function public.admin_list_organizations()
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

  -- Igual que la versión anterior, más la columna country. Se conserva
  -- el lateral join: garantiza una sola suscripción por organización
  -- aunque hubiera más de una marcada como vigente.
  select coalesce(jsonb_agg(row_to_json(t) order by t.name), '[]'::jsonb)
  into v_result
  from (
    select
      o.id,
      o.name,
      o.slug,
      o.status::text as status,
      o.country,
      coalesce(s.plan_id, 'sin_plan') as plan_id,
      coalesce(pl.name, 'Sin plan activo') as plan_name,
      coalesce(s.access_status::text, 'pending') as access_status,
      (select count(*) from public.organization_members m where m.organization_id = o.id and m.status = 'active') as member_count,
      (select count(*) from public.organization_feature_overrides ov where ov.organization_id = o.id) as override_count
    from public.organizations o
    left join lateral (
      select subscription.plan_id, subscription.access_status
      from public.subscriptions subscription
      where subscription.organization_id = o.id and subscription.is_current
      order by subscription.updated_at desc
      limit 1
    ) s on true
    left join public.plans pl on pl.id = s.plan_id
  ) t;

  return v_result;
end;
$$;

revoke all on function public.admin_list_organizations() from public, anon;
grant execute on function public.admin_list_organizations() to authenticated;

commit;
