begin;

-- ============================================================
-- Cimientos del cobro recurrente
--
-- El problema de diseño que resuelve esta migración: un webhook de
-- Mercado Pago llega al servidor SIN sesión de usuario, y aun así tiene
-- que poder cambiar el estado de una suscripción. Las dos salidas
-- habituales son malas:
--
--   · Usar la llave service_role: puede leer y escribir TODAS las
--     tablas, saltándose RLS por completo. Un error ahí lo expone todo.
--   · Abrir una función a anon: cualquiera podría fabricar el estado de
--     su propia suscripción y darse acceso gratis.
--
-- Solución: una función con secreto compartido. El secreto vive en
-- platform_secrets, una tabla con RLS y sin políticas — sólo funciones
-- security definer pueden leerla, nadie más, ni siquiera con la llave
-- anon. La ruta del webhook manda ese secreto desde su variable de
-- entorno. El alcance queda limitado a lo que esta función hace, en vez
-- de a toda la base.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Secretos de plataforma
-- ------------------------------------------------------------

create table if not exists public.platform_secrets (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_secrets enable row level security;
-- Sin políticas a propósito: la tabla es invisible salvo desde funciones
-- security definer.

create trigger platform_secrets_set_updated_at
before update on public.platform_secrets
for each row execute function public.set_updated_at();

create or replace function public.admin_set_platform_secret(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_value, ''))) < 16 then
    raise exception 'SECRET_TOO_SHORT';
  end if;

  insert into public.platform_secrets (key, value)
  values (trim(p_key), p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now();

  -- Se registra el cambio, nunca el valor.
  insert into public.audit_logs (actor_user_id, action, target_table, metadata)
  values (auth.uid(), 'admin.secret.set', 'platform_secrets', jsonb_build_object('key', p_key));
end;
$$;

revoke all on function public.admin_set_platform_secret(text, text) from public, anon;
grant execute on function public.admin_set_platform_secret(text, text) to authenticated;

-- ------------------------------------------------------------
-- 2. Datos del proveedor en la suscripción
-- ------------------------------------------------------------

alter table public.subscriptions
  add column if not exists provider text,
  add column if not exists provider_subscription_id text,
  add column if not exists provider_status text;

alter table public.subscriptions
  drop constraint if exists subscriptions_provider_valid;

alter table public.subscriptions
  add constraint subscriptions_provider_valid
  check (provider is null or provider in ('mercadopago', 'stripe'));

-- Una suscripción del proveedor apunta a una sola nuestra.
create unique index if not exists subscriptions_provider_ref_unique
  on public.subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null;

-- ------------------------------------------------------------
-- 3. Bitácora de eventos de pago, con idempotencia
--
-- La restricción única sobre (provider, event_id) es lo que evita
-- procesar dos veces el mismo aviso. Los proveedores reintentan los
-- webhooks cuando no reciben respuesta a tiempo, así que llegan
-- repetidos con normalidad.
-- ------------------------------------------------------------

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  topic text,
  payload jsonb not null default '{}'::jsonb,
  organization_id uuid references public.organizations(id) on delete set null,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);

alter table public.payment_events enable row level security;

-- ------------------------------------------------------------
-- 4. Vincular una suscripción con la del proveedor
--
-- La llama la ruta de checkout del servidor, ya con el identificador
-- que devolvió el proveedor.
-- ------------------------------------------------------------

create or replace function public.link_provider_subscription(
  p_secret text,
  p_organization_id uuid,
  p_provider text,
  p_provider_subscription_id text,
  p_plan_id text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expected text;
begin
  select value into v_expected
  from public.platform_secrets where key = 'payments_webhook';

  -- Si el secreto no está configurado, nadie pasa.
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'INVALID_SECRET' using errcode = '42501';
  end if;

  update public.subscriptions
  set provider = p_provider,
      provider_subscription_id = p_provider_subscription_id,
      plan_id = coalesce(p_plan_id, plan_id),
      updated_at = now()
  where organization_id = p_organization_id and is_current;

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    null, 'payments.link_subscription', 'subscriptions', p_organization_id,
    jsonb_build_object('provider', p_provider, 'provider_subscription_id', p_provider_subscription_id)
  );
end;
$$;

revoke all on function public.link_provider_subscription(text, uuid, text, text, text) from public, anon;
grant execute on function public.link_provider_subscription(text, uuid, text, text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 5. Aplicar un evento de pago
--
-- Traduce el estado del proveedor al nuestro:
--
--   authorized / paid  → full      (acceso normal)
--   payment_failed     → grace     (7 días para regularizar)
--   paused             → limited   (sólo lo mínimo)
--   cancelled          → suspended (sin acceso)
--
-- Devuelve si el evento se aplicó o si ya se había procesado antes.
-- ------------------------------------------------------------

create or replace function public.apply_payment_event(
  p_secret text,
  p_provider text,
  p_event_id text,
  p_provider_subscription_id text,
  p_status text,
  p_topic text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subscription public.subscriptions%rowtype;
  v_access public.subscription_access_status;
  v_event_id uuid;
  v_expected text;
begin
  select value into v_expected
  from public.platform_secrets where key = 'payments_webhook';

  -- Si el secreto no está configurado, nadie pasa.
  if v_expected is null or p_secret is null or p_secret <> v_expected then
    raise exception 'INVALID_SECRET' using errcode = '42501';
  end if;

  -- Idempotencia: si el evento ya estaba, no se vuelve a aplicar.
  insert into public.payment_events (provider, event_id, topic, payload)
  values (p_provider, p_event_id, p_topic, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('applied', false, 'reason', 'ALREADY_PROCESSED');
  end if;

  select * into v_subscription
  from public.subscriptions
  where provider = p_provider
    and provider_subscription_id = p_provider_subscription_id
  limit 1;

  if v_subscription.id is null then
    update public.payment_events
    set processing_error = 'SUBSCRIPTION_NOT_FOUND', processed_at = now()
    where id = v_event_id;

    return jsonb_build_object('applied', false, 'reason', 'SUBSCRIPTION_NOT_FOUND');
  end if;

  v_access := case lower(coalesce(p_status, ''))
    when 'authorized' then 'full'
    when 'paid' then 'full'
    when 'payment_failed' then 'grace'
    when 'paused' then 'limited'
    when 'cancelled' then 'suspended'
    else v_subscription.access_status
  end;

  update public.subscriptions
  set access_status = v_access,
      provider_status = p_status,
      grace_ends_at = case when v_access = 'grace' then now() + interval '7 days' else null end,
      canceled_at = case when v_access = 'suspended' then now() else canceled_at end,
      updated_at = now()
  where id = v_subscription.id;

  update public.payment_events
  set organization_id = v_subscription.organization_id, processed_at = now()
  where id = v_event_id;

  insert into public.audit_logs (organization_id, actor_user_id, action, target_table, target_id, metadata)
  values (
    v_subscription.organization_id, null, 'payments.apply_event', 'subscriptions', v_subscription.id,
    jsonb_build_object('provider', p_provider, 'status', p_status, 'access_status', v_access)
  );

  return jsonb_build_object('applied', true, 'accessStatus', v_access);
end;
$$;

revoke all on function public.apply_payment_event(text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.apply_payment_event(text, text, text, text, text, text, jsonb) to anon, authenticated;

commit;
