begin;

-- ============================================================
-- 1. Corrección: bajar de plan no revocaba accesos
--
-- El cupo se validaba al ELEGIR soluciones, pero no al RESOLVER el
-- acceso. Una organización que pasaba de Pro (3) a Free (1) conservaba
-- las tres, porque organization_has_feature() sólo preguntaba si la
-- solución estaba en su lista.
--
-- Se corrige por dos vías:
--   a) Al cambiar de plan se recorta la selección al cupo nuevo.
--   b) La resolución de acceso ordena la selección y sólo honra las
--      primeras N, así que aunque quedaran filas de más no otorgan
--      acceso. Es la red de seguridad.
-- ============================================================

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
    -- 1. Excepción explícita del panel admin: manda sobre todo lo demás.
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
          from (
            select os.solution_id,
                   row_number() over (order by os.created_at, os.solution_id) as rn
            from public.organization_solutions os
            join public.solutions s2
              on s2.id = os.solution_id
             and s2.is_active
             and s2.pricing_type = 'basic'
            where os.organization_id = p_organization_id
          ) elegidas
          where elegidas.solution_id = sol.id
            and (
              public.organization_basic_quota(p_organization_id) is null
              or elegidas.rn <= public.organization_basic_quota(p_organization_id)
            )
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

-- Al cambiar de plan se recorta la selección, para que la base refleje
-- la realidad y no sólo la resolución de acceso.
create or replace function public.admin_set_organization_plan(
  p_organization_id uuid,
  p_plan_id text,
  p_access_status public.subscription_access_status
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subscription_id uuid;
  v_quota integer;
  v_recortadas integer := 0;
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  select basic_solution_quota into v_quota from public.plans where id = p_plan_id;
  if not found then
    raise exception 'PLAN_NOT_FOUND';
  end if;

  select id into v_subscription_id
  from public.subscriptions
  where organization_id = p_organization_id and is_current
  limit 1;

  if v_subscription_id is null then
    insert into public.subscriptions (organization_id, plan_id, is_current, access_status)
    values (p_organization_id, p_plan_id, true, p_access_status);
  else
    update public.subscriptions
    set plan_id = p_plan_id, access_status = p_access_status, updated_at = now()
    where id = v_subscription_id;
  end if;

  if v_quota is not null then
    with ordenadas as (
      select os.solution_id,
             row_number() over (order by os.created_at, os.solution_id) as rn
      from public.organization_solutions os
      where os.organization_id = p_organization_id
    )
    delete from public.organization_solutions os
    using ordenadas
    where os.organization_id = p_organization_id
      and os.solution_id = ordenadas.solution_id
      and ordenadas.rn > v_quota;

    get diagnostics v_recortadas = row_count;
  end if;

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'admin.organization.set_plan', 'organizations', p_organization_id,
    jsonb_build_object(
      'plan_id', p_plan_id,
      'access_status', p_access_status,
      'soluciones_recortadas', v_recortadas
    )
  );
end;
$$;

revoke all on function public.admin_set_organization_plan(uuid, text, public.subscription_access_status) from public, anon;
grant execute on function public.admin_set_organization_plan(uuid, text, public.subscription_access_status) to authenticated;

-- ============================================================
-- 2. Edición de planes desde el panel
-- ============================================================

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
  p_sort_order integer
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

  insert into public.plans (
    id, name, description, tagline, price_label,
    basic_solution_quota, is_self_serve, sort_order
  ) values (
    v_id, trim(p_name), coalesce(p_description, ''), coalesce(p_tagline, ''),
    coalesce(p_price_label, ''), p_basic_quota, coalesce(p_is_self_serve, true),
    coalesce(p_sort_order, 100)
  )
  on conflict (id) do update set
    name = excluded.name,
    description = excluded.description,
    tagline = excluded.tagline,
    price_label = excluded.price_label,
    basic_solution_quota = excluded.basic_solution_quota,
    is_self_serve = excluded.is_self_serve,
    sort_order = excluded.sort_order,
    updated_at = now();

  insert into public.audit_logs (actor_user_id, action, target_table, metadata)
  values (auth.uid(), 'admin.plan.upsert', 'plans', jsonb_build_object('id', v_id));
