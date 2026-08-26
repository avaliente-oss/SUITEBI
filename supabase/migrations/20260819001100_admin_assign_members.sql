begin;

-- ============================================================
-- Asignar directamente un usuario existente a una organización
--
-- Complementa a las invitaciones: cuando la persona YA tiene cuenta,
-- no tiene sentido mandarle un enlace para que confirme algo que el
-- admin ya decidió. Esto la agrega de una vez.
--
-- Respeta los mismos límites que el resto del panel:
--   · No crea propietarios ni copropietarios (eso lo gobierna el dueño).
--   · Exige que la organización tenga propietario activo.
--   · Respeta el cupo de usuarios del plan.
--   · No agrega cuentas desactivadas.
-- ============================================================

create or replace function public.admin_add_member(
  p_organization_id uuid,
  p_email text,
  p_role public.organization_role
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user_id uuid;
  v_existing public.organization_members%rowtype;
  v_limit bigint;
  v_active_members bigint;
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  if p_role in ('owner', 'co_owner') then
    raise exception 'OWNERSHIP_CHANGE_NOT_ALLOWED_HERE';
  end if;

  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'ORGANIZATION_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = p_organization_id
      and om.is_primary_owner and om.status = 'active'
  ) then
    raise exception 'ORGANIZATION_HAS_NO_OWNER';
  end if;

  select id into v_user_id from public.profiles where lower(email) = v_email;
  if v_user_id is null then
    raise exception 'OWNER_HAS_NO_ACCOUNT';
  end if;

  if not coalesce((select is_active from public.profiles where id = v_user_id), true) then
    raise exception 'ACCOUNT_DISABLED';
  end if;

  select * into v_existing
  from public.organization_members
  where organization_id = p_organization_id and user_id = v_user_id;

  if v_existing.id is not null and v_existing.status <> 'removed' then
    raise exception 'ALREADY_A_MEMBER';
  end if;

  -- Cupo del plan: sólo cuenta si la persona no estaba ya activa.
  v_limit := public.get_feature_limit(p_organization_id, 'users');
  if v_limit is not null then
    select count(*) into v_active_members
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.status = 'active'
      and om.user_id <> v_user_id;

    if v_active_members + 1 > v_limit then
      raise exception 'USER_QUOTA_EXCEEDED';
    end if;
  end if;

  if v_existing.id is null then
    insert into public.organization_members (
      organization_id, user_id, role, status, is_primary_owner, joined_at
    ) values (
      p_organization_id, v_user_id, p_role, 'active', false, now()
    );
  else
    -- Reingreso de alguien que había sido dado de baja.
    update public.organization_members
    set role = p_role,
        status = 'active',
        removed_at = null,
        joined_at = coalesce(joined_at, now()),
        updated_at = now()
    where id = v_existing.id;
  end if;

  -- Si tenía una invitación pendiente, ya no hace falta.
  update public.invitations
  set status = 'revoked', revoked_at = now(), updated_at = now()
  where organization_id = p_organization_id
    and lower(email) = v_email
    and status = 'pending';

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'admin.member.add', 'organization_members', p_organization_id,
    jsonb_build_object('email', v_email, 'role', p_role)
  );
end;
$$;

revoke all on function public.admin_add_member(uuid, text, public.organization_role) from public, anon;
grant execute on function public.admin_add_member(uuid, text, public.organization_role) to authenticated;

commit;
