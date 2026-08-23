begin;

-- ============================================================
-- Planes por cupo de soluciones + clasificación de soluciones
--
-- Modelo nuevo:
--   free       → 1 solución básica, a elección del cliente
--   starter    → 2 soluciones básicas
--   pro        → 3 soluciones básicas
--   enterprise → sin autoservicio: la cuenta nace pendiente y DAVALSY
--                la activa a mano
--
-- Las soluciones se clasifican en:
--   basic → cuentan contra el cupo del plan
--   addon → se venden aparte; no se incluyen en ningún plan y hoy sólo
--           las enciende un admin (ver nota de cobro más abajo)
--
-- Antes, el acceso a una solución dependía de plan_features. Ahora, para
-- las soluciones básicas depende de qué eligió el cliente dentro de su
-- cupo (organization_solutions). Los features que NO son soluciones
-- (dashboards, users, ai.analysis…) siguen exactamente igual.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Planes: cupo y disponibilidad en autoservicio
-- ------------------------------------------------------------

alter table public.plans
  add column if not exists basic_solution_quota integer,
  add column if not exists is_self_serve boolean not null default true,
  add column if not exists price_label text not null default '',
  add column if not exists tagline text not null default '';

-- 'business' queda como plan heredado: ya no se ofrece, pero no se borra
-- para no romper suscripciones históricas.
update public.plans
set is_self_serve = false, tagline = 'Plan heredado'
where id = 'business';

insert into public.plans (id, name, description, sort_order)
values
  ('free', 'Free', 'Para empezar con una sola solución.', 5),
  ('pro', 'Pro', 'Todas las soluciones básicas incluidas.', 25)
on conflict (id) do nothing;

update public.plans set
  basic_solution_quota = 1,
  is_self_serve = true,
  price_label = 'Sin costo',
  tagline = 'Una solución básica, la que tú elijas.',
  sort_order = 5
where id = 'free';

update public.plans set
  basic_solution_quota = 2,
  is_self_serve = true,
  price_label = 'Consulta precio',
  tagline = 'Dos soluciones básicas.',
  sort_order = 10
where id = 'starter';

update public.plans set
  basic_solution_quota = 3,
  is_self_serve = true,
  price_label = 'Consulta precio',
  tagline = 'Las tres soluciones básicas.',
  sort_order = 25
where id = 'pro';

update public.plans set
  basic_solution_quota = null, -- sin límite
  is_self_serve = false,
  price_label = 'Hablemos',
  tagline = 'A la medida de tu operación.',
  sort_order = 30
where id = 'enterprise';

-- El plan heredado conserva su comportamiento anterior (sin cupo).
update public.plans set basic_solution_quota = null where id = 'business';

-- Los planes nuevos heredan los límites operativos de un plan cercano,
-- para que features como 'users' o 'dashboards' tengan valores sensatos.
insert into public.plan_features (plan_id, feature_key, enabled, limit_value, quota_period)
select 'free', pf.feature_key, pf.enabled,
       case when pf.feature_key in ('dashboards', 'users', 'data_sources') then 1 else pf.limit_value end,
       pf.quota_period
from public.plan_features pf
where pf.plan_id = 'starter'
on conflict (plan_id, feature_key) do nothing;

insert into public.plan_features (plan_id, feature_key, enabled, limit_value, quota_period)
select 'pro', pf.feature_key, pf.enabled, pf.limit_value, pf.quota_period
from public.plan_features pf
where pf.plan_id = 'business'
on conflict (plan_id, feature_key) do nothing;

-- ------------------------------------------------------------
-- 2. Soluciones: básica o de cobro aparte
-- ------------------------------------------------------------

alter table public.solutions
  add column if not exists pricing_type text not null default 'basic',
  add column if not exists price_note text not null default '';

alter table public.solutions
  drop constraint if exists solutions_pricing_type_valid;

alter table public.solutions
  add constraint solutions_pricing_type_valid
  check (pricing_type in ('basic', 'addon'));

-- ------------------------------------------------------------
-- 3. Soluciones elegidas por cada organización
-- ------------------------------------------------------------

create table if not exists public.organization_solutions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  solution_id text not null references public.solutions(id) on delete cascade,
  selected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, solution_id)
);

alter table public.organization_solutions enable row level security;

-- ------------------------------------------------------------
-- 4. Cupo del plan de una organización
-- ------------------------------------------------------------

