begin;

-- ============================================================
-- Nombres de organización: normalización y detección de parecidos
--
-- Antes se comparaba con lower(trim(name)), que deja pasar
-- "Norte Industrial" vs "Norte-Industrial" vs "NorteIndustrial"
-- vs "Nórte Industrial".
--
-- Ahora hay dos niveles:
--   · Bloqueo duro: mismo nombre normalizado (sin acentos, sin signos,
--     sin espacios de más, sin distinguir mayúsculas).
--   · Aviso suave: nombres parecidos. No impide continuar, pero le
--     pregunta al usuario si no es que ya tiene cuenta.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Forma normalizada de un nombre
-- ------------------------------------------------------------

create or replace function public.normalize_org_name(p_name text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select trim(
    regexp_replace(
      regexp_replace(
        lower(public.unaccent_fallback(coalesce(p_name, ''))),
        '[^a-z0-9]+', ' ', 'g'   -- signos, guiones y símbolos → espacio
      ),
      '\s+', ' ', 'g'            -- espacios repetidos → uno solo
    )
  );
$$;

-- ------------------------------------------------------------
-- 2. Se reemplaza el índice anterior por uno sobre la forma normalizada
--
-- Primero se resuelven las colisiones que sólo aparecen al normalizar
-- (por ejemplo "Norte-Industrial" y "Norte Industrial").
-- ------------------------------------------------------------

with duplicados as (
  select id,
         row_number() over (
           partition by public.normalize_org_name(name)
           order by created_at, id
         ) as n
  from public.organizations
)
update public.organizations o
set name = o.name || ' (' || d.n || ')',
    updated_at = now()
from duplicados d
where d.id = o.id and d.n > 1;

drop index if exists public.organizations_name_unique_ci;

create unique index if not exists organizations_name_unique_normalized
  on public.organizations (public.normalize_org_name(name));

-- ------------------------------------------------------------
-- 3. Consulta para el registro: ¿está libre? ¿hay parecidos?
--
-- Los parecidos son avisos, no bloqueos. Se detectan con tres reglas
-- deterministas, sin depender de extensiones:
--   a) misma cadena al quitar todos los espacios
--   b) uno empieza igual que el otro (5 caracteres o más)
--   c) coinciden los primeros 6 caracteres — atrapa erratas al final,
--      como "Davalsy" contra "Davalsi"
-- ------------------------------------------------------------

create or replace function public.check_organization_name(p_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_norm text := public.normalize_org_name(p_name);
  v_compact text := replace(public.normalize_org_name(p_name), ' ', '');
  v_taken boolean;
  v_similar jsonb;
begin
  if length(v_norm) = 0 then
    return jsonb_build_object('available', false, 'reason', 'EMPTY', 'similar', '[]'::jsonb);
  end if;

  select exists (
    select 1 from public.organizations o
    where public.normalize_org_name(o.name) = v_norm
  ) into v_taken;

  select coalesce(jsonb_agg(distinct o.name), '[]'::jsonb)
  into v_similar
  from public.organizations o
  where public.normalize_org_name(o.name) <> v_norm
    and (
      replace(public.normalize_org_name(o.name), ' ', '') = v_compact
      or (
        length(v_compact) >= 5
        and (
          replace(public.normalize_org_name(o.name), ' ', '') like v_compact || '%'
          or v_compact like replace(public.normalize_org_name(o.name), ' ', '') || '%'
        )
      )
      or (
        length(v_compact) >= 6
        and length(replace(public.normalize_org_name(o.name), ' ', '')) >= 6
        and left(replace(public.normalize_org_name(o.name), ' ', ''), 6) = left(v_compact, 6)
      )
    );

  return jsonb_build_object(
    'available', not v_taken,
    'reason', case when v_taken then 'TAKEN' else 'OK' end,
    'similar', v_similar
  );
end;
$$;

grant execute on function public.check_organization_name(text) to anon, authenticated;

-- La función anterior se mantiene, ahora apoyada en la normalización
-- nueva, para no romper a quien ya la llame.
create or replace function public.organization_name_available(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from public.organizations
    where public.normalize_org_name(name) = public.normalize_org_name(p_name)
  );
$$;

grant execute on function public.organization_name_available(text) to anon, authenticated;

commit;
