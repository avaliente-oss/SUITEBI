begin;

-- ============================================================
-- Gestión de usuarios desde el panel admin (cross-tenant).
--
-- Límites deliberados, para no debilitar el modelo de seguridad
-- que ya existe:
--
--   1. Un admin de plataforma NO puede crear ni degradar roles
--      'owner' / 'co_owner'. Ese cambio lo gobierna el trigger
--      enforce_membership_role_boundaries, que exige el permiso
--      'ownership.transfer' DENTRO de la organización. La
--      transferencia de propiedad sigue siendo del dueño, vía
--      transfer_primary_owner(). Aquí solo se valida antes para
--      devolver un error legible en vez de un error de trigger.
--
--   2. El propietario primario no se puede suspender ni quitar:
--      guard_primary_owner() exige que toda organización activa
--      conserve un propietario activo.
--
--   3. La baja de un miembro es suave (status = 'removed'), no un
--      delete: se conserva la historia y es reversible.
--
--   4. No se crean usuarios con contraseña desde aquí. Eso exigiría
--      la llave service_role, que este proyecto no usa por decisión
--      de arquitectura. La alta de gente nueva va por invitación.
-- ============================================================

-- ============================================================
-- Miembros de una organización
-- ============================================================

create or replace function public.admin_list_organization_members(p_organization_id uuid)
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
        'userId', om.user_id,
        'email', p.email,
        'fullName', coalesce(p.full_name, ''),
        'role', om.role,
        'status', om.status,
        'isPrimaryOwner', om.is_primary_owner,
        'joinedAt', om.joined_at,
        'createdAt', om.created_at
      )
      order by om.is_primary_owner desc, om.role, p.email
    ),
    '[]'::jsonb
  )
  into v_result
  from public.organization_members om
  left join public.profiles p on p.id = om.user_id
  where om.organization_id = p_organization_id
    and om.status <> 'removed';

  return v_result;
end;
$$;

revoke all on function public.admin_list_organization_members(uuid) from public, anon;
grant execute on function public.admin_list_organization_members(uuid) to authenticated;

create or replace function public.admin_set_member_role(
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
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  select * into v_current
  from public.organization_members
  where organization_id = p_organization_id and user_id = p_user_id;

  if v_current.id is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  -- La propiedad de una organización no se mueve desde el panel de
  -- plataforma: es una decisión del dueño, no del proveedor.
  if v_current.is_primary_owner then
    raise exception 'CANNOT_CHANGE_PRIMARY_OWNER';
  end if;

  if p_role in ('owner', 'co_owner') or v_current.role in ('owner', 'co_owner') then
    raise exception 'OWNERSHIP_CHANGE_NOT_ALLOWED_HERE';
  end if;

  update public.organization_members
  set role = p_role, updated_at = now()
  where id = v_current.id;

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'admin.member.set_role', 'organization_members', v_current.id,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'user_id', p_user_id,
      'from', v_current.role,
      'to', p_role
    )
  );
end;
$$;

revoke all on function public.admin_set_member_role(uuid, uuid, public.organization_role) from public, anon;
grant execute on function public.admin_set_member_role(uuid, uuid, public.organization_role) to authenticated;

create or replace function public.admin_set_member_status(
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
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
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

  -- enforce_membership_role_boundaries() marca como sensible cualquier
  -- update sobre un miembro owner/co_owner, sin importar qué columna
  -- cambie. Se valida aquí para devolver un mensaje claro.
  if v_current.role in ('owner', 'co_owner') then
    raise exception 'OWNERSHIP_CHANGE_NOT_ALLOWED_HERE';
  end if;

  begin
    update public.organization_members
    set status = p_status,
        joined_at = case
          when p_status = 'active' and v_current.joined_at is null then now()
          else v_current.joined_at
        end,
        removed_at = case when p_status = 'removed' then now() else null end,
        updated_at = now()
    where id = v_current.id;
  exception
    when others then
      -- enforce_active_member_limit() puede rechazar la reactivación
      -- si la organización ya llegó al tope de usuarios de su plan.
      if sqlerrm like 'QUOTA_EXCEEDED%' then
        raise exception 'USER_QUOTA_EXCEEDED';
      elsif sqlerrm like 'FEATURE_NOT_INCLUDED%' then
        raise exception 'USERS_FEATURE_NOT_ENABLED';
      else
        raise;
      end if;
  end;

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'admin.member.set_status', 'organization_members', v_current.id,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'user_id', p_user_id,
      'from', v_current.status,
      'to', p_status
    )
  );
end;
$$;

revoke all on function public.admin_set_member_status(uuid, uuid, public.membership_status) from public, anon;
grant execute on function public.admin_set_member_status(uuid, uuid, public.membership_status) to authenticated;

-- ============================================================
-- Invitaciones
--
-- No hay proveedor de correo en este proyecto: la función devuelve
-- el token y el panel arma el enlace para que el admin lo envíe por
-- su cuenta. Cuando exista correo transaccional, basta con enviarlo
-- desde aquí sin cambiar el contrato.
-- ============================================================

create or replace function public.admin_list_invitations(p_organization_id uuid)
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
        'id', i.id,
        'email', i.email,
        'role', i.role,
        'status', i.status,
        'token', i.token_hash,
        'expiresAt', i.expires_at,
        'createdAt', i.created_at
      )
      order by i.created_at desc
    ),
    '[]'::jsonb
  )
  into v_result
  from public.invitations i
  where i.organization_id = p_organization_id
    and i.status = 'pending'
    and i.expires_at >= now();

  return v_result;