create or replace function public.organization_basic_quota(p_organization_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.basic_solution_quota
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.organization_id = p_organization_id
    and s.is_current
  order by s.created_at desc
  limit 1;
$$;

revoke all on function public.organization_basic_quota(uuid) from public, anon;
grant execute on function public.organization_basic_quota(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. Resolución de acceso a un feature
--
-- Orden de decisión:
--   1. Excepción del admin (gana siempre, en ambos sentidos).
--   2. Si el feature pertenece a una solución:
--        básica → la eligió la organización y su suscripción está vigente.
--        addon  → sólo por excepción del admin (punto 1).
--   3. Si no es de una solución → plan_features, como siempre.
-- ------------------------------------------------------------

create or replace function public.organization_has_feature(
  p_organization_id uuid,
  p_feature_key text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    -- 1. Excepción explícita del panel admin.
    (
      select ofo.enabled
      from public.organization_feature_overrides ofo
      where ofo.organization_id = p_organization_id
        and ofo.feature_key = p_feature_key
    ),
    -- 2. Feature que pertenece a una solución del catálogo.
    (
      select
        sol.pricing_type = 'basic'
        and exists (
          select 1
          from public.organization_solutions os
          where os.organization_id = p_organization_id
            and os.solution_id = sol.id
        )
        and case
          when s.access_status in ('full', 'trial') then true
          when s.access_status = 'grace' then s.grace_ends_at is null or s.grace_ends_at >= now()
          when s.access_status = 'full_until_end' then s.current_period_end is null or s.current_period_end >= now()
          else false
        end
      from public.solutions sol
      join public.subscriptions s
        on s.organization_id = p_organization_id
       and s.is_current
      where sol.feature_key = p_feature_key
        and sol.is_active
      order by s.created_at desc
      limit 1
    ),
    -- 3. Feature operativo normal: lo dicta el plan.
    (
      select
        pf.enabled
        and case
          when s.access_status in ('full', 'trial') then true
          when s.access_status = 'grace' then s.grace_ends_at is null or s.grace_ends_at >= now()
          when s.access_status = 'full_until_end' then s.current_period_end is null or s.current_period_end >= now()
          when s.access_status = 'limited' then f.allowed_when_limited
          else false
        end
      from public.subscriptions s
      join public.plan_features pf
        on pf.plan_id = s.plan_id
       and pf.feature_key = p_feature_key
      join public.features f
        on f.key = pf.feature_key
      where s.organization_id = p_organization_id
        and s.is_current
      order by s.created_at desc
      limit 1
    ),
    false
  );
$$;

-- ------------------------------------------------------------
-- 6. Migración de datos: nadie pierde acceso
--
-- Toda organización que hoy tiene acceso efectivo a una solución básica
-- la conserva, registrándola como elegida. Las suscripciones 'business'
-- pasan a 'pro'.
-- ------------------------------------------------------------

insert into public.organization_solutions (organization_id, solution_id)
select distinct o.id, sol.id
from public.organizations o
cross join public.solutions sol
where sol.is_active
  and coalesce(sol.pricing_type, 'basic') = 'basic'
  and (
    exists (
      select 1 from public.organization_feature_overrides ofo
      where ofo.organization_id = o.id and ofo.feature_key = sol.feature_key and ofo.enabled
    )
    or exists (
      select 1
      from public.subscriptions s
      join public.plan_features pf on pf.plan_id = s.plan_id and pf.feature_key = sol.feature_key
      where s.organization_id = o.id and s.is_current and pf.enabled
    )
  )
on conflict do nothing;

update public.subscriptions set plan_id = 'pro', updated_at = now() where plan_id = 'business';

-- ------------------------------------------------------------
-- 7. Lectura pública para la pantalla de registro
--
-- Se conceden a anon a propósito: son datos de catálogo comercial, los
-- mismos que irían en una página de precios. No exponen nada de ningún
-- cliente.
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
        'priceLabel', p.price_label,
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

create or replace function public.list_basic_solutions()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'eyebrow', t.eyebrow,
        'description', t.description,
        'icon', t.icon
      )
      order by t.sort_order, t.name
    ),
    '[]'::jsonb
  )
  from public.solutions t
  where t.is_active and t.pricing_type = 'basic';
$$;

grant execute on function public.list_basic_solutions() to anon, authenticated;

-- ------------------------------------------------------------
-- 8. Elección de soluciones por parte del cliente
-- ------------------------------------------------------------

