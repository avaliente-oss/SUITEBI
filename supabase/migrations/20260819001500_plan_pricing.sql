begin;

-- ============================================================
-- Precios de los planes
--
-- Primera fase del cobro en línea: definir cuánto cuesta cada plan y
-- mostrarlo, sin depender todavía de ningún proveedor de pago.
--
-- El monto se guarda en la unidad mínima de la moneda (centavos), que
-- es como lo manejan Stripe y Mercado Pago. Así no hay redondeos al
-- convertir cuando llegue la fase de cobro.
--
-- Los identificadores de proveedor quedan declarados desde ahora para
-- que la fase 2 no tenga que volver a migrar la tabla; hoy van vacíos.
-- ============================================================

alter table public.plans
  add column if not exists price_amount_cents bigint,
  add column if not exists currency text not null default 'MXN',
  add column if not exists billing_interval text not null default 'month',
  add column if not exists stripe_price_id text,
  add column if not exists mercadopago_plan_id text;

alter table public.plans
  drop constraint if exists plans_billing_interval_valid;

alter table public.plans
  add constraint plans_billing_interval_valid
  check (billing_interval in ('month', 'year'));

alter table public.plans
  drop constraint if exists plans_price_non_negative;

alter table public.plans
  add constraint plans_price_non_negative
  check (price_amount_cents is null or price_amount_cents >= 0);

-- El plan gratuito tiene precio cero explícito, no "sin definir".
update public.plans set price_amount_cents = 0 where id = 'free' and price_amount_cents is null;

-- ------------------------------------------------------------
-- Texto de precio derivado
--
-- Si hay monto, se arma solo ("$499 MXN / mes"). price_label sigue
-- existiendo para los casos sin cifra, como Enterprise ("Hablemos").
-- ------------------------------------------------------------

create or replace function public.format_plan_price(
  p_amount_cents bigint,
  p_currency text,
  p_interval text,
  p_fallback text
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_amount_cents is null then coalesce(nullif(p_fallback, ''), 'Consulta precio')
    when p_amount_cents = 0 then 'Sin costo'
    else
      '$' ||
      to_char(p_amount_cents / 100.0, 'FM999G999G990D00') ||
      ' ' || upper(coalesce(p_currency, 'MXN')) ||
      case when p_interval = 'year' then ' / año' else ' / mes' end
  end;
$$;

grant execute on function public.format_plan_price(bigint, text, text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- Catálogo público con precio real
-- ------------------------------------------------------------

create or replace function public.list_public_plans()
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
          p.price_amount_cents, p.currency, p.billing_interval, p.price_label
        ),
        'priceAmountCents', p.price_amount_cents,
        'currency', p.currency,
        'billingInterval', p.billing_interval,
        'basicQuota', p.basic_solution_quota,
        'selfServe', p.is_self_serve
      )
      order by p.sort_order
    ),
    '[]'::jsonb
  )
  from public.plans p
  where p.is_self_serve or p.id = 'enterprise';
$$;

grant execute on function public.list_public_plans() to anon, authenticated;

-- ------------------------------------------------------------
-- Panel admin: ver y editar el precio
-- ------------------------------------------------------------

create or replace function public.admin_list_plans_detailed()
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
        'id', p.id,
        'name', p.name,
        'description', coalesce(p.description, ''),
        'tagline', p.tagline,
        'priceLabel', p.price_label,
        'priceDisplay', public.format_plan_price(
          p.price_amount_cents, p.currency, p.billing_interval, p.price_label
        ),
        'priceAmountCents', p.price_amount_cents,
        'currency', p.currency,
        'billingInterval', p.billing_interval,
        'basicQuota', p.basic_solution_quota,
        'selfServe', p.is_self_serve,
        'sortOrder', p.sort_order,
        'organizations', (
          select count(*) from public.subscriptions s
          where s.plan_id = p.id and s.is_current
        )
      )
      order by p.sort_order, p.id
    ),
    '[]'::jsonb
  )
  into v_result
  from public.plans p;

  return v_result;
end;
$$;

revoke all on function public.admin_list_plans_detailed() from public, anon;
grant execute on function public.admin_list_plans_detailed() to authenticated;

create or replace function public.admin_upsert_plan(
  p_id text,
  p_name text,
  p_description text,
  p_tagline text,
  p_price_label text,
  p_basic_quota integer,
  p_is_self_serve boolean,
  p_sort_order integer,
  p_price_amount_cents bigint default null,
  p_currency text default 'MXN',
  p_billing_interval text default 'month'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id text := lower(trim(coalesce(p_id, '')));
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  if v_id !~ '^[a-z0-9][a-z0-9_-]*$' then
    raise exception 'INVALID_PLAN_ID';
  end if;

  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'NAME_REQUIRED';
  end if;

  if p_basic_quota is not null and p_basic_quota < 0 then
    raise exception 'INVALID_QUOTA';
  end if;

  if p_price_amount_cents is not null and p_price_amount_cents < 0 then
    raise exception 'INVALID_PRICE';
  end if;

  if p_billing_interval not in ('month', 'year') then
    raise exception 'INVALID_INTERVAL';
  end if;

  insert into public.plans (
    id, name, description, tagline, price_label,
    basic_solution_quota, is_self_serve, sort_order,
    price_amount_cents, currency, billing_interval
  ) values (
    v_id, trim(p_name), coalesce(p_description, ''), coalesce(p_tagline, ''),
    coalesce(p_price_label, ''), p_basic_quota, coalesce(p_is_self_serve, true),
    coalesce(p_sort_order, 100),
    p_price_amount_cents, upper(coalesce(p_currency, 'MXN')), p_billing_interval
  )
  on conflict (id) do update set
    name = excluded.name,
    description = excluded.description,
    tagline = excluded.tagline,
    price_label = excluded.price_label,
    basic_solution_quota = excluded.basic_solution_quota,
    is_self_serve = excluded.is_self_serve,
    sort_order = excluded.sort_order,
    price_amount_cents = excluded.price_amount_cents,
    currency = excluded.currency,
    billing_interval = excluded.billing_interval,
    updated_at = now();

  insert into public.audit_logs (actor_user_id, action, target_table, metadata)
  values (
    auth.uid(), 'admin.plan.upsert', 'plans',
    jsonb_build_object('id', v_id, 'price_amount_cents', p_price_amount_cents, 'currency', p_currency)
  );
end;
$$;

revoke all on function public.admin_upsert_plan(text, text, text, text, text, integer, boolean, integer, bigint, text, text) from public, anon;
grant execute on function public.admin_upsert_plan(text, text, text, text, text, integer, boolean, integer, bigint, text, text) to authenticated;

-- Se retira la firma de 8 parámetros para que PostgREST no tenga que
-- elegir entre dos versiones.
drop function if exists public.admin_upsert_plan(text, text, text, text, text, integer, boolean, integer);

commit;
