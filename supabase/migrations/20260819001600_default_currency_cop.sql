begin;

-- ============================================================
-- Moneda por defecto: peso colombiano
--
-- La entidad que factura está en Colombia, así que los precios se
-- capturan en COP salvo indicación contraria. Los planes existentes
-- todavía no tienen monto definido (sólo 'free' en cero), así que el
-- cambio no reetiqueta ningún precio ya publicado.
-- ============================================================

alter table public.plans alter column currency set default 'COP';

update public.plans
set currency = 'COP', updated_at = now()
where price_amount_cents is null or price_amount_cents = 0;

-- Mismo criterio para el parámetro por defecto del alta de planes.
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
  p_currency text default 'COP',
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
    p_price_amount_cents, upper(coalesce(p_currency, 'COP')), p_billing_interval
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

commit;
