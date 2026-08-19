begin;

-- ============================================================
-- Platform admins: personal de DAVALSY con acceso cross-tenant.
-- Identificados por correo (no por user_id) para poder darles de
-- alta antes de que se hayan registrado. Tabla bloqueada por RLS:
-- solo se consulta desde funciones security definer.
-- ============================================================

create table public.platform_admins (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

insert into public.platform_admins (email) values
  ('avaliente@davalsy.com'),
  ('dsalcedo@davalsy.com'),
  ('jramriez@davalsy.com')
on conflict (email) do nothing;

create or replace function public.is_platform_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    join public.platform_admins pa on lower(pa.email) = lower(p.email)
    where p.id = p_user_id
  );
$$;

revoke all on function public.is_platform_admin(uuid) from public, anon;
grant execute on function public.is_platform_admin(uuid) to authenticated;

-- Wrapper sin argumentos: el frontend la usa solo para decidir si
-- muestra el link al panel admin. La protección real vive en cada
-- RPC admin_*, que vuelve a validar is_platform_admin() por su cuenta.
create or replace function public.am_i_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_platform_admin(auth.uid());
$$;

revoke all on function public.am_i_platform_admin() from public, anon;
grant execute on function public.am_i_platform_admin() to authenticated;

-- ============================================================
-- Excepciones de feature por organización: encima del plan, no en
-- vez del plan. enabled = true fuerza a prendido aunque el plan no
-- lo incluya; enabled = false fuerza a apagado aunque el plan sí lo
-- incluya. Sin fila = se respeta el plan tal cual.
-- ============================================================

create table public.organization_feature_overrides (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_key text not null references public.features(key) on delete cascade,
  enabled boolean not null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, feature_key)
);

alter table public.organization_feature_overrides enable row level security;

create trigger organization_feature_overrides_set_updated_at
before update on public.organization_feature_overrides
for each row execute function public.set_updated_at();

-- ============================================================
-- organization_has_feature: ahora consulta la excepción primero.
-- Mismo contrato/firma que antes, misma lógica de fallback exacta.
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
    (
      select ofo.enabled
      from public.organization_feature_overrides ofo
      where ofo.organization_id = p_organization_id
        and ofo.feature_key = p_feature_key
    ),
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

-- ============================================================
-- get_suite_lobby_context: enabledFeatures ahora recorre TODAS las
-- features (no solo las del plan) y delega en organization_has_feature,
-- para que una excepción positiva sí aparezca aunque el plan no la
-- incluya de por sí.
-- ============================================================

create or replace function public.get_suite_lobby_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_context jsonb;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED'
      using errcode = '42501';
  end if;

  with viewer as (
    select
      au.id,
      coalesce(p.email, lower(au.email)) as email,
      coalesce(
        p.full_name,
        au.raw_user_meta_data ->> 'full_name',
        au.raw_user_meta_data ->> 'name',
        split_part(coalesce(au.email, ''), '@', 1),
        'Usuario DAVALSY'
      ) as full_name,
      coalesce(p.avatar_url, au.raw_user_meta_data ->> 'avatar_url') as avatar_url
    from auth.users au
    left join public.profiles p on p.id = au.id
    where au.id = v_user_id
      and coalesce(p.is_active, true)
  ),
  visible_organizations as (
    select
      o.id,
      o.name,
      o.slug,
      om.role::text as role,
      coalesce(s.plan_id, 'sin_plan') as plan_id,
      coalesce(pl.name, 'Sin plan activo') as plan_name,
      coalesce(s.access_status::text, 'pending') as access_status,
      s.current_period_end as renewal_date
    from public.organization_members om
    join public.organizations o
      on o.id = om.organization_id
     and o.status = 'active'
    left join lateral (
      select
        subscription.plan_id,
        subscription.access_status,
        subscription.current_period_end
      from public.subscriptions subscription
      where subscription.organization_id = o.id
        and subscription.is_current
      order by subscription.updated_at desc
      limit 1
    ) s on true
    left join public.plans pl on pl.id = s.plan_id
    where om.user_id = v_user_id
      and om.status = 'active'
  )
  select jsonb_build_object(
    'contractVersion', 1,
    'id', viewer.id,
    'email', viewer.email,
    'fullName', viewer.full_name,
    'avatarUrl', viewer.avatar_url,
    'organizations', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', organization.id,
            'name', organization.name,
            'slug', organization.slug,
            'role', organization.role,
            'planId', organization.plan_id,
            'planName', organization.plan_name,
            'accessStatus', organization.access_status,
            'renewalDate', organization.renewal_date,
            'enabledFeatures', coalesce(
              (
                select jsonb_agg(feature.key order by feature.key)
                from public.features feature
                where public.organization_has_feature(organization.id, feature.key)
              ),
              '[]'::jsonb
            )
          )
          order by organization.name
        )
        from visible_organizations organization
      ),
      '[]'::jsonb
    )
  )
  into v_context
  from viewer;

  if v_context is null then
    raise exception 'USER_INACTIVE_OR_NOT_FOUND'
      using errcode = '42501';
  end if;

  return v_context;
