begin;

-- ============================================================
-- Administración de organizaciones desde el panel admin.
--
-- Incluye una ampliación acotada del guardián de roles para poder dar
-- de alta clientes: ver el bloque siguiente.
-- ============================================================

-- ============================================================
-- 1. Ampliación del guardián de roles: arranque de organización
--
-- enforce_membership_role_boundaries() impide que alguien se nombre
-- dueño de una organización ajena: exige el permiso 'ownership.transfer'
-- DENTRO de esa organización. Un admin de plataforma no es miembro de
-- ninguna, así que no podía nombrar al primer dueño de un cliente nuevo.
--
-- Se agrega UNA excepción, deliberadamente estrecha:
--   · sólo en INSERT,
--   · sólo si quien actúa es admin de plataforma,
--   · sólo si la organización NO tiene ningún miembro todavía,
--   · sólo para crear un dueño primario activo.
--
-- Es decir: sirve para arrancar una organización vacía, nunca para
-- tomar el control de una que ya tiene gente. El resto de la función
-- queda idéntico.
-- ============================================================

create or replace function public.enforce_membership_role_boundaries()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_can_transfer boolean;
  v_existing_members integer;
  v_invitation_id uuid;
  v_invitation_is_owner_approved boolean := false;
  v_organization_id uuid;
  v_sensitive_change boolean := false;
begin
  if v_actor_user_id is null then
    if tg_op = 'DELETE' then
      return old;
    end if;

    return new;
  end if;

  if tg_op = 'INSERT' then
    v_organization_id := new.organization_id;

    select count(*)
      into v_existing_members
    from public.organization_members om
    where om.organization_id = new.organization_id
      and om.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

    if v_existing_members = 0
       and new.user_id = v_actor_user_id
       and new.role = 'owner'
       and new.status = 'active'
       and new.is_primary_owner then
      return new;
    end if;

    -- Arranque asistido por DAVALSY (ver encabezado del bloque 1).
    if v_existing_members = 0
       and new.role = 'owner'
       and new.status = 'active'
       and new.is_primary_owner
       and public.is_platform_admin() then
      return new;
    end if;

    v_sensitive_change := new.role in ('owner', 'co_owner') or new.is_primary_owner;

    if v_sensitive_change
       and new.role = 'co_owner'
       and new.metadata ? 'accepted_invitation_id'
       and (new.metadata ->> 'accepted_invitation_id') ~* '^[0-9a-f-]{36}$' then
      v_invitation_id := (new.metadata ->> 'accepted_invitation_id')::uuid;

      select exists (
        select 1
        from public.invitations i
        join public.organization_members inviter
          on inviter.id = i.invited_by_member_id
        join public.organization_role_permissions inviter_permission
          on inviter_permission.role = inviter.role
         and inviter_permission.permission_key = 'ownership.transfer'
        join public.profiles invited_profile
          on invited_profile.id = new.user_id
        where i.id = v_invitation_id
          and i.organization_id = new.organization_id
          and i.role = new.role
          and i.email = invited_profile.email
          and i.status = 'pending'
          and i.expires_at >= now()
          and inviter.organization_id = i.organization_id
          and inviter.status = 'active'
      )
        into v_invitation_is_owner_approved;

      if v_invitation_is_owner_approved then
        return new;
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    v_organization_id := new.organization_id;
    v_sensitive_change :=
      old.role in ('owner', 'co_owner')
      or new.role in ('owner', 'co_owner')
      or old.is_primary_owner <> new.is_primary_owner
      or old.organization_id <> new.organization_id;
  else
    v_organization_id := old.organization_id;
    v_sensitive_change := old.role in ('owner', 'co_owner') or old.is_primary_owner;
  end if;

  if not v_sensitive_change then
    if tg_op = 'DELETE' then
      return old;
    end if;

    return new;
  end if;

  if tg_op in ('INSERT', 'UPDATE')
     and new.role = 'co_owner'
     and new.metadata ? 'accepted_invitation_id'
     and (new.metadata ->> 'accepted_invitation_id') ~* '^[0-9a-f-]{36}$' then
    v_invitation_id := (new.metadata ->> 'accepted_invitation_id')::uuid;

    select exists (
      select 1
      from public.invitations i
      join public.organization_members inviter
        on inviter.id = i.invited_by_member_id
      join public.organization_role_permissions inviter_permission
        on inviter_permission.role = inviter.role
       and inviter_permission.permission_key = 'ownership.transfer'
      join public.profiles invited_profile
        on invited_profile.id = new.user_id
      where i.id = v_invitation_id
        and i.organization_id = new.organization_id
        and i.role = new.role
        and i.email = invited_profile.email
        and i.status = 'pending'
        and i.expires_at >= now()
        and inviter.organization_id = i.organization_id
        and inviter.status = 'active'
    )
      into v_invitation_is_owner_approved;

    if v_invitation_is_owner_approved then
      return new;
    end if;
  end if;

  v_actor_can_transfer := public.has_organization_permission(
    v_organization_id,
    'ownership.transfer',
    v_actor_user_id
  );

  if not v_actor_can_transfer then
    raise exception 'ROLE_CHANGE_REQUIRES_OWNER';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

