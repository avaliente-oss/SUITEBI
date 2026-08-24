begin;

-- ============================================================
-- Integridad end-to-end de usuarios y organizaciones
--
-- Cierra los huecos que permitían estados ambiguos:
--   · nombres de organización duplicados
--   · dos soluciones compitiendo por el mismo feature
--   · varias invitaciones vigentes al mismo correo y organización
--   · aceptar una invitación con la cuenta desactivada
--   · aceptar una invitación a una organización sin propietario
--   · rebasar el cupo de usuarios del plan al aceptar
-- ============================================================

-- ------------------------------------------------------------
-- 1. Nombres de organización únicos (sin distinguir mayúsculas)
--
-- Primero se resuelven los duplicados que ya existan, agregando un
-- sufijo numérico estable por antigüedad. Después se impide que
-- vuelvan a ocurrir.
-- ------------------------------------------------------------

with duplicados as (
  select id,
         row_number() over (partition by lower(trim(name)) order by created_at, id) as n
  from public.organizations
)
update public.organizations o
set name = o.name || ' (' || d.n || ')',
    updated_at = now()
from duplicados d
where d.id = o.id and d.n > 1;

create unique index if not exists organizations_name_unique_ci
  on public.organizations (lower(trim(name)));

-- ------------------------------------------------------------
-- 2. Un feature pertenece a lo más a una solución
--
-- Si dos soluciones comparten feature_key, organization_has_feature()
-- tendría que elegir una arbitrariamente.
-- ------------------------------------------------------------

create unique index if not exists solutions_feature_key_unique
  on public.solutions (feature_key);

-- ------------------------------------------------------------
-- 3. Una sola invitación vigente por correo y organización
--
-- Evita que circulen dos enlaces válidos para la misma persona.
-- ------------------------------------------------------------

update public.invitations i
set status = 'revoked', revoked_at = now(), updated_at = now()
where i.status = 'pending'
  and exists (
    select 1 from public.invitations j
    where j.organization_id = i.organization_id
      and lower(j.email) = lower(i.email)
      and j.status = 'pending'
      and (j.created_at > i.created_at or (j.created_at = i.created_at and j.id > i.id))
  );

create unique index if not exists invitations_pending_unique
  on public.invitations (organization_id, lower(email))
  where status = 'pending';

-- ------------------------------------------------------------
-- 4. Un correo, un perfil
-- ------------------------------------------------------------

create unique index if not exists profiles_email_unique_ci
  on public.profiles (lower(email))
  where email is not null;

-- ------------------------------------------------------------
-- 5. Aceptación de invitación endurecida
--
-- Cuerpo original de accept_invitation() con las validaciones nuevas
-- señaladas en el bloque de endurecimiento.
-- ------------------------------------------------------------

create or replace function public.accept_invitation(
  p_token_hash text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invitation public.invitations%rowtype;
  v_member_id uuid;
  v_inviter_user_id uuid;
  v_user_limit bigint;
  v_active_members bigint;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if p_token_hash is null or length(trim(p_token_hash)) = 0 then
    raise exception 'INVITATION_TOKEN_REQUIRED';
  end if;

  v_user_email := lower(auth.jwt() ->> 'email');

  if v_user_email is null then
    select email
      into v_user_email
    from public.profiles
    where id = v_user_id;
  end if;

  select *
    into v_invitation
  from public.invitations
  where token_hash = p_token_hash
    and status = 'pending'
  for update;

  if v_invitation.id is null then
    raise exception 'INVITATION_NOT_FOUND';
  end if;

  if v_invitation.expires_at < now() then
    update public.invitations
    set status = 'expired',
        updated_at = now()
    where id = v_invitation.id;

    raise exception 'INVITATION_EXPIRED';
  end if;

  if v_user_email is null or v_user_email <> v_invitation.email then
    raise exception 'INVITATION_EMAIL_MISMATCH';
  end if;

  -- --- Endurecimiento (migración 000700) ---------------------------
  -- Cuenta desactivada globalmente: no entra a ninguna organización.
  if not coalesce((select p.is_active from public.profiles p where p.id = v_user_id), true) then
    raise exception 'ACCOUNT_DISABLED';
  end if;

  -- Una organización sin propietario activo no puede recibir miembros:
  -- quedaría en un estado que guard_primary_owner considera inválido.
  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = v_invitation.organization_id
      and om.is_primary_owner
      and om.status = 'active'
  ) then
    raise exception 'ORGANIZATION_HAS_NO_OWNER';
  end if;

  -- Cupo de usuarios del plan: se valida aquí para devolver un error
  -- legible en vez del que lanzaría enforce_active_member_limit.
  if not public.organization_has_feature(v_invitation.organization_id, 'users') then
    raise exception 'USERS_FEATURE_NOT_ENABLED';
  end if;

  v_user_limit := public.get_feature_limit(v_invitation.organization_id, 'users');
  if v_user_limit is not null then
    select count(*) into v_active_members
    from public.organization_members om
    where om.organization_id = v_invitation.organization_id
      and om.status = 'active'
      and om.user_id <> v_user_id;

    if v_active_members + 1 > v_user_limit then
      raise exception 'USER_QUOTA_EXCEEDED';
    end if;
  end if;
  -- ------------------------------------------------------------------

  select inviter.user_id
    into v_inviter_user_id
  from public.organization_members inviter
  where inviter.id = v_invitation.invited_by_member_id;

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    status,
    is_primary_owner,
    invited_by,
    invited_at,
    joined_at,
    metadata
  )
  values (
    v_invitation.organization_id,
    v_user_id,
    v_invitation.role,
    'active',
    false,
    v_inviter_user_id,
    v_invitation.created_at,
    now(),
    jsonb_build_object('accepted_invitation_id', v_invitation.id)
  )
  on conflict (organization_id, user_id) do update set
    role = excluded.role,
    status = 'active',
    invited_by = excluded.invited_by,
    invited_at = excluded.invited_at,
    joined_at = coalesce(public.organization_members.joined_at, now()),
    removed_at = null,
    metadata = public.organization_members.metadata || excluded.metadata,
    updated_at = now()
  returning id into v_member_id;

  update public.invitations
  set status = 'accepted',
      accepted_by = v_user_id,
      accepted_at = now(),
      updated_at = now()
  where id = v_invitation.id;

  insert into public.audit_logs (
    organization_id,
    actor_user_id,
    actor_member_id,
    action,
    target_table,
    target_id,
    metadata
  )
  values (
    v_invitation.organization_id,
    v_user_id,
    v_member_id,
    'members.accept_invitation',
    'organization_members',
    v_member_id,
    jsonb_build_object('invitation_id', v_invitation.id)
  );

  return v_member_id;
