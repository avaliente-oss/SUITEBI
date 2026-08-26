begin;

-- ============================================================
-- Gestión de equipo desde el panel del cliente
--
-- Hasta ahora sólo DAVALSY podía mover a la gente de una organización.
-- Con esto, el propietario, copropietario y administrador de cada
-- organización administran su propio equipo, con los permisos que ya
-- existían (members.invite / members.manage).
--
-- Los mismos límites que en el panel de plataforma:
--   · Nadie crea ni degrada propietarios desde aquí.
--   · El propietario principal es intocable.
--   · Se respeta el cupo de usuarios del plan.
--   · No se agregan cuentas desactivadas.
--   · Nadie se quita a sí mismo (evita dejar la organización sin quien
--     la administre por un clic distraído).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Ver el equipo
-- ------------------------------------------------------------

create or replace function public.org_list_team(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_can_manage boolean;
  v_can_invite boolean;
  v_limit bigint;
  v_active bigint;
begin
  if not public.is_active_organization_member(p_organization_id) then
    raise exception 'NOT_ORGANIZATION_MEMBER' using errcode = '42501';
  end if;

  v_can_manage := public.has_organization_permission(p_organization_id, 'members.manage');
  v_can_invite := public.has_organization_permission(p_organization_id, 'members.invite');
  v_limit := public.get_feature_limit(p_organization_id, 'users');

  select count(*) into v_active
  from public.organization_members
  where organization_id = p_organization_id and status = 'active';

  return jsonb_build_object(
    'canManage', v_can_manage,
    'canInvite', v_can_invite,
    'userLimit', v_limit,
    'activeCount', v_active,
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'userId', om.user_id,
          'email', p.email,
          'fullName', coalesce(p.full_name, ''),
          'role', om.role,
          'status', om.status,
          'isPrimaryOwner', om.is_primary_owner,
          'isSelf', om.user_id = auth.uid(),
          'joinedAt', om.joined_at
        )
        order by om.is_primary_owner desc, om.role, p.email
      )
      from public.organization_members om
      left join public.profiles p on p.id = om.user_id
      where om.organization_id = p_organization_id
        and om.status <> 'removed'
    ), '[]'::jsonb),
    'invitations', case when v_can_invite then coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'email', i.email,
          'role', i.role,
          'token', i.token_hash,
          'expiresAt', i.expires_at
        )
        order by i.created_at desc
      )
      from public.invitations i
      where i.organization_id = p_organization_id
        and i.status = 'pending'
        and i.expires_at >= now()
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

revoke all on function public.org_list_team(uuid) from public, anon;
grant execute on function public.org_list_team(uuid) to authenticated;

-- ------------------------------------------------------------
-- 2. Agregar a alguien que ya tiene cuenta
-- ------------------------------------------------------------

