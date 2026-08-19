begin;

-- ============================================================
-- Catálogo de soluciones, editable desde el panel admin sin tocar
-- código. Cada solución se gobierna por un feature_key: registrarla
-- aquí crea (o reutiliza) esa fila en public.features, así que queda
-- ligada automáticamente a la hoja de permisos por organización que
-- ya existe (organization_feature_overrides / admin_get_organization_features).
-- ============================================================

create table public.solutions (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]*$'),
  name text not null,
  eyebrow text not null default '',
  description text not null default '',
  icon text not null default 'boxes',
  feature_key text not null references public.features(key) on delete restrict,
  action text not null default '',
  is_external boolean not null default true,
  external_url text,
  metric text not null default '',
  metric_label text not null default '',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint solutions_external_url_required check (not is_external or external_url is not null)
);

alter table public.solutions enable row level security;

create trigger solutions_set_updated_at
before update on public.solutions
for each row execute function public.set_updated_at();

-- Migra DavOps ERP del código a la base de datos.
insert into public.solutions (
  id, name, eyebrow, description, icon, feature_key, action,
  is_external, external_url, metric, metric_label, sort_order, is_active
) values (
  'erp',
  'DavOps ERP',
  'Operación',
  'Administra inventario, compras y operación conectada a tu organización.',
  'boxes',
  'erp.access',
  'erp.access',
  true,
  'https://davopserp.vercel.app/auth/suite-entry',
  'Conectado',
  'operación en tiempo real',
  10,
  true
)
on conflict (id) do nothing;

-- ============================================================
-- Lectura pública (cualquier usuario autenticado): solo soluciones
-- activas, para pintar el lobby/catálogo.
-- ============================================================

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
        'metricLabel', t.metric_label
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

-- ============================================================
-- RPCs admin_*: mismo patrón que el resto del panel admin — cada una
-- vuelve a validar is_platform_admin() por su cuenta y queda en
-- audit_logs.
-- ============================================================

create or replace function public.admin_list_solutions()
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

  select coalesce(jsonb_agg(row_to_json(t) order by t.sort_order, t.name), '[]'::jsonb)
  into v_result
  from public.solutions t;

  return v_result;
end;
$$;

revoke all on function public.admin_list_solutions() from public, anon;
grant execute on function public.admin_list_solutions() to authenticated;

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
  p_sort_order integer default 100
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

  -- Si el feature todavía no existe, lo crea. No lo prende en ningún
  -- plan por default: el admin decide desde la hoja de permisos qué
  -- organización lo recibe (por plan o por excepción puntual).
  insert into public.features (key, name, description, unit, allowed_when_limited)
  values (p_feature_key, coalesce(nullif(p_feature_name, ''), p_name), p_description, 'boolean', false)
  on conflict (key) do update set
    name = coalesce(nullif(p_feature_name, ''), public.features.name),
    updated_at = now();

  insert into public.solutions (
    id, name, eyebrow, description, icon, feature_key, action,
    is_external, external_url, metric, metric_label, sort_order, created_by
  ) values (
    p_id, p_name, p_eyebrow, p_description, p_icon, p_feature_key, p_feature_key,
    p_is_external, nullif(trim(coalesce(p_external_url, '')), ''), p_metric, p_metric_label, p_sort_order, auth.uid()
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
    updated_at = now();

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (auth.uid(), 'admin.solution.upsert', 'solutions', null, jsonb_build_object('id', p_id, 'feature_key', p_feature_key));
end;
$$;

revoke all on function public.admin_upsert_solution(text, text, text, text, text, text, text, boolean, text, text, text, integer) from public, anon;
grant execute on function public.admin_upsert_solution(text, text, text, text, text, text, text, boolean, text, text, text, integer) to authenticated;

create or replace function public.admin_set_solution_active(p_id text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  update public.solutions set is_active = p_active, updated_at = now() where id = p_id;

  insert into public.audit_logs (actor_user_id, action, target_table, metadata)
  values (auth.uid(), 'admin.solution.set_active', 'solutions', jsonb_build_object('id', p_id, 'active', p_active));
end;
$$;

revoke all on function public.admin_set_solution_active(text, boolean) from public, anon;
grant execute on function public.admin_set_solution_active(text, boolean) to authenticated;

create or replace function public.admin_delete_solution(p_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  delete from public.solutions where id = p_id;

  insert into public.audit_logs (actor_user_id, action, target_table, metadata)
  values (auth.uid(), 'admin.solution.delete', 'solutions', jsonb_build_object('id', p_id));
end;
$$;

revoke all on function public.admin_delete_solution(text) from public, anon;
grant execute on function public.admin_delete_solution(text) to authenticated;

commit;