end;
$$;


revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- ------------------------------------------------------------
-- 6. Crear invitación: validar antes de mandar el enlace
--
-- Mejor rechazar aquí, frente al admin, que dejar que la persona
-- invitada descubra el problema al hacer clic.
-- ------------------------------------------------------------

create or replace function public.admin_create_invitation(
  p_organization_id uuid,
  p_email text,
  p_role public.organization_role
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text;
  v_id uuid;
  v_limit bigint;
  v_active_members bigint;
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL';
  end if;

  if p_role in ('owner', 'co_owner') then
    raise exception 'OWNERSHIP_INVITATION_NOT_ALLOWED_HERE';
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

  -- Cupo: no tiene caso invitar si al aceptar va a rebotar.
  v_limit := public.get_feature_limit(p_organization_id, 'users');
  if v_limit is not null then
    select count(*) into v_active_members
    from public.organization_members om
    where om.organization_id = p_organization_id and om.status = 'active';

    if v_active_members + 1 > v_limit then
      raise exception 'USER_QUOTA_EXCEEDED';
    end if;
  end if;

  update public.invitations
  set status = 'revoked', revoked_at = now(), updated_at = now()
  where organization_id = p_organization_id
    and lower(email) = v_email
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
$fn$;

revoke all on function public.admin_create_invitation(uuid, text, public.organization_role) from public, anon;
grant execute on function public.admin_create_invitation(uuid, text, public.organization_role) to authenticated;

-- ------------------------------------------------------------
-- 7. Nombre de organización disponible (para el registro)
-- ------------------------------------------------------------

create or replace function public.organization_name_available(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select not exists (
    select 1 from public.organizations
    where lower(trim(name)) = lower(trim(coalesce(p_name, '')))
  );
$fn$;

grant execute on function public.organization_name_available(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 8. Alta y edición de organizaciones: nombre único con error claro
-- ------------------------------------------------------------

create or replace function public.admin_update_organization(
  p_organization_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_name text := trim(coalesce(p_name, ''));
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  if length(v_name) = 0 then
    raise exception 'NAME_REQUIRED';
  end if;

  if exists (
    select 1 from public.organizations
    where lower(trim(name)) = lower(v_name) and id <> p_organization_id
  ) then
    raise exception 'ORGANIZATION_NAME_TAKEN';
  end if;

  update public.organizations
  set name = v_name, updated_at = now()
  where id = p_organization_id;

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (
    auth.uid(), 'admin.organization.rename', 'organizations', p_organization_id,
    jsonb_build_object('name', v_name)
  );
end;
$fn$;

revoke all on function public.admin_update_organization(uuid, text) from public, anon;
grant execute on function public.admin_update_organization(uuid, text) to authenticated;

-- El alta también valida el nombre, para dar el mismo error legible en
-- vez de un choque de índice único.
create or replace function public.admin_create_organization(
  p_name text,
  p_plan_id text default null,
  p_owner_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
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

  if not public.organization_name_available(v_name) then
    raise exception 'ORGANIZATION_NAME_TAKEN';
  end if;

  if v_owner_email <> '' then
    select id into v_owner_id from public.profiles where lower(email) = v_owner_email;

    if v_owner_id is null then
      raise exception 'OWNER_HAS_NO_ACCOUNT';
    end if;
  end if;

  v_base_slug := regexp_replace(
    regexp_replace(lower(public.unaccent_fallback(v_name)), '[^a-z0-9]+', '-', 'g'),
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
$fn$;

revoke all on function public.admin_create_organization(text, text, text) from public, anon;
grant execute on function public.admin_create_organization(text, text, text) to authenticated;

commit;
