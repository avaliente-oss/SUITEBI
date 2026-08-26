begin;

-- ============================================================
-- Calidad de las sugerencias de nombres parecidos
--
-- Dos defectos observados con datos reales:
--
--   1. Las organizaciones renombradas para deshacer duplicados
--      ("prueba" y "prueba (2)") aparecían las dos como sugerencia.
--      Escribir "prueba" respondía "existe algo parecido: prueba (2)",
--      que se lee como un error del sistema. Ahora las variantes con
--      sufijo "(N)" se agrupan y sólo se muestra una.
--
--   2. El tope de diferencia de longitud (5) impedía avisar de
--      "Davalsy" cuando existe "Davalsy Solutions". Cuando un nombre
--      empieza igual que otro, el largo no debería importar: la
--      confusión existe igual. Se conserva un mínimo de 6 caracteres
--      para no marcar todo lo que empiece con "grupo" o "corp".
--
-- Además se ordenan por cercanía y se limitan a cuatro, para que el
-- aviso sea legible.
-- ============================================================

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

  with candidatos as (
    select
      o.name,
      public.org_name_compact(o.name) as comp,
      -- Forma base: sin el sufijo "(N)" que agregamos al deshacer
      -- duplicados, para poder agrupar las variantes.
      public.org_name_compact(regexp_replace(o.name, '\s*\(\d+\)\s*$', '')) as base
    from public.organizations o
  ),
  filtrados as (
    select
      c.name,
      c.base,
      public.edit_distance(c.comp, v_compact) as distancia
    from candidatos c
    where c.comp <> v_compact
      and (
        -- Erratas: una o dos letras de diferencia.
        public.edit_distance(c.comp, v_compact) <= 2
        -- O uno empieza igual que el otro, sin importar cuánto más largo sea.
        or (
          least(length(c.comp), length(v_compact)) >= 6
          and (c.comp like v_compact || '%' or v_compact like c.comp || '%')
        )
      )
  ),
  representantes as (
    select distinct on (base) name, distancia
    from filtrados
    order by base, distancia, name
  )
  select coalesce(jsonb_agg(name order by distancia, name), '[]'::jsonb)
  into v_similar
  from (
    select name, distancia from representantes order by distancia, name limit 4
  ) elegidos;

  return jsonb_build_object(
    'available', not v_taken,
    'reason', case when v_taken then 'TAKEN' else 'OK' end,
    'similar', v_similar
  );
end;
$$;

grant execute on function public.check_organization_name(text) to anon, authenticated;

commit;