end;
$$;

-- ============================================================
-- RPCs admin_*: cada una vuelve a validar is_platform_admin() por su
-- cuenta (no confían en que el frontend ya haya filtrado). Cada
-- cambio queda en audit_logs.
-- ============================================================

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

  select coalesce(jsonb_agg(row_to_json(t) order by t.name), '[]'::jsonb)
  into v_result
  from (
    select
      o.id,
      o.name,
      o.slug,
      o.status::text as status,
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

create or replace function public.admin_get_organization_features(p_organization_id uuid)
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

  select coalesce(jsonb_agg(row_to_json(t) order by t.key), '[]'::jsonb)
  into v_result
  from (
    select
      f.key,
      f.name,
      f.description,
      coalesce(pf.enabled, false) as plan_enabled,
      ov.enabled as override_enabled,
      public.organization_has_feature(p_organization_id, f.key) as effective
    from public.features f
    left join lateral (
      select subscription.plan_id
      from public.subscriptions subscription
      where subscription.organization_id = p_organization_id and subscription.is_current
      order by subscription.updated_at desc
      limit 1
    ) s on true
    left join public.plan_features pf on pf.plan_id = s.plan_id and pf.feature_key = f.key
    left join public.organization_feature_overrides ov on ov.organization_id = p_organization_id and ov.feature_key = f.key
  ) t;

  return v_result;
end;
$$;

revoke all on function public.admin_get_organization_features(uuid) from public, anon;
grant execute on function public.admin_get_organization_features(uuid) to authenticated;

create or replace function public.admin_set_feature_override(
  p_organization_id uuid,
  p_feature_key text,
  p_enabled boolean,
  p_note text default null
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

  insert into public.organization_feature_overrides (organization_id, feature_key, enabled, note, created_by)
  values (p_organization_id, p_feature_key, p_enabled, p_note, auth.uid())
  on conflict (organization_id, feature_key) do update set
    enabled = excluded.enabled,
    note = excluded.note,
    updated_at = now();

  insert into public.audit_logs (organization_id, actor_user_id, action, target_table, metadata)
  values (
    p_organization_id,
    auth.uid(),
    'admin.feature_override.set',
    'organization_feature_overrides',
    jsonb_build_object('feature_key', p_feature_key, 'enabled', p_enabled, 'note', p_note)
  );
end;
$$;

revoke all on function public.admin_set_feature_override(uuid, text, boolean, text) from public, anon;
grant execute on function public.admin_set_feature_override(uuid, text, boolean, text) to authenticated;

create or replace function public.admin_clear_feature_override(
  p_organization_id uuid,
  p_feature_key text
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

  delete from public.organization_feature_overrides
  where organization_id = p_organization_id
    and feature_key = p_feature_key;

  insert into public.audit_logs (organization_id, actor_user_id, action, target_table, metadata)
  values (
    p_organization_id,
    auth.uid(),
    'admin.feature_override.clear',
    'organization_feature_overrides',
    jsonb_build_object('feature_key', p_feature_key)
  );
end;
$$;

revoke all on function public.admin_clear_feature_override(uuid, text) from public, anon;
grant execute on function public.admin_clear_feature_override(uuid, text) to authenticated;

commit;
