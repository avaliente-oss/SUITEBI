begin;

-- ============================================================
-- Baja de usuario: caso de la organización de un solo dueño
--
-- La versión anterior rechazaba dar de baja a cualquier propietario
-- principal, para no dejar organizaciones huérfanas. En la práctica eso
-- bloqueaba casi todas las bajas: como cada registro crea su propia
-- organización, casi todo el mundo es propietario de alguna.
--
-- Ahora se distingue:
--   · Si la organización tiene MÁS gente, sigue bloqueado: hay que
--     traspasar la propiedad primero, porque afecta a terceros.
--   · Si la persona es el único miembro activo, la organización se
--     desactiva junto con ella. Nadie más se ve afectado.
--
-- El segundo caso exige pedirlo explícitamente (p_close_solo_orgs),
-- para que la interfaz pueda advertir antes de hacerlo.
-- ============================================================

create or replace function public.admin_purge_user(
  p_user_id uuid,
  p_close_solo_orgs boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_orgs integer;
  v_solo uuid[];
  v_compartidas text[];
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'CANNOT_REMOVE_SELF';
  end if;

  select email into v_email from public.profiles where id = p_user_id;
  if v_email is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  -- Organizaciones donde es propietario principal Y hay alguien más.
  select coalesce(array_agg(o.name), '{}')
  into v_compartidas
  from public.organization_members om
  join public.organizations o on o.id = om.organization_id
  where om.user_id = p_user_id
    and om.is_primary_owner
    and om.status = 'active'
    and exists (
      select 1 from public.organization_members otros
      where otros.organization_id = om.organization_id
        and otros.user_id <> p_user_id
        and otros.status = 'active'
    );

  if array_length(v_compartidas, 1) > 0 then
    raise exception 'USER_IS_PRIMARY_OWNER: %', array_to_string(v_compartidas, ', ');
  end if;

  -- Organizaciones donde es el único miembro activo.
  select coalesce(array_agg(om.organization_id), '{}')
  into v_solo
  from public.organization_members om
  where om.user_id = p_user_id
    and om.is_primary_owner
    and om.status = 'active';

  if array_length(v_solo, 1) > 0 and not p_close_solo_orgs then
    raise exception 'USER_OWNS_SOLO_ORGS';
  end if;

  -- Se desactivan primero: guard_primary_owner sólo exige propietario
  -- activo en organizaciones activas.
  if array_length(v_solo, 1) > 0 then
    update public.organizations
    set status = 'inactive', updated_at = now()
    where id = any(v_solo);
  end if;

  update public.organization_members
  set status = 'removed', removed_at = now(), updated_at = now()
  where user_id = p_user_id and status <> 'removed';

  get diagnostics v_orgs = row_count;

  update public.profiles
  set is_active = false, updated_at = now()
  where id = p_user_id;

  update public.invitations
  set status = 'revoked', revoked_at = now(), updated_at = now()
  where lower(email) = lower(v_email) and status = 'pending';

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'admin.user.purge', 'profiles', p_user_id,
    jsonb_build_object(
      'email', v_email,
      'membresias', v_orgs,
      'organizaciones_desactivadas', coalesce(array_length(v_solo, 1), 0)
    )
  );

  return jsonb_build_object(
    'membresias', v_orgs,
    'organizacionesDesactivadas', coalesce(array_length(v_solo, 1), 0)
  );
end;
$$;

revoke all on function public.admin_purge_user(uuid, boolean) from public, anon;
grant execute on function public.admin_purge_user(uuid, boolean) to authenticated;

-- Se retira la firma anterior de un solo parámetro para que PostgREST no
-- tenga dos versiones que resolver.
drop function if exists public.admin_purge_user(uuid);

commit;