end;
$$;

revoke all on function public.admin_list_invitations(uuid) from public, anon;
grant execute on function public.admin_list_invitations(uuid) to authenticated;

create or replace function public.admin_create_invitation(
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
  v_email text := lower(trim(p_email));
  v_token text;
  v_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL';
  end if;

  -- Igual que en el cambio de rol: la propiedad no se reparte desde
  -- el panel de plataforma (enforce_invitation_role_boundaries lo
  -- bloquearía de todos modos).
  if p_role in ('owner', 'co_owner') then
    raise exception 'OWNERSHIP_INVITATION_NOT_ALLOWED_HERE';
  end if;

  if exists (
    select 1
    from public.organization_members om
    join public.profiles p on p.id = om.user_id
    where om.organization_id = p_organization_id
      and p.email = v_email
      and om.status <> 'removed'
  ) then
    raise exception 'ALREADY_A_MEMBER';
  end if;

  -- Una invitación vigente por correo y organización: la anterior se
  -- revoca para que no queden dos enlaces válidos circulando.
  update public.invitations
  set status = 'revoked', revoked_at = now(), updated_at = now()
  where organization_id = p_organization_id
    and email = v_email
    and status = 'pending';

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.invitations (organization_id, email, role, status, token_hash, expires_at)
  values (p_organization_id, v_email, p_role, 'pending', v_token, now() + interval '7 days')
  returning id into v_id;

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'admin.invitation.create', 'invitations', v_id,
    jsonb_build_object('organization_id', p_organization_id, 'email', v_email, 'role', p_role)
  );

  return jsonb_build_object('id', v_id, 'token', v_token, 'email', v_email);
end;
$$;

revoke all on function public.admin_create_invitation(uuid, text, public.organization_role) from public, anon;
grant execute on function public.admin_create_invitation(uuid, text, public.organization_role) to authenticated;

create or replace function public.admin_revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  update public.invitations
  set status = 'revoked', revoked_at = now(), updated_at = now()
  where id = p_invitation_id and status = 'pending';

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (auth.uid(), 'admin.invitation.revoke', 'invitations', p_invitation_id, '{}'::jsonb);
end;
$$;

revoke all on function public.admin_revoke_invitation(uuid) from public, anon;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;

-- ============================================================
-- Directorio global de usuarios (cross-tenant)
-- ============================================================

create or replace function public.admin_search_users(p_query text default '')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_pattern text := '%' || lower(trim(coalesce(p_query, ''))) || '%';
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(t.payload order by t.email nulls last),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      p.email,
      jsonb_build_object(
        'userId', p.id,
        'email', p.email,
        'fullName', coalesce(p.full_name, ''),
        'createdAt', p.created_at,
        'organizations', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'organizationId', o.id,
              'organizationName', o.name,
              'role', om.role,
              'status', om.status,
              'isPrimaryOwner', om.is_primary_owner
            )
            order by o.name
          )
          from public.organization_members om
          join public.organizations o on o.id = om.organization_id
          where om.user_id = p.id and om.status <> 'removed'
        ), '[]'::jsonb)
      ) as payload
    from public.profiles p
    where lower(coalesce(p.email, '')) like v_pattern
       or lower(coalesce(p.full_name, '')) like v_pattern
    order by p.email
    limit 100
  ) t;

  return v_result;
end;
$$;

revoke all on function public.admin_search_users(text) from public, anon;
grant execute on function public.admin_search_users(text) to authenticated;

-- ============================================================
-- Administradores de plataforma (staff DAVALSY)
-- ============================================================

create or replace function public.admin_list_platform_admins()
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
        'email', pa.email,
        'createdAt', pa.created_at,
        'hasAccount', exists (select 1 from public.profiles p where p.email = pa.email)
      )
      order by pa.email
    ),
    '[]'::jsonb
  )
  into v_result
  from public.platform_admins pa;

  return v_result;
end;
$$;

revoke all on function public.admin_list_platform_admins() from public, anon;
grant execute on function public.admin_list_platform_admins() to authenticated;

create or replace function public.admin_add_platform_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL';
  end if;

  insert into public.platform_admins (email) values (v_email)
  on conflict (email) do nothing;

  insert into public.audit_logs (actor_user_id, action, target_table, metadata)
  values (auth.uid(), 'admin.platform_admin.add', 'platform_admins', jsonb_build_object('email', v_email));
end;
$$;

revoke all on function public.admin_add_platform_admin(text) from public, anon;
grant execute on function public.admin_add_platform_admin(text) to authenticated;

create or replace function public.admin_remove_platform_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_self text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_remaining integer;
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  -- Nadie se quita a sí mismo: evita quedarse fuera del panel por error.
  if v_email = v_self then
    raise exception 'CANNOT_REMOVE_SELF';
  end if;

  select count(*) into v_remaining from public.platform_admins;
  if v_remaining <= 1 then
    raise exception 'LAST_PLATFORM_ADMIN';
  end if;

  delete from public.platform_admins where email = v_email;

  insert into public.audit_logs (actor_user_id, action, target_table, metadata)
  values (auth.uid(), 'admin.platform_admin.remove', 'platform_admins', jsonb_build_object('email', v_email));
end;
$$;

revoke all on function public.admin_remove_platform_admin(text) from public, anon;
grant execute on function public.admin_remove_platform_admin(text) to authenticated;

commit;
