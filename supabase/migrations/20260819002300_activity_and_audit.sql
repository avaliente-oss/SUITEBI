begin;

-- ============================================================
-- Actividad y auditoría
--
-- Dos cosas distintas que la gente suele confundir:
--
--   · ACTIVIDAD (uso): quién abre qué solución y con qué frecuencia.
--     Sirve para saber si el producto se está usando. Sale de
--     access_decisions, que registra cada intento de abrir algo.
--
--   · AUDITORÍA (cambios): quién invitó, quién cambió un rol, quién
--     cambió el plan. Sirve para responder "¿quién hizo esto?".
--     Sale de audit_logs.
--
-- Nota sobre duración: la Suite firma el acceso y redirige a la app
-- externa; nunca se entera de cuándo salió el usuario. Por eso aquí se
-- mide FRECUENCIA, no tiempo. Medir tiempo exige que cada solución
-- reporte inicio y fin de sesión.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Que la auditoría sepa siempre a qué organización pertenece
--
-- Muchas acciones del panel de plataforma se registraban sin la
-- columna organization_id, aunque el dato viniera en target_id o en la
-- metadata. Un trigger lo deduce, en vez de reescribir veinte
-- funciones y arriesgarse a olvidar una.
-- ------------------------------------------------------------

create or replace function public.audit_logs_fill_organization()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.organization_id is null then
    if new.target_table = 'organizations' and new.target_id is not null then
      new.organization_id := new.target_id;
    elsif new.metadata ? 'organization_id'
          and (new.metadata ->> 'organization_id') ~* '^[0-9a-f-]{36}$' then
      new.organization_id := (new.metadata ->> 'organization_id')::uuid;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists audit_logs_fill_organization on public.audit_logs;

create trigger audit_logs_fill_organization
before insert on public.audit_logs
for each row execute function public.audit_logs_fill_organization();

-- Se completa lo ya registrado con el mismo criterio.
update public.audit_logs
set organization_id = target_id
where organization_id is null
  and target_table = 'organizations'
  and target_id is not null;

update public.audit_logs
set organization_id = (metadata ->> 'organization_id')::uuid
where organization_id is null
  and metadata ? 'organization_id'
  and (metadata ->> 'organization_id') ~* '^[0-9a-f-]{36}$';

-- ------------------------------------------------------------
-- 2. Panel de uso de la organización
--
-- Devuelve, para el periodo pedido: total de aperturas, personas
-- distintas, desglose por solución, accesos rechazados con su motivo, y
-- una serie diaria para graficar.
-- ------------------------------------------------------------

create or replace function public.org_usage_summary(
  p_organization_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_desde timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
begin
  if not public.is_active_organization_member(p_organization_id) and not public.is_platform_admin() then
    raise exception 'NOT_ORGANIZATION_MEMBER' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'days', greatest(coalesce(p_days, 30), 1),
    'totalOpens', (
      select count(*) from public.access_decisions d
      where d.organization_id = p_organization_id and d.allowed and d.occurred_at >= v_desde
    ),
    'activeUsers', (
      select count(distinct d.user_id) from public.access_decisions d
      where d.organization_id = p_organization_id and d.allowed and d.occurred_at >= v_desde
    ),
    'deniedCount', (
      select count(*) from public.access_decisions d
      where d.organization_id = p_organization_id and not d.allowed and d.occurred_at >= v_desde
    ),
    -- Uso por solución. Se une por feature_key para poner el nombre
    -- comercial en vez del identificador técnico.
    'bySolution', coalesce((
      select jsonb_agg(x order by x.opens desc)
      from (
        select
          coalesce(s.name, d.required_feature_key) as name,
          count(*) as opens,
          count(distinct d.user_id) as users,
          max(d.occurred_at) as "lastUsed"
        from public.access_decisions d
        left join public.solutions s on s.feature_key = d.required_feature_key
        where d.organization_id = p_organization_id
          and d.allowed
          and d.occurred_at >= v_desde
          and d.required_feature_key is not null
        group by coalesce(s.name, d.required_feature_key)
      ) x
    ), '[]'::jsonb),
    -- Personas más activas.
    'byUser', coalesce((
      select jsonb_agg(x order by x.opens desc)
      from (
        select
          coalesce(p.full_name, p.email, 'Usuario') as name,
          count(*) as opens,
          max(d.occurred_at) as "lastUsed"
        from public.access_decisions d
        left join public.profiles p on p.id = d.user_id
        where d.organization_id = p_organization_id and d.allowed and d.occurred_at >= v_desde
        group by coalesce(p.full_name, p.email, 'Usuario')
        order by count(*) desc
        limit 8
      ) x
    ), '[]'::jsonb),
    -- Rechazos: dónde hay fricción.
    'denied', coalesce((
      select jsonb_agg(x order by x.veces desc)
      from (
        select
          coalesce(s.name, d.required_feature_key, 'Sin especificar') as name,
          d.reason_code as motivo,
          count(*) as veces
        from public.access_decisions d
        left join public.solutions s on s.feature_key = d.required_feature_key
        where d.organization_id = p_organization_id and not d.allowed and d.occurred_at >= v_desde
        group by coalesce(s.name, d.required_feature_key, 'Sin especificar'), d.reason_code
        order by count(*) desc
        limit 8
      ) x
    ), '[]'::jsonb),
    -- Serie diaria, con los días sin uso en cero para que la gráfica no mienta.
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', serie.dia::date, 'opens', coalesce(c.opens, 0)) order by serie.dia)
      from generate_series(date_trunc('day', v_desde), date_trunc('day', now()), interval '1 day') as serie(dia)
      left join (
        select date_trunc('day', d.occurred_at) as dia, count(*) as opens
        from public.access_decisions d
        where d.organization_id = p_organization_id and d.allowed and d.occurred_at >= v_desde
        group by 1
      ) c on c.dia = serie.dia
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.org_usage_summary(uuid, integer) from public, anon;
grant execute on function public.org_usage_summary(uuid, integer) to authenticated;

-- ------------------------------------------------------------
-- 3. Auditoría de la organización
--
-- Requiere el permiso audit.read, que ya tenían propietario,
-- copropietario y administrador.
-- ------------------------------------------------------------

create or replace function public.org_audit_log(
  p_organization_id uuid,
  p_limit integer default 60
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_organization_permission(p_organization_id, 'audit.read')
     and not public.is_platform_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'action', a.action,
        'actor', coalesce(p.full_name, p.email, 'DAVALSY'),
        'isPlatform', a.actor_user_id is null or a.action like 'admin.%',
        'metadata', a.metadata,
        'occurredAt', a.occurred_at
      )
      order by a.occurred_at desc
    )
    from (
      select * from public.audit_logs
      where organization_id = p_organization_id
      order by occurred_at desc
      limit least(greatest(coalesce(p_limit, 60), 1), 200)
    ) a
    left join public.profiles p on p.id = a.actor_user_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.org_audit_log(uuid, integer) from public, anon;
grant execute on function public.org_audit_log(uuid, integer) to authenticated;

commit;
