begin;

-- ============================================================
-- Ajuste fino de la comparación de nombres
--
-- Dos problemas de la versión anterior:
--
--   1. El bloqueo conservaba los espacios, así que "DAVALSYProdQA"
--      pasaba como distinto de "DAVALSY Prod QA". Ahora la comparación
--      dura ignora también los espacios.
--
--   2. La regla de "mismos 6 primeros caracteres" marcaba como parecido
--      todo lo que compartiera prefijo de marca: nueve resultados por
--      escribir cualquier cosa que empezara con "davals". Se sustituye
--      por distancia de edición, que detecta erratas de verdad
--      ("Davalsi" vs "Davalsy") sin el ruido.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Forma compacta: sin acentos, sin signos y sin espacios
-- ------------------------------------------------------------

create or replace function public.org_name_compact(p_name text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select replace(public.normalize_org_name(p_name), ' ', '');
$$;

-- ------------------------------------------------------------
-- 2. Distancia de edición (Levenshtein) en plpgsql
--
-- Se implementa aquí para no depender de la extensión fuzzystrmatch,
-- que no siempre está habilitada. Los nombres son cortos, así que el
-- costo es irrelevante.
-- ------------------------------------------------------------

create or replace function public.edit_distance(a text, b text)
returns integer
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  la integer := length(coalesce(a, ''));
  lb integer := length(coalesce(b, ''));
  fila integer[];
  previa integer[];
  i integer;
  j integer;
  costo integer;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;

  -- Cota barata: si difieren mucho de tamaño, no hace falta calcular.
  if abs(la - lb) > 4 then return abs(la - lb); end if;

  previa := array(select generate_series(0, lb));

  for i in 1..la loop
    fila := array[i];
    for j in 1..lb loop
      costo := case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end;
      fila := fila || least(
        fila[j] + 1,          -- inserción
        previa[j + 1] + 1,    -- borrado
        previa[j] + costo     -- sustitución
      );
    end loop;
    previa := fila;
  end loop;

  return previa[lb + 1];
end;
$$;

-- ------------------------------------------------------------
-- 3. Se resuelven las colisiones que aparecen al ignorar espacios
--    y se cambia el índice único a la forma compacta
-- ------------------------------------------------------------

with duplicados as (
  select id,
         row_number() over (
           partition by public.org_name_compact(name)
           order by created_at, id
         ) as n
  from public.organizations
)
update public.organizations o
set name = o.name || ' (' || d.n || ')',
    updated_at = now()
from duplicados d
where d.id = o.id and d.n > 1;

drop index if exists public.organizations_name_unique_normalized;

create unique index if not exists organizations_name_unique_compact
  on public.organizations (public.org_name_compact(name));

-- ------------------------------------------------------------
-- 4. Consulta de disponibilidad, con parecidos acotados
--
--   · Bloquea: misma forma compacta.
--   · Avisa: uno empieza igual que el otro con poca diferencia de
--     longitud, o están a dos ediciones de distancia (erratas).
-- ------------------------------------------------------------

create or replace function public.check_organization_name(p_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_compact text := public.org_name_compact(p_name);
  v_taken boolean;
  v_similar jsonb;
begin
  if length(v_compact) = 0 then
    return jsonb_build_object('available', false, 'reason', 'EMPTY', 'similar', '[]'::jsonb);
  end if;

  select exists (
    select 1 from public.organizations o
    where public.org_name_compact(o.name) = v_compact
  ) into v_taken;

  select coalesce(jsonb_agg(nombre order by nombre), '[]'::jsonb)
  into v_similar
  from (
    select distinct o.name as nombre
    from public.organizations o
    where public.org_name_compact(o.name) <> v_compact
      and (
        -- Uno contiene al otro desde el inicio, con longitudes cercanas.
        (
          length(v_compact) >= 5
          and abs(length(public.org_name_compact(o.name)) - length(v_compact)) <= 5
          and (
            public.org_name_compact(o.name) like v_compact || '%'
            or v_compact like public.org_name_compact(o.name) || '%'
          )
        )
        -- O es prácticamente el mismo nombre con una errata.
        or (
          length(v_compact) >= 5
          and public.edit_distance(public.org_name_compact(o.name), v_compact) <= 2
        )
      )
    limit 5
  ) parecidos;

  return jsonb_build_object(
    'available', not v_taken,
    'reason', case when v_taken then 'TAKEN' else 'OK' end,
    'similar', v_similar
  );
end;
$$;

grant execute on function public.check_organization_name(text) to anon, authenticated;

create or replace function public.organization_name_available(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from public.organizations
    where public.org_name_compact(name) = public.org_name_compact(p_name)
  );
$$;

grant execute on function public.organization_name_available(text) to anon, authenticated;

commit;