create or replace function public.org_add_member(
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
  v_active bigint;
begin
  if not public.has_organization_permission(p_organization_id, 'members.manage') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if p_role in ('owner', 'co_owner') then
    raise exception 'OWNERSHIP_CHANGE_NOT_ALLOWED_HERE';
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

  v_limit := public.get_feature_limit(p_organization_id, 'users');
  if v_limit is not null then
    select count(*) into v_active
    from public.organization_members
    where organization_id = p_organization_id
      and status = 'active'
      and user_id <> v_user_id;

    if v_active + 1 > v_limit then
      raise exception 'USER_QUOTA_EXCEEDED';
    end if;
  end if;

  if v_existing.id is null then
    insert into public.organization_members (
      organization_id, user_id, role, status, is_primary_owner, invited_by, joined_at
    ) values (
      p_organization_id, v_user_id, p_role, 'active', false, auth.uid(), now()
    );
  else
    update public.organization_members
    set role = p_role, status = 'active', removed_at = null,
        joined_at = coalesce(joined_at, now()), updated_at = now()
    where id = v_existing.id;
  end if;

  update public.invitations
  set status = 'revoked', revoked_at = now(), updated_at = now()
  where organization_id = p_organization_id
    and lower(email) = v_email
    and status = 'pending';

  insert into public.audit_logs (organization_id, actor_user_id, action, target_table, metadata)
  values (
    p_organization_id, auth.uid(), 'org.member.add', 'organization_members',
    jsonb_build_object('email', v_email, 'role', p_role)
  );
end;
$$;

revoke all on function public.org_add_member(uuid, text, public.organization_role) from public, anon;
grant execute on function public.org_add_member(uuid, text, public.organization_role) to authenticated;

-- ------------------------------------------------------------
-- 3. Cambiar rol
-- ------------------------------------------------------------

create or replace function public.org_set_member_role(
  p_organization_id uuid,
  p_user_id uuid,
  p_role public.organization_role
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.organization_members%rowtype;
begin
  if not public.has_organization_permission(p_organization_id, 'members.manage') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select * into v_current
  from public.organization_members
  where organization_id = p_organization_id and user_id = p_user_id;

  if v_current.id is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  if v_current.is_primary_owner then
    raise exception 'CANNOT_CHANGE_PRIMARY_OWNER';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'CANNOT_CHANGE_SELF';
  end if;

  if p_role in ('owner', 'co_owner') or v_current.role in ('owner', 'co_owner') then
    raise exception 'OWNERSHIP_CHANGE_NOT_ALLOWED_HERE';
  end if;

  update public.organization_members
  set role = p_role, updated_at = now()
  where id = v_current.id;

  insert into public.audit_logs (organization_id, actor_user_id, action, target_table, target_id, metadata)
  values (
    p_organization_id, auth.uid(), 'org.member.set_role', 'organization_members', v_current.id,
    jsonb_build_object('user_id', p_user_id, 'from', v_current.role, 'to', p_role)
  );
end;
$$;

revoke all on function public.org_set_member_role(uuid, uuid, public.organization_role) from public, anon;
grant execute on function public.org_set_member_role(uuid, uuid, public.organization_role) to authenticated;

-- ------------------------------------------------------------
-- 4. Suspender, reactivar o quitar
-- ------------------------------------------------------------

create or replace function public.org_set_member_status(
  p_organization_id uuid,
  p_user_id uuid,
  p_status public.membership_status
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.organization_members%rowtype;
  v_limit bigint;
  v_active bigint;
begin
  if not public.has_organization_permission(p_organization_id, 'members.manage') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if p_status not in ('active', 'suspended', 'removed') then
    raise exception 'INVALID_STATUS';
  end if;

  select * into v_current
  from public.organization_members
  where organization_id = p_organization_id and user_id = p_user_id;

  if v_current.id is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  if v_current.is_primary_owner then
    raise exception 'CANNOT_DEACTIVATE_PRIMARY_OWNER';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'CANNOT_CHANGE_SELF';
  end if;

  if v_current.role in ('owner', 'co_owner') then
    raise exception 'OWNERSHIP_CHANGE_NOT_ALLOWED_HERE';
  end if;

  if p_status = 'active' and v_current.status <> 'active' then
    v_limit := public.get_feature_limit(p_organization_id, 'users');
    if v_limit is not null then
      select count(*) into v_active
      from public.organization_members
      where organization_id = p_organization_id
        and status = 'active'
        and user_id <> p_user_id;

      if v_active + 1 > v_limit then
        raise exception 'USER_QUOTA_EXCEEDED';
      end if;
    end if;
  end if;

  update public.organization_members
  set status = p_status,
      removed_at = case when p_status = 'removed' then now() else null end,
      joined_at = case when p_status = 'active' and joined_at is null then now() else joined_at end,
      updated_at = now()
  where id = v_current.id;

  insert into public.audit_logs (organization_id, actor_user_id, action, target_table, target_id, metadata)
  values (
    p_organization_id, auth.uid(), 'org.member.set_status', 'organization_members', v_current.id,
    jsonb_build_object('user_id', p_user_id, 'from', v_current.status, 'to', p_status)
  );
end;
$$;

revoke all on function public.org_set_member_status(uuid, uuid, public.membership_status) from public, anon;
grant execute on function public.org_set_member_status(uuid, uuid, public.membership_status) to authenticated;

-- ------------------------------------------------------------
-- 5. Invitaciones del propio equipo
-- ------------------------------------------------------------

create or replace function public.org_create_invitation(
  p_organization_id uuid,
  p_email text,
  p_role public.organization_role
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text;
  v_id uuid;
  v_member_id uuid;
  v_limit bigint;
  v_active bigint;
begin
  if not public.has_organization_permission(p_organization_id, 'members.invite') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL';
  end if;

  if p_role in ('owner', 'co_owner') then
    raise exception 'OWNERSHIP_INVITATION_NOT_ALLOWED_HERE';
  end if;

  if exists (
    select 1
    from public.organization_members om
    join public.profiles p on p.id = om.user_id
    where om.organization_id = p_organization_id
      and lower(p.email) = v_email
      and om.status <> 'removed'
  ) then
    raise exception 'ALREADY_A_MEMBER';
  end if;

  v_limit := public.get_feature_limit(p_organization_id, 'users');
  if v_limit is not null then
    select count(*) into v_active
    from public.organization_members
    where organization_id = p_organization_id and status = 'active';

    if v_active + 1 > v_limit then
      raise exception 'USER_QUOTA_EXCEEDED';
    end if;
  end if;

  select id into v_member_id
  from public.organization_members
  where organization_id = p_organization_id and user_id = auth.uid();

  update public.invitations
  set status = 'revoked', revoked_at = now(), updated_at = now()
  where organization_id = p_organization_id
    and lower(email) = v_email
    and status = 'pending';

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.invitations (
    organization_id, email, role, status, token_hash, invited_by_member_id, expires_at
  ) values (
    p_organization_id, v_email, p_role, 'pending', v_token, v_member_id, now() + interval '7 days'
  )
  returning id into v_id;

  insert into public.audit_logs (organization_id, actor_user_id, action, target_table, target_id, metadata)
  values (
    p_organization_id, auth.uid(), 'org.invitation.create', 'invitations', v_id,
    jsonb_build_object('email', v_email, 'role', p_role)
  );

  return jsonb_build_object('id', v_id, 'token', v_token, 'email', v_email);
end;
$$;

revoke all on function public.org_create_invitation(uuid, text, public.organization_role) from public, anon;
grant execute on function public.org_create_invitation(uuid, text, public.organization_role) to authenticated;

create or replace function public.org_revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.invitations where id = p_invitation_id;
  if v_org is null then
    raise exception 'INVITATION_NOT_FOUND';
  end if;

  if not public.has_organization_permission(v_org, 'members.invite') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  update public.invitations
  set status = 'revoked', revoked_at = now(), updated_at = now()
  where id = p_invitation_id and status = 'pending';

  insert into public.audit_logs (organization_id, actor_user_id, action, target_table, target_id, metadata)
  values (v_org, auth.uid(), 'org.invitation.revoke', 'invitations', p_invitation_id, '{}'::jsonb);
end;
$$;

revoke all on function public.org_revoke_invitation(uuid) from public, anon;
grant execute on function public.org_revoke_invitation(uuid) to authenticated;

-- ============================================================
-- 6. Borrar usuario desde el panel de plataforma
--
-- Alcance real: lo saca de TODAS las organizaciones y desactiva su
-- perfil, con lo que pierde acceso a todo. La credencial de acceso vive
-- en auth.users y borrarla exigiría la llave service_role, que este
-- proyecto no usa; por eso la función se llama "desactivar y desvincular"
-- en la interfaz y no promete más de lo que hace.
-- ============================================================

create or replace function public.admin_purge_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_orgs integer;
  v_email text;
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

  -- Si es propietario principal de alguna organización, primero hay que
  -- traspasar esa propiedad: si no, la organización quedaría huérfana.
  if exists (
    select 1 from public.organization_members
    where user_id = p_user_id and is_primary_owner and status = 'active'
  ) then
    raise exception 'USER_IS_PRIMARY_OWNER';
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
    jsonb_build_object('email', v_email, 'organizaciones', v_orgs)
  );

  return jsonb_build_object('organizaciones', v_orgs);
end;
$$;

revoke all on function public.admin_purge_user(uuid) from public, anon;
grant execute on function public.admin_purge_user(uuid) to authenticated;

commit;