create or replace function public.get_organization_solutions(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_active_organization_member(p_organization_id) and not public.is_platform_admin() then
    raise exception 'NOT_ORGANIZATION_MEMBER' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'quota', public.organization_basic_quota(p_organization_id),
    'selected', coalesce(
      (select jsonb_agg(os.solution_id order by os.solution_id)
       from public.organization_solutions os
       where os.organization_id = p_organization_id),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_organization_solutions(uuid) from public, anon;
grant execute on function public.get_organization_solutions(uuid) to authenticated;

create or replace function public.set_organization_solutions(
  p_organization_id uuid,
  p_solution_ids text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quota integer;
  v_count integer;
  v_is_admin boolean := public.is_platform_admin();
begin
  -- Sólo quien puede administrar la organización, o un admin de plataforma.
  if not v_is_admin
     and not public.has_organization_permission(p_organization_id, 'plan.change') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  v_count := coalesce(array_length(p_solution_ids, 1), 0);
  v_quota := public.organization_basic_quota(p_organization_id);

  if v_quota is not null and v_count > v_quota then
    raise exception 'QUOTA_EXCEEDED';
  end if;

  if exists (
    select 1 from unnest(p_solution_ids) as sid
    where not exists (
      select 1 from public.solutions s
      where s.id = sid and s.is_active and s.pricing_type = 'basic'
    )
  ) then
    raise exception 'INVALID_SOLUTION';
  end if;

  delete from public.organization_solutions
  where organization_id = p_organization_id
    and solution_id <> all (coalesce(p_solution_ids, '{}'::text[]));

  insert into public.organization_solutions (organization_id, solution_id, selected_by)
  select p_organization_id, sid, auth.uid()
  from unnest(coalesce(p_solution_ids, '{}'::text[])) as sid
  on conflict do nothing;

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'organization.solutions.set', 'organization_solutions', p_organization_id,
    jsonb_build_object('solutions', p_solution_ids)
  );
end;
$$;

revoke all on function public.set_organization_solutions(uuid, text[]) from public, anon;
grant execute on function public.set_organization_solutions(uuid, text[]) to authenticated;

-- ------------------------------------------------------------
-- 9. Alta autoservicio con plan elegido
--
-- Enterprise no se autoactiva: la organización nace pendiente y aparece
-- en el panel admin para que DAVALSY la revise.
-- ------------------------------------------------------------

create or replace function public.apply_signup_plan(
  p_organization_id uuid,
  p_plan_id text,
  p_solution_ids text[] default '{}'::text[]
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
    jsonb_build_object('plan_id', p_plan_id, 'solutions', p_solution_ids)
  );
end;
$$;

revoke all on function public.apply_signup_plan(uuid, text, text[]) from public, anon;
grant execute on function public.apply_signup_plan(uuid, text, text[]) to authenticated;

-- ------------------------------------------------------------
-- 10. El panel admin también administra la clasificación
-- ------------------------------------------------------------

create or replace function public.admin_upsert_solution(
  p_id text,
  p_name text,
  p_eyebrow text,
  p_description text,
  p_icon text,
  p_feature_key text,
  p_feature_name text,
  p_is_external boolean,
  p_external_url text,
  p_metric text default '',
  p_metric_label text default '',
  p_sort_order integer default 100,
  p_pricing_type text default 'basic',
  p_price_note text default ''
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

  if p_is_external and (p_external_url is null or length(trim(p_external_url)) = 0) then
    raise exception 'EXTERNAL_URL_REQUIRED';
  end if;

  if p_pricing_type not in ('basic', 'addon') then
    raise exception 'INVALID_PRICING_TYPE';
  end if;

  insert into public.features (key, name, description, unit, allowed_when_limited)
  values (p_feature_key, coalesce(nullif(p_feature_name, ''), p_name), p_description, 'boolean', false)
  on conflict (key) do update set
    name = coalesce(nullif(p_feature_name, ''), public.features.name),
    updated_at = now();

  insert into public.solutions (
    id, name, eyebrow, description, icon, feature_key, action,
    is_external, external_url, metric, metric_label, sort_order, created_by,
    pricing_type, price_note
  ) values (
    p_id, p_name, p_eyebrow, p_description, p_icon, p_feature_key, p_feature_key,
    p_is_external, nullif(trim(coalesce(p_external_url, '')), ''), p_metric, p_metric_label,
    p_sort_order, auth.uid(), p_pricing_type, p_price_note
  )
  on conflict (id) do update set
    name = excluded.name,
    eyebrow = excluded.eyebrow,
    description = excluded.description,
    icon = excluded.icon,
    feature_key = excluded.feature_key,
    action = excluded.action,
    is_external = excluded.is_external,
    external_url = excluded.external_url,
    metric = excluded.metric,
    metric_label = excluded.metric_label,
    sort_order = excluded.sort_order,
    pricing_type = excluded.pricing_type,
    price_note = excluded.price_note,
    updated_at = now();

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'admin.solution.upsert', 'solutions', null,
    jsonb_build_object('id', p_id, 'feature_key', p_feature_key, 'pricing_type', p_pricing_type)
  );
end;
$$;

revoke all on function public.admin_upsert_solution(text, text, text, text, text, text, text, boolean, text, text, text, integer, text, text) from public, anon;
grant execute on function public.admin_upsert_solution(text, text, text, text, text, text, text, boolean, text, text, text, integer, text, text) to authenticated;

-- La versión anterior (12 parámetros) se retira para que no queden dos
-- firmas conviviendo y PostgREST no tenga que adivinar cuál usar.
drop function if exists public.admin_upsert_solution(text, text, text, text, text, text, text, boolean, text, text, text, integer);

-- El catálogo del cliente ahora también informa cómo se cobra cada
-- solución, para poder distinguir "incluida" de "se contrata aparte".
create or replace function public.list_active_solutions()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'eyebrow', t.eyebrow,
        'description', t.description,
        'icon', t.icon,
        'featureKey', t.feature_key,
        'action', t.action,
        'external', t.is_external,
        'externalUrl', t.external_url,
        'metric', t.metric,
        'metricLabel', t.metric_label,
        'pricingType', t.pricing_type,
        'priceNote', t.price_note
      )
      order by t.sort_order, t.name
    ),
    '[]'::jsonb
  )
  from public.solutions t
  where t.is_active;
$$;

revoke all on function public.list_active_solutions() from public, anon;
grant execute on function public.list_active_solutions() to authenticated;

commit;