end;
$$;

revoke all on function public.admin_upsert_plan(text, text, text, text, text, integer, boolean, integer) from public, anon;
grant execute on function public.admin_upsert_plan(text, text, text, text, text, integer, boolean, integer) to authenticated;

create or replace function public.admin_delete_plan(p_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_en_uso integer;
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  select count(*) into v_en_uso
  from public.subscriptions where plan_id = p_id and is_current;

  if v_en_uso > 0 then
    raise exception 'PLAN_IN_USE';
  end if;

  delete from public.plans where id = p_id;

  insert into public.audit_logs (actor_user_id, action, target_table, metadata)
  values (auth.uid(), 'admin.plan.delete', 'plans', jsonb_build_object('id', p_id));
end;
$$;

revoke all on function public.admin_delete_plan(text) from public, anon;
grant execute on function public.admin_delete_plan(text) to authenticated;

-- ------------------------------------------------------------
-- Límites por plan (dashboards, usuarios, fuentes de datos…)
-- ------------------------------------------------------------

create or replace function public.admin_get_plan_features(p_plan_id text)
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
        'key', f.key,
        'name', f.name,
        'unit', f.unit,
        'enabled', coalesce(pf.enabled, false),
        'limitValue', pf.limit_value,
        'isSolution', exists (select 1 from public.solutions s where s.feature_key = f.key)
      )
      order by f.key
    ),
    '[]'::jsonb
  )
  into v_result
  from public.features f
  left join public.plan_features pf
    on pf.feature_key = f.key and pf.plan_id = p_plan_id;

  return v_result;
end;
$$;

revoke all on function public.admin_get_plan_features(text) from public, anon;
grant execute on function public.admin_get_plan_features(text) to authenticated;

create or replace function public.admin_set_plan_feature(
  p_plan_id text,
  p_feature_key text,
  p_enabled boolean,
  p_limit_value bigint
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

  if p_limit_value is not null and p_limit_value < 0 then
    raise exception 'INVALID_LIMIT';
  end if;

  insert into public.plan_features (plan_id, feature_key, enabled, limit_value)
  values (p_plan_id, p_feature_key, coalesce(p_enabled, false), p_limit_value)
  on conflict (plan_id, feature_key) do update set
    enabled = excluded.enabled,
    limit_value = excluded.limit_value,
    updated_at = now();

  insert into public.audit_logs (actor_user_id, action, target_table, metadata)
  values (
    auth.uid(), 'admin.plan.set_feature', 'plan_features',
    jsonb_build_object('plan_id', p_plan_id, 'feature_key', p_feature_key,
                       'enabled', p_enabled, 'limit_value', p_limit_value)
  );
end;
$$;

revoke all on function public.admin_set_plan_feature(text, text, boolean, bigint) from public, anon;
grant execute on function public.admin_set_plan_feature(text, text, boolean, bigint) to authenticated;

-- ============================================================
-- 3. Soluciones elegidas de una organización, desde el panel
-- ============================================================

create or replace function public.admin_get_organization_solutions(p_organization_id uuid)
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

  select jsonb_build_object(
    'quota', public.organization_basic_quota(p_organization_id),
    'selected', coalesce(
      (select jsonb_agg(os.solution_id order by os.created_at, os.solution_id)
       from public.organization_solutions os
       where os.organization_id = p_organization_id),
      '[]'::jsonb
    ),
    'catalog', coalesce(
      (select jsonb_agg(
         jsonb_build_object('id', s.id, 'name', s.name, 'pricingType', s.pricing_type)
         order by s.sort_order, s.name)
       from public.solutions s
       where s.is_active),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_get_organization_solutions(uuid) from public, anon;
grant execute on function public.admin_get_organization_solutions(uuid) to authenticated;

commit;