-- ============================================================
-- 2. Catálogo de planes (para los desplegables del panel)
-- ============================================================

create or replace function public.admin_list_plans()
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
      jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description)
      order by p.sort_order
    ),
    '[]'::jsonb
  )
  into v_result
  from public.plans p;

  return v_result;
end;
$$;

revoke all on function public.admin_list_plans() from public, anon;
grant execute on function public.admin_list_plans() to authenticated;

-- ============================================================
-- 3. Crear organización
-- ============================================================

-- Quita acentos sin depender de la extensión unaccent, que puede no
-- estar instalada en el proyecto.
create or replace function public.unaccent_fallback(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select translate(
    coalesce(p_text, ''),
    'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
    'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
  );
$$;

create or replace function public.admin_create_organization(
  p_name text,
  p_plan_id text default null,
  p_owner_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_owner_email text := lower(trim(coalesce(p_owner_email, '')));
  v_owner_id uuid;
  v_base_slug text;
  v_slug text;
  v_id uuid;
  v_attempt integer := 0;
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  if length(v_name) = 0 then
    raise exception 'NAME_REQUIRED';
  end if;

  if v_owner_email <> '' then
    select id into v_owner_id from public.profiles where email = v_owner_email;

    if v_owner_id is null then
      -- No se puede nombrar dueño a alguien sin cuenta: la membresía
      -- necesita un usuario real. Se crea la organización sin dueño y se
      -- asigna después con admin_set_primary_owner().
      raise exception 'OWNER_HAS_NO_ACCOUNT';
    end if;
  end if;

  -- Slug a partir del nombre: minúsculas, sin acentos, sin símbolos.
  v_base_slug := regexp_replace(
    regexp_replace(
      lower(unaccent_fallback(v_name)),
      '[^a-z0-9]+', '-', 'g'
    ),
    '(^-+|-+$)', '', 'g'
  );
  v_base_slug := left(nullif(v_base_slug, ''), 55);
  if v_base_slug is null then
    v_base_slug := 'organizacion';
  end if;

  v_slug := v_base_slug;
  while exists (select 1 from public.organizations where slug = v_slug) loop
    v_attempt := v_attempt + 1;
    if v_attempt > 20 then
      raise exception 'SLUG_UNAVAILABLE';
    end if;
    v_slug := v_base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
  end loop;

  -- created_by dispara create_owner_membership_for_new_organization(),
  -- que crea la membresía de dueño. Si no hay dueño todavía, la
  -- organización nace inactiva para no violar guard_primary_owner().
  insert into public.organizations (name, slug, status, created_by)
  values (
    v_name,
    v_slug,
    case when v_owner_id is null then 'inactive'::public.organization_status
         else 'active'::public.organization_status end,
    v_owner_id
  )
  returning id into v_id;

  if p_plan_id is not null and p_plan_id <> '' then
    update public.subscriptions
    set plan_id = p_plan_id, updated_at = now()
    where organization_id = v_id and is_current;
  end if;

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'admin.organization.create', 'organizations', v_id,
    jsonb_build_object('name', v_name, 'slug', v_slug, 'plan_id', p_plan_id, 'owner_email', nullif(v_owner_email, ''))
  );

  return jsonb_build_object('id', v_id, 'slug', v_slug, 'hasOwner', v_owner_id is not null);
end;
$$;

revoke all on function public.admin_create_organization(text, text, text) from public, anon;
grant execute on function public.admin_create_organization(text, text, text) to authenticated;

-- ============================================================
-- 4. Asignar el primer dueño de una organización
-- ============================================================

create or replace function public.admin_set_primary_owner(
  p_organization_id uuid,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user_id uuid;
  v_existing_member public.organization_members%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id
      and is_primary_owner
      and status = 'active'
  ) then
    raise exception 'ORGANIZATION_ALREADY_HAS_OWNER';
  end if;

  select id into v_user_id from public.profiles where email = v_email;
  if v_user_id is null then
    raise exception 'OWNER_HAS_NO_ACCOUNT';
  end if;

  select * into v_existing_member
  from public.organization_members
  where organization_id = p_organization_id and user_id = v_user_id;

  if v_existing_member.id is null then
    insert into public.organization_members (
      organization_id, user_id, role, status, is_primary_owner, joined_at
    ) values (
      p_organization_id, v_user_id, 'owner', 'active', true, now()
    );
  else
    update public.organization_members
    set role = 'owner', status = 'active', is_primary_owner = true,
        joined_at = coalesce(joined_at, now()), updated_at = now()
    where id = v_existing_member.id;
  end if;

  update public.organizations
  set status = 'active', updated_at = now()
  where id = p_organization_id and status <> 'active';

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'admin.organization.set_primary_owner', 'organizations', p_organization_id,
    jsonb_build_object('email', v_email)
  );
end;
$$;

revoke all on function public.admin_set_primary_owner(uuid, text) from public, anon;
grant execute on function public.admin_set_primary_owner(uuid, text) to authenticated;

-- ============================================================
-- 5. Editar organización: nombre, estado, plan
-- ============================================================

create or replace function public.admin_update_organization(
  p_organization_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  if length(v_name) = 0 then
    raise exception 'NAME_REQUIRED';
  end if;

  -- El slug no se toca: es el identificador estable de la organización.
  update public.organizations
  set name = v_name, updated_at = now()
  where id = p_organization_id;

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'admin.organization.rename', 'organizations', p_organization_id,
    jsonb_build_object('name', v_name)
  );
end;
$$;

revoke all on function public.admin_update_organization(uuid, text) from public, anon;
grant execute on function public.admin_update_organization(uuid, text) to authenticated;

create or replace function public.admin_set_organization_status(
  p_organization_id uuid,
  p_status public.organization_status
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

  update public.organizations
  set status = p_status, updated_at = now()
  where id = p_organization_id;

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'admin.organization.set_status', 'organizations', p_organization_id,
    jsonb_build_object('status', p_status)
  );
end;
$$;

revoke all on function public.admin_set_organization_status(uuid, public.organization_status) from public, anon;
grant execute on function public.admin_set_organization_status(uuid, public.organization_status) to authenticated;

create or replace function public.admin_set_organization_plan(
  p_organization_id uuid,
  p_plan_id text,
  p_access_status public.subscription_access_status
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subscription_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  if not exists (select 1 from public.plans where id = p_plan_id) then
    raise exception 'PLAN_NOT_FOUND';
  end if;

  select id into v_subscription_id
  from public.subscriptions
  where organization_id = p_organization_id and is_current
  limit 1;

  if v_subscription_id is null then
    insert into public.subscriptions (organization_id, plan_id, is_current, access_status)
    values (p_organization_id, p_plan_id, true, p_access_status);
  else
    update public.subscriptions
    set plan_id = p_plan_id, access_status = p_access_status, updated_at = now()
    where id = v_subscription_id;
  end if;

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'admin.organization.set_plan', 'organizations', p_organization_id,
    jsonb_build_object('plan_id', p_plan_id, 'access_status', p_access_status)
  );
end;
$$;

revoke all on function public.admin_set_organization_plan(uuid, text, public.subscription_access_status) from public, anon;
grant execute on function public.admin_set_organization_plan(uuid, text, public.subscription_access_status) to authenticated;

-- ============================================================
-- 6. Eliminar organización (destructivo)
--
-- Exige escribir el nombre exacto como confirmación. El borrado
-- arrastra en cascada miembros, suscripciones, invitaciones,
-- excepciones de features, espacios y recursos de esa organización.
-- ============================================================

create or replace function public.admin_delete_organization(
  p_organization_id uuid,
  p_confirm_name text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  select name into v_name from public.organizations where id = p_organization_id;

  if v_name is null then
    raise exception 'ORGANIZATION_NOT_FOUND';
  end if;

  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(v_name)) then
    raise exception 'CONFIRMATION_MISMATCH';
  end if;

  -- Se registra ANTES de borrar: después el renglón ya no existe.
  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'admin.organization.delete', 'organizations', p_organization_id,
    jsonb_build_object('name', v_name)
  );

  -- Inactivar primero deja pasar a guard_primary_owner() cuando la
  -- cascada empiece a borrar membresías.
  update public.organizations set status = 'inactive' where id = p_organization_id;
  delete from public.organizations where id = p_organization_id;
end;
$$;

revoke all on function public.admin_delete_organization(uuid, text) from public, anon;
grant execute on function public.admin_delete_organization(uuid, text) to authenticated;

-- ============================================================
-- 7. Edición de usuarios
--
-- No se crean ni se eliminan cuentas desde aquí: eso vive en
-- auth.users y exigiría la llave service_role, que este proyecto no
-- usa. Desactivar el perfil sí corta el acceso: authorize_action()
-- rechaza a cualquier usuario con is_active = false.
-- ============================================================

create or replace function public.admin_update_user_profile(
  p_user_id uuid,
  p_full_name text
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

  update public.profiles
  set full_name = nullif(trim(coalesce(p_full_name, '')), ''), updated_at = now()
  where id = p_user_id;

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'admin.user.update_profile', 'profiles', p_user_id,
    jsonb_build_object('full_name', p_full_name)
  );
end;
$$;

revoke all on function public.admin_update_user_profile(uuid, text) from public, anon;
grant execute on function public.admin_update_user_profile(uuid, text) to authenticated;

create or replace function public.admin_set_user_active(
  p_user_id uuid,
  p_is_active boolean
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

  if p_user_id = auth.uid() and not p_is_active then
    raise exception 'CANNOT_DEACTIVATE_SELF';
  end if;

  update public.profiles
  set is_active = p_is_active, updated_at = now()
  where id = p_user_id;

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'admin.user.set_active', 'profiles', p_user_id,
    jsonb_build_object('is_active', p_is_active)
  );
end;
$$;

revoke all on function public.admin_set_user_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;

-- El directorio ahora expone si el perfil está activo, para poder
-- mostrarlo y alternarlo desde el panel.
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
        'isActive', coalesce(p.is_active, true),
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

commit;
