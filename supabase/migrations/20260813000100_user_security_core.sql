begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.organization_status as enum (
  'active',
  'inactive',
  'suspended',
  'deleted'
);

create type public.organization_role as enum (
  'owner',
  'co_owner',
  'admin',
  'analyst',
  'editor',
  'viewer',
  'external_viewer'
);

create type public.workspace_role as enum (
  'workspace_admin',
  'workspace_analyst',
  'workspace_editor',
  'workspace_viewer'
);

create type public.membership_status as enum (
  'invited',
  'active',
  'suspended',
  'removed'
);

create type public.invitation_status as enum (
  'pending',
  'accepted',
  'revoked',
  'expired'
);

create type public.workspace_status as enum (
  'active',
  'archived'
);

create type public.subscription_access_status as enum (
  'pending',
  'trial',
  'full',
  'grace',
  'limited',
  'full_until_end',
  'suspended'
);

create type public.feature_unit as enum (
  'boolean',
  'count',
  'usage',
  'seat'
);

create type public.quota_period as enum (
  'none',
  'day',
  'month',
  'billing_period'
);

create type public.permission_scope as enum (
  'organization',
  'workspace',
  'resource'
);

create type public.bi_resource_type as enum (
  'data_source',
  'dataset',
  'dashboard',
  'report',
  'metric',
  'alert'
);

create type public.bi_resource_status as enum (
  'active',
  'archived',
  'deleted'
);

create type public.resource_permission_subject as enum (
  'organization_member',
  'organization_role',
  'workspace_role'
);

create type public.permission_effect as enum (
  'allow',
  'deny'
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_is_lower check (email is null or email = lower(email))
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    avatar_url
  )
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    updated_at = now();

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_auth_user_profile();

create trigger on_auth_user_updated
after update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_auth_user_profile();

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  status public.organization_status not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_not_blank check (length(trim(name)) > 0),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$')
);

create unique index organizations_slug_unique on public.organizations (lower(slug));

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create table public.organization_roles (
  role public.organization_role primary key,
  description text not null,
  sort_order integer not null,
  can_be_primary_owner boolean not null default false
);

create table public.workspace_roles (
  role public.workspace_role primary key,
  description text not null,
  sort_order integer not null
);

create table public.plans (
  id text primary key,
  name text not null,
  description text,
  is_public boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_id_format check (id ~ '^[a-z0-9][a-z0-9_]{1,63}$')
);

create trigger plans_set_updated_at
before update on public.plans
for each row execute function public.set_updated_at();

create table public.features (
  key text primary key,
  name text not null,
  description text,
  unit public.feature_unit not null default 'boolean',
  allowed_when_limited boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint features_key_format check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$')
);

create trigger features_set_updated_at
before update on public.features
for each row execute function public.set_updated_at();

create table public.plan_features (
  plan_id text not null references public.plans(id) on delete cascade,
  feature_key text not null references public.features(key) on delete cascade,
  enabled boolean not null default true,
  limit_value bigint,
  quota_period public.quota_period not null default 'none',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, feature_key),
  constraint plan_features_limit_non_negative check (limit_value is null or limit_value >= 0)
);

create trigger plan_features_set_updated_at
before update on public.plan_features
for each row execute function public.set_updated_at();

create table public.permissions (
  key text primary key,
  scope public.permission_scope not null,
  description text not null,
  required_feature_key text references public.features(key) on delete restrict,
  consumes_feature_key text references public.features(key) on delete restrict,
  default_usage_units bigint not null default 0,
  is_sensitive boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint permissions_key_format check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  constraint permissions_default_usage_non_negative check (default_usage_units >= 0)
);

create trigger permissions_set_updated_at
before update on public.permissions
for each row execute function public.set_updated_at();

create table public.organization_role_permissions (
  role public.organization_role not null references public.organization_roles(role) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role, permission_key)
);

create table public.workspace_role_permissions (
  role public.workspace_role not null references public.workspace_roles(role) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role, permission_key)
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null default 'viewer',
  status public.membership_status not null default 'invited',
  is_primary_owner boolean not null default false,
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz,
  joined_at timestamptz,
  removed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_members_primary_owner_is_owner check (not is_primary_owner or role = 'owner')
);

create unique index organization_members_unique_user_per_org
  on public.organization_members (organization_id, user_id);

create unique index organization_members_one_active_primary_owner
  on public.organization_members (organization_id)
  where is_primary_owner and status = 'active';

create index organization_members_user_status_idx
  on public.organization_members (user_id, status);

create index organization_members_org_status_role_idx
  on public.organization_members (organization_id, status, role);

create trigger organization_members_set_updated_at
before update on public.organization_members
for each row execute function public.set_updated_at();

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.organization_role not null default 'viewer',
  status public.invitation_status not null default 'pending',
  token_hash text,
  invited_by_member_id uuid references public.organization_members(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitations_email_is_lower check (email = lower(email))
);

create unique index invitations_one_pending_per_email
  on public.invitations (organization_id, email)
  where status = 'pending';

create unique index invitations_token_hash_unique
  on public.invitations (token_hash)
  where token_hash is not null;

create trigger invitations_set_updated_at
before update on public.invitations
for each row execute function public.set_updated_at();

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id text references public.plans(id) on delete restrict,
  is_current boolean not null default true,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_status text not null default 'incomplete',
  access_status public.subscription_access_status not null default 'pending',
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  grace_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index subscriptions_one_current_per_org
  on public.subscriptions (organization_id)
  where is_current;

create unique index subscriptions_stripe_subscription_unique
  on public.subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

create index subscriptions_customer_idx
  on public.subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;

create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

create table public.stripe_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  status public.workspace_status not null default 'active',
  created_by_member_id uuid references public.organization_members(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_name_not_blank check (length(trim(name)) > 0),
  constraint workspaces_slug_format check (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$')
);

create unique index workspaces_unique_slug_per_org
  on public.workspaces (organization_id, lower(slug));

create index workspaces_org_status_idx
  on public.workspaces (organization_id, status);

create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  organization_member_id uuid not null references public.organization_members(id) on delete cascade,
  role public.workspace_role not null default 'workspace_viewer',
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index workspace_members_unique_member_per_workspace
  on public.workspace_members (workspace_id, organization_member_id);

create index workspace_members_member_status_idx
  on public.workspace_members (organization_member_id, status);

create index workspace_members_workspace_status_idx
  on public.workspace_members (workspace_id, status);

create trigger workspace_members_set_updated_at
before update on public.workspace_members
for each row execute function public.set_updated_at();

create table public.bi_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  resource_type public.bi_resource_type not null,
  name text not null,
  status public.bi_resource_status not null default 'active',
  created_by_member_id uuid references public.organization_members(id) on delete set null,
  external_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bi_resources_name_not_blank check (length(trim(name)) > 0)
);

create index bi_resources_org_workspace_type_status_idx
  on public.bi_resources (organization_id, workspace_id, resource_type, status);

create trigger bi_resources_set_updated_at
before update on public.bi_resources
for each row execute function public.set_updated_at();

create table public.resource_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  resource_id uuid references public.bi_resources(id) on delete cascade,
  action text not null references public.permissions(key) on delete cascade,
  subject_type public.resource_permission_subject not null,
  organization_member_id uuid references public.organization_members(id) on delete cascade,
  organization_role public.organization_role references public.organization_roles(role) on delete cascade,
  workspace_role public.workspace_role references public.workspace_roles(role) on delete cascade,
  effect public.permission_effect not null,
  reason text,
  created_by_member_id uuid references public.organization_members(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resource_permissions_subject_shape check (
    (subject_type = 'organization_member' and organization_member_id is not null and organization_role is null and workspace_role is null)
    or (subject_type = 'organization_role' and organization_member_id is null and organization_role is not null and workspace_role is null)
    or (subject_type = 'workspace_role' and organization_member_id is null and organization_role is null and workspace_role is not null)
  )
);

create index resource_permissions_lookup_idx
  on public.resource_permissions (organization_id, workspace_id, resource_id, action, effect);

create index resource_permissions_member_idx
  on public.resource_permissions (organization_member_id)
  where organization_member_id is not null;

create trigger resource_permissions_set_updated_at
before update on public.resource_permissions
for each row execute function public.set_updated_at();

create or replace function public.validate_resource_permission_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_org uuid;
  v_resource_org uuid;
  v_resource_workspace uuid;
  v_member_org uuid;
  v_creator_org uuid;
begin
  if new.workspace_id is not null then
    select organization_id
      into v_workspace_org
    from public.workspaces
    where id = new.workspace_id;

    if v_workspace_org is distinct from new.organization_id then
      raise exception 'RESOURCE_PERMISSION_WORKSPACE_ORGANIZATION_MISMATCH';
    end if;
  end if;

  if new.resource_id is not null then
    select organization_id, workspace_id
      into v_resource_org, v_resource_workspace
    from public.bi_resources
    where id = new.resource_id;

    if v_resource_org is distinct from new.organization_id then
      raise exception 'RESOURCE_PERMISSION_RESOURCE_ORGANIZATION_MISMATCH';
    end if;

    if new.workspace_id is not null and v_resource_workspace is distinct from new.workspace_id then
      raise exception 'RESOURCE_PERMISSION_RESOURCE_WORKSPACE_MISMATCH';
    end if;

    new.workspace_id := v_resource_workspace;
  end if;

  if new.organization_member_id is not null then
    select organization_id
      into v_member_org
    from public.organization_members
    where id = new.organization_member_id;

    if v_member_org is distinct from new.organization_id then
      raise exception 'RESOURCE_PERMISSION_MEMBER_ORGANIZATION_MISMATCH';
    end if;
  end if;

  if new.created_by_member_id is not null then
    select organization_id
      into v_creator_org
    from public.organization_members
    where id = new.created_by_member_id;

    if v_creator_org is distinct from new.organization_id then
      raise exception 'RESOURCE_PERMISSION_CREATOR_ORGANIZATION_MISMATCH';
    end if;
  end if;

  return new;
end;
$$;

create trigger resource_permissions_validate_scope
before insert or update of organization_id, workspace_id, resource_id, organization_member_id, created_by_member_id
on public.resource_permissions
for each row execute function public.validate_resource_permission_scope();

create table public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_key text not null references public.features(key) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  used_value bigint not null default 0,
  limit_value bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint usage_counters_used_non_negative check (used_value >= 0),
  constraint usage_counters_limit_non_negative check (limit_value is null or limit_value >= 0),
  constraint usage_counters_period_valid check (period_end > period_start)
);

create unique index usage_counters_unique_period
  on public.usage_counters (organization_id, feature_key, period_start, period_end);

create trigger usage_counters_set_updated_at
before update on public.usage_counters
for each row execute function public.set_updated_at();

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_key text not null references public.features(key) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  resource_id uuid references public.bi_resources(id) on delete set null,
  delta bigint not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint usage_events_delta_positive check (delta > 0),
  constraint usage_events_period_valid check (period_end > period_start)
);

create index usage_events_org_feature_created_idx
  on public.usage_events (organization_id, feature_key, created_at desc);

create table public.access_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  organization_id uuid,
  workspace_id uuid,
  resource_id uuid,
  action text not null,
  allowed boolean not null,
  reason_code text not null,
  required_feature_key text,
  upgrade_required boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index access_decisions_org_time_idx
  on public.access_decisions (organization_id, occurred_at desc);

create index access_decisions_reason_time_idx
  on public.access_decisions (reason_code, occurred_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_member_id uuid references public.organization_members(id) on delete set null,
  action text not null,
  target_table text,
  target_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index audit_logs_org_time_idx
  on public.audit_logs (organization_id, occurred_at desc);

insert into public.organization_roles (role, description, sort_order, can_be_primary_owner) values
  ('owner', 'Propiedad, facturacion, transferencia y acciones irreversibles.', 10, true),
  ('co_owner', 'Administracion amplia sin transferencia ni eliminacion de la organizacion.', 20, false),
  ('admin', 'Usuarios, workspaces, configuracion y operacion.', 30, false),
  ('analyst', 'Modelos, metricas, datasets, dashboards y analisis.', 40, false),
  ('editor', 'Edicion de contenido previamente autorizado.', 50, false),
  ('viewer', 'Consulta, filtros y navegacion sin cambios.', 60, false),
  ('external_viewer', 'Consulta restringida de contenido compartido.', 70, false);

insert into public.workspace_roles (role, description, sort_order) values
  ('workspace_admin', 'Administra miembros, configuracion y recursos del workspace.', 10),
  ('workspace_analyst', 'Crea y analiza datasets, metricas, reportes y dashboards.', 20),
  ('workspace_editor', 'Edita contenido autorizado dentro del workspace.', 30),
  ('workspace_viewer', 'Consulta contenido publicado dentro del workspace.', 40);

insert into public.plans (id, name, description, sort_order) values
  ('starter', 'Starter', 'Primer plan para equipos pequenos.', 10),
  ('business', 'Business', 'Plan operativo para empresas en crecimiento.', 20),
  ('enterprise', 'Enterprise', 'Plan a medida para organizaciones corporativas.', 30);

insert into public.features (key, name, description, unit, allowed_when_limited) values
  ('core.read', 'Lectura esencial', 'Acceso minimo de lectura cuando la cuenta esta limitada.', 'boolean', true),
  ('dashboards', 'Dashboards', 'Cantidad maxima de dashboards activos.', 'count', false),
  ('users', 'Usuarios', 'Cantidad maxima de usuarios activos por organizacion.', 'seat', false),
  ('data_sources', 'Fuentes de datos', 'Cantidad maxima de fuentes de datos activas.', 'count', false),
  ('daily_refreshes', 'Actualizaciones diarias', 'Actualizaciones disponibles por dia.', 'usage', false),
  ('dashboard.export', 'Exportar dashboards', 'Exportacion de dashboards o datos a Excel.', 'boolean', false),
  ('alerts', 'Alertas', 'Creacion y gestion de alertas.', 'boolean', false),
  ('ai.analysis', 'IA para analisis', 'Usos de analisis asistido por IA.', 'usage', false),
  ('white_label', 'Marca blanca', 'Personalizacion visual avanzada.', 'boolean', false),
  ('api.access', 'API', 'Acceso programatico a la suite.', 'boolean', false);

insert into public.plan_features (plan_id, feature_key, enabled, limit_value, quota_period) values
  ('starter', 'core.read', true, null, 'none'),
  ('starter', 'dashboards', true, 5, 'none'),
  ('starter', 'users', true, 3, 'none'),
  ('starter', 'data_sources', true, 2, 'none'),
  ('starter', 'daily_refreshes', true, 1, 'day'),
  ('starter', 'dashboard.export', false, null, 'none'),
  ('starter', 'alerts', false, null, 'none'),
  ('starter', 'ai.analysis', false, null, 'month'),
  ('starter', 'white_label', false, null, 'none'),
  ('starter', 'api.access', false, null, 'none'),
  ('business', 'core.read', true, null, 'none'),
  ('business', 'dashboards', true, 25, 'none'),
  ('business', 'users', true, 15, 'none'),
  ('business', 'data_sources', true, 10, 'none'),
  ('business', 'daily_refreshes', true, 8, 'day'),
  ('business', 'dashboard.export', true, null, 'none'),
  ('business', 'alerts', true, null, 'none'),
  ('business', 'ai.analysis', true, 500, 'month'),
  ('business', 'white_label', false, null, 'none'),
  ('business', 'api.access', true, null, 'none'),
  ('enterprise', 'core.read', true, null, 'none'),
  ('enterprise', 'dashboards', true, null, 'none'),
  ('enterprise', 'users', true, null, 'none'),
  ('enterprise', 'data_sources', true, null, 'none'),
  ('enterprise', 'daily_refreshes', true, null, 'day'),
  ('enterprise', 'dashboard.export', true, null, 'none'),
  ('enterprise', 'alerts', true, null, 'none'),
  ('enterprise', 'ai.analysis', true, null, 'month'),
  ('enterprise', 'white_label', true, null, 'none'),
  ('enterprise', 'api.access', true, null, 'none');

insert into public.permissions (key, scope, description, required_feature_key, consumes_feature_key, default_usage_units, is_sensitive) values
  ('organization.update', 'organization', 'Actualizar configuracion general de la organizacion.', null, null, 0, true),
  ('organization.delete', 'organization', 'Eliminar o cerrar la organizacion.', null, null, 0, true),
  ('ownership.transfer', 'organization', 'Transferir primary owner.', null, null, 0, true),
  ('members.invite', 'organization', 'Invitar nuevos miembros.', null, null, 0, true),
  ('members.manage', 'organization', 'Cambiar roles, estados y membresias.', null, null, 0, true),
  ('billing.view', 'organization', 'Ver facturacion y suscripcion.', null, null, 0, true),
  ('billing.manage', 'organization', 'Administrar metodos de pago y portal de cliente.', null, null, 0, true),
  ('plan.change', 'organization', 'Cambiar plan contratado.', null, null, 0, true),
  ('subscription.cancel', 'organization', 'Cancelar suscripcion.', null, null, 0, true),
  ('workspaces.create', 'organization', 'Crear workspaces.', null, null, 0, false),
  ('workspaces.manage', 'organization', 'Administrar todos los workspaces.', null, null, 0, true),
  ('workspace.members.manage', 'workspace', 'Administrar miembros de un workspace.', null, null, 0, true),
  ('resources.create', 'workspace', 'Crear recursos BI dentro de un workspace.', null, null, 0, false),
  ('resources.manage', 'workspace', 'Administrar recursos BI dentro de un workspace.', null, null, 0, false),
  ('data_sources.connect', 'workspace', 'Conectar fuentes de datos.', 'data_sources', null, 0, false),
  ('datasets.create', 'workspace', 'Crear datasets.', null, null, 0, false),
  ('dataset.refresh', 'resource', 'Actualizar dataset.', 'daily_refreshes', 'daily_refreshes', 1, false),
  ('dashboards.create', 'workspace', 'Crear dashboards.', 'dashboards', null, 0, false),
  ('dashboard.view', 'resource', 'Ver dashboard.', 'core.read', null, 0, false),
  ('dashboard.export', 'resource', 'Exportar dashboard o datos.', 'dashboard.export', null, 0, false),
  ('report.export', 'resource', 'Exportar reportes.', 'dashboard.export', null, 0, false),
  ('metrics.manage', 'workspace', 'Crear y administrar metricas.', null, null, 0, false),
  ('alerts.manage', 'workspace', 'Crear y administrar alertas.', 'alerts', null, 0, false),
  ('ai.use', 'resource', 'Consumir analisis asistido por IA.', 'ai.analysis', 'ai.analysis', 1, false),
  ('api.use', 'organization', 'Usar API de la suite.', 'api.access', null, 0, true),
  ('audit.read', 'organization', 'Consultar auditoria y decisiones de acceso.', null, null, 0, true);

insert into public.organization_role_permissions (role, permission_key)
select role, permission_key
from (
  values
    ('owner'::public.organization_role, 'organization.update'),
    ('owner', 'organization.delete'),
    ('owner', 'ownership.transfer'),
    ('owner', 'members.invite'),
    ('owner', 'members.manage'),
    ('owner', 'billing.view'),
    ('owner', 'billing.manage'),
    ('owner', 'plan.change'),
    ('owner', 'subscription.cancel'),
    ('owner', 'workspaces.create'),
    ('owner', 'workspaces.manage'),
    ('owner', 'workspace.members.manage'),
    ('owner', 'resources.create'),
    ('owner', 'resources.manage'),
    ('owner', 'data_sources.connect'),
    ('owner', 'datasets.create'),
    ('owner', 'dataset.refresh'),
    ('owner', 'dashboards.create'),
    ('owner', 'dashboard.view'),
    ('owner', 'dashboard.export'),
    ('owner', 'report.export'),
    ('owner', 'metrics.manage'),
    ('owner', 'alerts.manage'),
    ('owner', 'ai.use'),
    ('owner', 'api.use'),
    ('owner', 'audit.read'),
    ('co_owner', 'organization.update'),
    ('co_owner', 'members.invite'),
    ('co_owner', 'members.manage'),
    ('co_owner', 'billing.view'),
    ('co_owner', 'billing.manage'),
    ('co_owner', 'workspaces.create'),
    ('co_owner', 'workspaces.manage'),
    ('co_owner', 'workspace.members.manage'),
    ('co_owner', 'resources.create'),
    ('co_owner', 'resources.manage'),
    ('co_owner', 'data_sources.connect'),
    ('co_owner', 'datasets.create'),
    ('co_owner', 'dataset.refresh'),
    ('co_owner', 'dashboards.create'),
    ('co_owner', 'dashboard.view'),
    ('co_owner', 'dashboard.export'),
    ('co_owner', 'report.export'),
    ('co_owner', 'metrics.manage'),
    ('co_owner', 'alerts.manage'),
    ('co_owner', 'ai.use'),
    ('co_owner', 'api.use'),
    ('co_owner', 'audit.read'),
    ('admin', 'organization.update'),
    ('admin', 'members.invite'),
    ('admin', 'members.manage'),
    ('admin', 'workspaces.create'),
    ('admin', 'workspaces.manage'),
    ('admin', 'workspace.members.manage'),
    ('admin', 'resources.create'),
    ('admin', 'resources.manage'),
    ('admin', 'data_sources.connect'),
    ('admin', 'datasets.create'),
    ('admin', 'dataset.refresh'),
    ('admin', 'dashboards.create'),
    ('admin', 'dashboard.view'),
    ('admin', 'dashboard.export'),
    ('admin', 'report.export'),
    ('admin', 'metrics.manage'),
    ('admin', 'alerts.manage'),
    ('admin', 'ai.use'),
    ('admin', 'api.use'),
    ('admin', 'audit.read'),
    ('analyst', 'data_sources.connect'),
    ('analyst', 'datasets.create'),
    ('analyst', 'dataset.refresh'),
    ('analyst', 'dashboards.create'),
    ('analyst', 'dashboard.view'),
    ('analyst', 'dashboard.export'),
    ('analyst', 'report.export'),
    ('analyst', 'metrics.manage'),
    ('analyst', 'alerts.manage'),
    ('analyst', 'ai.use'),
    ('editor', 'resources.create'),
    ('editor', 'dashboards.create'),
    ('editor', 'dashboard.view'),
    ('viewer', 'dashboard.view')
) as role_permissions(role, permission_key);

insert into public.workspace_role_permissions (role, permission_key)
select role, permission_key
from (
  values
    ('workspace_admin'::public.workspace_role, 'workspace.members.manage'),
    ('workspace_admin', 'resources.create'),
    ('workspace_admin', 'resources.manage'),
    ('workspace_admin', 'data_sources.connect'),
    ('workspace_admin', 'datasets.create'),
    ('workspace_admin', 'dataset.refresh'),
    ('workspace_admin', 'dashboards.create'),
    ('workspace_admin', 'dashboard.view'),
    ('workspace_admin', 'dashboard.export'),
    ('workspace_admin', 'report.export'),
    ('workspace_admin', 'metrics.manage'),
    ('workspace_admin', 'alerts.manage'),
    ('workspace_admin', 'ai.use'),
    ('workspace_analyst', 'data_sources.connect'),
    ('workspace_analyst', 'datasets.create'),
    ('workspace_analyst', 'dataset.refresh'),
    ('workspace_analyst', 'dashboards.create'),
    ('workspace_analyst', 'dashboard.view'),
    ('workspace_analyst', 'dashboard.export'),
    ('workspace_analyst', 'report.export'),
    ('workspace_analyst', 'metrics.manage'),
    ('workspace_analyst', 'alerts.manage'),
    ('workspace_analyst', 'ai.use'),
    ('workspace_editor', 'resources.create'),
    ('workspace_editor', 'dashboards.create'),
    ('workspace_editor', 'dashboard.view'),
    ('workspace_viewer', 'dashboard.view')
) as role_permissions(role, permission_key);

create or replace function public.create_owner_membership_for_new_organization()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.created_by is not null then
    insert into public.organization_members (
      organization_id,
      user_id,
      role,
      status,
      is_primary_owner,
      joined_at
    )
    values (
      new.id,
      new.created_by,
      'owner',
      'active',
      true,
      now()
    )
    on conflict (organization_id, user_id) do update set
      role = 'owner',
      status = 'active',
      is_primary_owner = true,
      joined_at = coalesce(public.organization_members.joined_at, now()),
      updated_at = now();
  end if;

  return new;
end;
$$;

create trigger organizations_create_owner_membership
after insert on public.organizations
for each row execute function public.create_owner_membership_for_new_organization();

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
    where om.organization_id = new.organization_id;

    if v_existing_members = 0
       and new.user_id = v_actor_user_id
       and new.role = 'owner'
       and new.status = 'active'
       and new.is_primary_owner then
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

create trigger organization_members_enforce_role_boundaries
before insert or update or delete on public.organization_members
for each row execute function public.enforce_membership_role_boundaries();

create or replace function public.enforce_invitation_role_boundaries()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid := auth.uid();
begin
  if v_actor_user_id is null then
    return new;
  end if;

  if new.role = 'owner' then
    raise exception 'INVITATION_CANNOT_CREATE_OWNER';
  end if;

  if new.role = 'co_owner'
     and not public.has_organization_permission(new.organization_id, 'ownership.transfer', v_actor_user_id) then
    raise exception 'CO_OWNER_INVITATION_REQUIRES_OWNER';
  end if;

  return new;
end;
$$;

create trigger invitations_enforce_role_boundaries
before insert or update of role, organization_id on public.invitations
for each row execute function public.enforce_invitation_role_boundaries();

create or replace function public.guard_primary_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_organization_id uuid;
  v_organization_status public.organization_status;
  v_primary_owner_count integer;
begin
  v_organization_id := coalesce(new.organization_id, old.organization_id);

  select status
    into v_organization_status
  from public.organizations
  where id = v_organization_id;

  if v_organization_status is distinct from 'active' then
    if tg_op = 'DELETE' then
      return old;
    end if;

    return new;
  end if;

  select count(*)
    into v_primary_owner_count
  from public.organization_members
  where organization_id = v_organization_id
    and status = 'active'
    and role = 'owner'
    and is_primary_owner;

  if v_primary_owner_count < 1 then
    raise exception 'ACTIVE_ORGANIZATION_REQUIRES_PRIMARY_OWNER';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create constraint trigger organization_members_guard_primary_owner
after insert or update or delete on public.organization_members
deferrable initially immediate
for each row execute function public.guard_primary_owner();

create or replace function public.sync_workspace_member_organization()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_org uuid;
  v_member_org uuid;
begin
  select organization_id
    into v_workspace_org
  from public.workspaces
  where id = new.workspace_id;

  select organization_id
    into v_member_org
  from public.organization_members
  where id = new.organization_member_id;

  if v_workspace_org is null or v_member_org is null or v_workspace_org <> v_member_org then
    raise exception 'WORKSPACE_MEMBER_ORGANIZATION_MISMATCH';
  end if;

  new.organization_id := v_workspace_org;
  return new;
end;
$$;

create trigger workspace_members_sync_organization
before insert or update of workspace_id, organization_member_id on public.workspace_members
for each row execute function public.sync_workspace_member_organization();

create or replace function public.validate_workspace_creator()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_creator_org uuid;
begin
  if new.created_by_member_id is null then
    return new;
  end if;

  select organization_id
    into v_creator_org
  from public.organization_members
  where id = new.created_by_member_id;

  if v_creator_org is distinct from new.organization_id then
    raise exception 'WORKSPACE_CREATOR_ORGANIZATION_MISMATCH';
  end if;

  return new;
end;
$$;

create trigger workspaces_validate_creator
before insert or update of organization_id, created_by_member_id on public.workspaces
for each row execute function public.validate_workspace_creator();

create or replace function public.sync_bi_resource_organization()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_org uuid;
  v_creator_org uuid;
begin
  select organization_id
    into v_workspace_org
  from public.workspaces
  where id = new.workspace_id;

  if v_workspace_org is null then
    raise exception 'WORKSPACE_NOT_FOUND';
  end if;

  new.organization_id := v_workspace_org;

  if new.created_by_member_id is not null then
    select organization_id
      into v_creator_org
    from public.organization_members
    where id = new.created_by_member_id;

    if v_creator_org is distinct from v_workspace_org then
      raise exception 'RESOURCE_CREATOR_ORGANIZATION_MISMATCH';
    end if;
  end if;

  return new;
end;
$$;

create trigger bi_resources_sync_organization
before insert or update of workspace_id, created_by_member_id on public.bi_resources
for each row execute function public.sync_bi_resource_organization();

create or replace function public.get_active_organization_member_id(
  p_organization_id uuid,
  p_user_id uuid default auth.uid()
)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select om.id
  from public.organization_members om
  join public.organizations o on o.id = om.organization_id
  where om.organization_id = p_organization_id
    and om.user_id = p_user_id
    and om.status = 'active'
    and o.status = 'active'
  limit 1;
$$;

create or replace function public.is_active_organization_member(
  p_organization_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
    where om.organization_id = p_organization_id
      and om.user_id = p_user_id
      and om.status = 'active'
      and o.status = 'active'
  );
$$;

create or replace function public.shares_active_organization(
  p_target_user_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members viewer_member
    join public.organization_members target_member
      on target_member.organization_id = viewer_member.organization_id
    join public.organizations o
      on o.id = viewer_member.organization_id
    where viewer_member.user_id = p_user_id
      and target_member.user_id = p_target_user_id
      and viewer_member.status = 'active'
      and target_member.status = 'active'
      and o.status = 'active'
  );
$$;

create or replace function public.has_organization_permission(
  p_organization_id uuid,
  p_permission_key text,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members om
    join public.organization_role_permissions orp
      on orp.role = om.role
    join public.organizations o
      on o.id = om.organization_id
    where om.organization_id = p_organization_id
      and om.user_id = p_user_id
      and om.status = 'active'
      and o.status = 'active'
      and orp.permission_key = p_permission_key
  );
$$;

create or replace function public.can_access_workspace(
  p_workspace_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspaces w
    join public.organization_members om
      on om.organization_id = w.organization_id
    where w.id = p_workspace_id
      and w.status = 'active'
      and om.user_id = p_user_id
      and om.status = 'active'
      and (
        public.has_organization_permission(w.organization_id, 'workspaces.manage', p_user_id)
        or exists (
          select 1
          from public.workspace_members wm
          where wm.workspace_id = w.id
            and wm.organization_member_id = om.id
            and wm.status = 'active'
        )
      )
  );
$$;

create or replace function public.has_workspace_permission(
  p_workspace_id uuid,
  p_permission_key text,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspaces w
    join public.organization_members om
      on om.organization_id = w.organization_id
    where w.id = p_workspace_id
      and w.status = 'active'
      and om.user_id = p_user_id
      and om.status = 'active'
      and (
        public.has_organization_permission(w.organization_id, p_permission_key, p_user_id)
        or exists (
          select 1
          from public.workspace_members wm
          join public.workspace_role_permissions wrp
            on wrp.role = wm.role
          where wm.workspace_id = w.id
            and wm.organization_member_id = om.id
            and wm.status = 'active'
            and wrp.permission_key = p_permission_key
        )
      )
  );
$$;

create or replace function public.get_feature_limit(
  p_organization_id uuid,
  p_feature_key text
)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pf.limit_value
  from public.subscriptions s
  join public.plan_features pf
    on pf.plan_id = s.plan_id
   and pf.feature_key = p_feature_key
  where s.organization_id = p_organization_id
    and s.is_current
    and pf.enabled
  order by s.created_at desc
  limit 1;
$$;

create or replace function public.organization_has_feature(
  p_organization_id uuid,
  p_feature_key text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select
      pf.enabled
      and case
        when s.access_status in ('full', 'trial') then true
        when s.access_status = 'grace' then s.grace_ends_at is null or s.grace_ends_at >= now()
        when s.access_status = 'full_until_end' then s.current_period_end is null or s.current_period_end >= now()
        when s.access_status = 'limited' then f.allowed_when_limited
        else false
      end
    from public.subscriptions s
    join public.plan_features pf
      on pf.plan_id = s.plan_id
     and pf.feature_key = p_feature_key
    join public.features f
      on f.key = pf.feature_key
    where s.organization_id = p_organization_id
      and s.is_current
    order by s.created_at desc
    limit 1
  ), false);
$$;

create or replace function public.current_usage_period(
  p_organization_id uuid,
  p_feature_key text,
  out period_start timestamptz,
  out period_end timestamptz
)
returns record
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_quota_period public.quota_period;
  v_subscription_start timestamptz;
  v_subscription_end timestamptz;
begin
  select pf.quota_period, s.current_period_start, s.current_period_end
    into v_quota_period, v_subscription_start, v_subscription_end
  from public.subscriptions s
  join public.plan_features pf
    on pf.plan_id = s.plan_id
   and pf.feature_key = p_feature_key
  where s.organization_id = p_organization_id
    and s.is_current
  order by s.created_at desc
  limit 1;

  if v_quota_period = 'day' then
    period_start := date_trunc('day', now());
    period_end := period_start + interval '1 day';
  elsif v_quota_period = 'month' then
    period_start := date_trunc('month', now());
    period_end := period_start + interval '1 month';
  elsif v_quota_period = 'billing_period' and v_subscription_start is not null and v_subscription_end is not null then
    period_start := v_subscription_start;
    period_end := v_subscription_end;
  else
    period_start := '-infinity'::timestamptz;
    period_end := 'infinity'::timestamptz;
  end if;
end;
$$;

create or replace function public.consume_feature_usage(
  p_organization_id uuid,
  p_feature_key text,
  p_units bigint default 1,
  p_resource_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit bigint;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_used bigint;
begin
  if p_units <= 0 then
    return jsonb_build_object(
      'allowed', false,
      'reason_code', 'INVALID_USAGE_UNITS'
    );
  end if;

  if not public.organization_has_feature(p_organization_id, p_feature_key) then
    return jsonb_build_object(
      'allowed', false,
      'reason_code', 'FEATURE_NOT_INCLUDED',
      'required_feature', p_feature_key,
      'upgrade_required', true
    );
  end if;

  v_limit := public.get_feature_limit(p_organization_id, p_feature_key);

  select cp.period_start, cp.period_end
    into v_period_start, v_period_end
  from public.current_usage_period(p_organization_id, p_feature_key) cp;

  if v_limit is not null and p_units > v_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason_code', 'QUOTA_EXCEEDED',
      'feature', p_feature_key,
      'limit', v_limit,
      'requested_units', p_units
    );
  end if;

  insert into public.usage_counters (
    organization_id,
    feature_key,
    period_start,
    period_end,
    used_value,
    limit_value
  )
  values (
    p_organization_id,
    p_feature_key,
    v_period_start,
    v_period_end,
    p_units,
    v_limit
  )
  on conflict (organization_id, feature_key, period_start, period_end)
  do update set
    used_value = public.usage_counters.used_value + excluded.used_value,
    limit_value = excluded.limit_value,
    updated_at = now()
  where public.usage_counters.limit_value is null
     or public.usage_counters.used_value + excluded.used_value <= public.usage_counters.limit_value
  returning used_value into v_used;

  if v_used is null then
    return jsonb_build_object(
      'allowed', false,
      'reason_code', 'QUOTA_EXCEEDED',
      'feature', p_feature_key,
      'limit', v_limit
    );
  end if;

  insert into public.usage_events (
    organization_id,
    feature_key,
    user_id,
    resource_id,
    delta,
    period_start,
    period_end,
    metadata
  )
  values (
    p_organization_id,
    p_feature_key,
    auth.uid(),
    p_resource_id,
    p_units,
    v_period_start,
    v_period_end,
    p_metadata
  );

  return jsonb_build_object(
    'allowed', true,
    'reason_code', 'OK',
    'feature', p_feature_key,
    'used', v_used,
    'limit', v_limit,
    'period_start', v_period_start,
    'period_end', v_period_end
  );
end;
$$;

create or replace function public.resource_override_effect(
  p_organization_id uuid,
  p_workspace_id uuid,
  p_resource_id uuid,
  p_permission_key text,
  p_user_id uuid default auth.uid()
)
returns public.permission_effect
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_member_id uuid;
  v_org_role public.organization_role;
  v_workspace_role public.workspace_role;
  v_effect public.permission_effect;
begin
  select om.id, om.role
    into v_member_id, v_org_role
  from public.organization_members om
  where om.organization_id = p_organization_id
    and om.user_id = p_user_id
    and om.status = 'active'
  limit 1;

  if v_member_id is null then
    return null;
  end if;

  if p_workspace_id is not null then
    select wm.role
      into v_workspace_role
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.organization_member_id = v_member_id
      and wm.status = 'active'
    limit 1;
  end if;

  select rp.effect
    into v_effect
  from public.resource_permissions rp
  where rp.organization_id = p_organization_id
    and rp.action = p_permission_key
    and (rp.expires_at is null or rp.expires_at > now())
    and (rp.workspace_id is null or rp.workspace_id = p_workspace_id)
    and (rp.resource_id is null or rp.resource_id = p_resource_id)
    and (
      (rp.subject_type = 'organization_member' and rp.organization_member_id = v_member_id)
      or (rp.subject_type = 'organization_role' and rp.organization_role = v_org_role)
      or (rp.subject_type = 'workspace_role' and rp.workspace_role = v_workspace_role)
    )
  order by
    case when rp.resource_id = p_resource_id then 0 else 1 end,
    case rp.subject_type
      when 'organization_member' then 0
      when 'workspace_role' then 1
      else 2
    end,
    case rp.effect when 'deny' then 0 else 1 end,
    rp.created_at desc
  limit 1;

  return v_effect;
end;
$$;

create or replace function public.record_access_decision(
  p_user_id uuid,
  p_organization_id uuid,
  p_workspace_id uuid,
  p_resource_id uuid,
  p_action text,
  p_allowed boolean,
  p_reason_code text,
  p_required_feature_key text default null,
  p_upgrade_required boolean default false,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_decision_id uuid;
begin
  insert into public.access_decisions (
    user_id,
    organization_id,
    workspace_id,
    resource_id,
    action,
    allowed,
    reason_code,
    required_feature_key,
    upgrade_required,
    metadata
  )
  values (
    p_user_id,
    p_organization_id,
    p_workspace_id,
    p_resource_id,
    p_action,
    p_allowed,
    p_reason_code,
    p_required_feature_key,
    p_upgrade_required,
    p_metadata
  )
  returning id into v_decision_id;

  return jsonb_build_object(
    'allowed', p_allowed,
    'reason_code', p_reason_code,
    'decision_id', v_decision_id,
    'required_feature', p_required_feature_key,
    'upgrade_required', p_upgrade_required
  );
end;
$$;

create or replace function public.authorize_action(
  p_organization_id uuid,
  p_action text,
  p_workspace_id uuid default null,
  p_resource_id uuid default null,
  p_feature_key text default null,
  p_usage_units bigint default 0,
  p_consume_quota boolean default false,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_active boolean;
  v_organization_status public.organization_status;
  v_member_id uuid;
  v_member_role public.organization_role;
  v_member_status public.membership_status;
  v_workspace_org_id uuid;
  v_workspace_status public.workspace_status;
  v_resource_org_id uuid;
  v_resource_workspace_id uuid;
  v_resource_status public.bi_resource_status;
  v_permission public.permissions%rowtype;
  v_required_feature text;
  v_consumes_feature text;
  v_units bigint;
  v_role_allowed boolean := false;
  v_override public.permission_effect;
  v_usage_result jsonb;
begin
  if v_user_id is null then
    return public.record_access_decision(
      null, p_organization_id, p_workspace_id, p_resource_id, p_action,
      false, 'UNAUTHENTICATED', null, false, p_metadata
    );
  end if;

  select coalesce(p.is_active, true)
    into v_profile_active
  from public.profiles p
  where p.id = v_user_id;

  if coalesce(v_profile_active, true) = false then
    return public.record_access_decision(
      v_user_id, p_organization_id, p_workspace_id, p_resource_id, p_action,
      false, 'USER_INACTIVE', null, false, p_metadata
    );
  end if;

  select o.status
    into v_organization_status
  from public.organizations o
  where o.id = p_organization_id;

  if v_organization_status is distinct from 'active' then
    return public.record_access_decision(
      v_user_id, p_organization_id, p_workspace_id, p_resource_id, p_action,
      false, 'ORGANIZATION_INACTIVE', null, false, p_metadata
    );
  end if;

  select om.id, om.role, om.status
    into v_member_id, v_member_role, v_member_status
  from public.organization_members om
  where om.organization_id = p_organization_id
    and om.user_id = v_user_id
  limit 1;

  if v_member_id is null then
    return public.record_access_decision(
      v_user_id, p_organization_id, p_workspace_id, p_resource_id, p_action,
      false, 'NOT_ORGANIZATION_MEMBER', null, false, p_metadata
    );
  end if;

  if v_member_status <> 'active' then
    return public.record_access_decision(
      v_user_id, p_organization_id, p_workspace_id, p_resource_id, p_action,
      false, 'MEMBERSHIP_INACTIVE', null, false, p_metadata
    );
  end if;

  select *
    into v_permission
  from public.permissions
  where key = p_action;

  if v_permission.key is null then
    return public.record_access_decision(
      v_user_id, p_organization_id, p_workspace_id, p_resource_id, p_action,
      false, 'ROLE_NOT_ALLOWED', null, false, p_metadata
    );
  end if;

  if p_workspace_id is not null then
    select w.organization_id, w.status
      into v_workspace_org_id, v_workspace_status
    from public.workspaces w
    where w.id = p_workspace_id;

    if v_workspace_org_id is distinct from p_organization_id
       or v_workspace_status is distinct from 'active'
       or not public.can_access_workspace(p_workspace_id, v_user_id) then
      return public.record_access_decision(
        v_user_id, p_organization_id, p_workspace_id, p_resource_id, p_action,
        false, 'WORKSPACE_NOT_ALLOWED', null, false, p_metadata
      );
    end if;
  elsif v_permission.scope in ('workspace', 'resource') then
    return public.record_access_decision(
      v_user_id, p_organization_id, p_workspace_id, p_resource_id, p_action,
      false, 'WORKSPACE_NOT_ALLOWED', null, false, p_metadata
    );
  end if;

  if p_resource_id is not null then
    select br.organization_id, br.workspace_id, br.status
      into v_resource_org_id, v_resource_workspace_id, v_resource_status
    from public.bi_resources br
    where br.id = p_resource_id;

    if v_resource_org_id is distinct from p_organization_id
       or v_resource_workspace_id is distinct from p_workspace_id
       or v_resource_status is distinct from 'active' then
      return public.record_access_decision(
        v_user_id, p_organization_id, p_workspace_id, p_resource_id, p_action,
        false, 'RESOURCE_NOT_ALLOWED', null, false, p_metadata
      );
    end if;
  end if;

  v_override := public.resource_override_effect(
    p_organization_id,
    p_workspace_id,
    p_resource_id,
    p_action,
    v_user_id
  );

  if v_override = 'deny' then
    return public.record_access_decision(
      v_user_id, p_organization_id, p_workspace_id, p_resource_id, p_action,
      false, 'RESOURCE_NOT_ALLOWED', null, false, p_metadata
    );
  end if;

  v_role_allowed :=
    public.has_organization_permission(p_organization_id, p_action, v_user_id)
    or (
      p_workspace_id is not null
      and public.has_workspace_permission(p_workspace_id, p_action, v_user_id)
    )
    or v_override = 'allow';

  if not v_role_allowed then
    return public.record_access_decision(
      v_user_id, p_organization_id, p_workspace_id, p_resource_id, p_action,
      false, 'ROLE_NOT_ALLOWED', null, false, p_metadata
    );
  end if;

  v_required_feature := coalesce(p_feature_key, v_permission.required_feature_key);
  v_consumes_feature := v_permission.consumes_feature_key;
  v_units := greatest(coalesce(nullif(p_usage_units, 0), v_permission.default_usage_units, 0), 0);

  if v_required_feature is not null and not public.organization_has_feature(p_organization_id, v_required_feature) then
    return public.record_access_decision(
      v_user_id, p_organization_id, p_workspace_id, p_resource_id, p_action,
      false, 'FEATURE_NOT_INCLUDED', v_required_feature, true, p_metadata
    );
  end if;

  if p_consume_quota and v_consumes_feature is not null and v_units > 0 then
    v_usage_result := public.consume_feature_usage(
      p_organization_id,
      v_consumes_feature,
      v_units,
      p_resource_id,
      p_metadata
    );

    if coalesce((v_usage_result ->> 'allowed')::boolean, false) = false then
      return public.record_access_decision(
        v_user_id,
        p_organization_id,
        p_workspace_id,
        p_resource_id,
        p_action,
        false,
        coalesce(v_usage_result ->> 'reason_code', 'QUOTA_EXCEEDED'),
        coalesce(v_usage_result ->> 'required_feature', v_consumes_feature),
        coalesce((v_usage_result ->> 'upgrade_required')::boolean, false),
        p_metadata || jsonb_build_object('usage', v_usage_result)
      );
    end if;
  end if;

  return public.record_access_decision(
    v_user_id,
    p_organization_id,
    p_workspace_id,
    p_resource_id,
    p_action,
    true,
    'OK',
    v_required_feature,
    false,
    p_metadata || jsonb_build_object('usage', coalesce(v_usage_result, '{}'::jsonb))
  );
end;
$$;

create or replace function public.transfer_primary_owner(
  p_organization_id uuid,
  p_new_primary_owner_member_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_member_id uuid;
  v_current_primary_owner_id uuid;
  v_new_member public.organization_members%rowtype;
begin
  if v_actor_user_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if not public.has_organization_permission(p_organization_id, 'ownership.transfer', v_actor_user_id) then
    raise exception 'ROLE_CHANGE_REQUIRES_OWNER';
  end if;

  select public.get_active_organization_member_id(p_organization_id, v_actor_user_id)
    into v_actor_member_id;

  select *
    into v_new_member
  from public.organization_members
  where id = p_new_primary_owner_member_id
    and organization_id = p_organization_id
    and status = 'active';

  if v_new_member.id is null then
    raise exception 'NEW_PRIMARY_OWNER_NOT_ACTIVE_MEMBER';
  end if;

  select id
    into v_current_primary_owner_id
  from public.organization_members
  where organization_id = p_organization_id
    and status = 'active'
    and role = 'owner'
    and is_primary_owner
  limit 1;

  if v_current_primary_owner_id is null then
    raise exception 'ACTIVE_ORGANIZATION_REQUIRES_PRIMARY_OWNER';
  end if;

  if v_current_primary_owner_id = p_new_primary_owner_member_id then
    return p_new_primary_owner_member_id;
  end if;

  set constraints organization_members_guard_primary_owner deferred;

  update public.organization_members
  set is_primary_owner = false,
      updated_at = now()
  where id = v_current_primary_owner_id;

  update public.organization_members
  set role = 'owner',
      status = 'active',
      is_primary_owner = true,
      joined_at = coalesce(joined_at, now()),
      updated_at = now()
  where id = p_new_primary_owner_member_id;

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
    p_organization_id,
    v_actor_user_id,
    v_actor_member_id,
    'ownership.transfer',
    'organization_members',
    p_new_primary_owner_member_id,
    jsonb_build_object(
      'previous_primary_owner_member_id', v_current_primary_owner_id,
      'new_primary_owner_member_id', p_new_primary_owner_member_id
    )
  );

  return p_new_primary_owner_member_id;
end;
$$;

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

create or replace function public.enforce_active_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit bigint;
  v_active_members bigint;
begin
  if new.status <> 'active' then
    return new;
  end if;

  select count(*)
    into v_active_members
  from public.organization_members om
  where om.organization_id = new.organization_id
    and om.status = 'active'
    and om.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_active_members = 0 and new.role = 'owner' and new.is_primary_owner then
    return new;
  end if;

  if not public.organization_has_feature(new.organization_id, 'users') then
    raise exception 'FEATURE_NOT_INCLUDED: users is not enabled for organization %', new.organization_id;
  end if;

  v_limit := public.get_feature_limit(new.organization_id, 'users');

  if v_limit is null then
    return new;
  end if;

  if v_active_members + 1 > v_limit then
    raise exception 'QUOTA_EXCEEDED: users limit reached for organization %', new.organization_id;
  end if;

  return new;
end;
$$;

create trigger organization_members_enforce_active_member_limit
before insert or update of status, organization_id on public.organization_members
for each row execute function public.enforce_active_member_limit();

create or replace function public.resource_type_feature_key(
  p_resource_type public.bi_resource_type
)
returns text
language sql
immutable
as $$
  select case p_resource_type
    when 'dashboard' then 'dashboards'
    when 'data_source' then 'data_sources'
    else null
  end;
$$;

create or replace function public.enforce_bi_resource_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_feature_key text;
  v_limit bigint;
  v_active_resources bigint;
begin
  if new.status <> 'active' then
    return new;
  end if;

  v_feature_key := public.resource_type_feature_key(new.resource_type);

  if v_feature_key is null then
    return new;
  end if;

  if not public.organization_has_feature(new.organization_id, v_feature_key) then
    raise exception 'FEATURE_NOT_INCLUDED: % is not enabled for organization %', v_feature_key, new.organization_id;
  end if;

  v_limit := public.get_feature_limit(new.organization_id, v_feature_key);

  if v_limit is null then
    return new;
  end if;

  select count(*)
    into v_active_resources
  from public.bi_resources br
  where br.organization_id = new.organization_id
    and br.resource_type = new.resource_type
    and br.status = 'active'
    and br.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_active_resources + 1 > v_limit then
    raise exception 'QUOTA_EXCEEDED: % limit reached for organization %', v_feature_key, new.organization_id;
  end if;

  return new;
end;
$$;

create trigger bi_resources_enforce_resource_limit
before insert or update of status, resource_type, organization_id on public.bi_resources
for each row execute function public.enforce_bi_resource_limit();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_roles enable row level security;
alter table public.workspace_roles enable row level security;
alter table public.plans enable row level security;
alter table public.features enable row level security;
alter table public.plan_features enable row level security;
alter table public.permissions enable row level security;
alter table public.organization_role_permissions enable row level security;
alter table public.workspace_role_permissions enable row level security;
alter table public.organization_members enable row level security;
alter table public.invitations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.bi_resources enable row level security;
alter table public.resource_permissions enable row level security;
alter table public.usage_counters enable row level security;
alter table public.usage_events enable row level security;
alter table public.access_decisions enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles_select_visible"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.shares_active_organization(id)
);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy "organizations_select_member"
on public.organizations
for select
to authenticated
using (public.is_active_organization_member(id));

create policy "organizations_insert_creator"
on public.organizations
for insert
to authenticated
with check (created_by = auth.uid());

create policy "organizations_update_admin"
on public.organizations
for update
to authenticated
using (public.has_organization_permission(id, 'organization.update'))
with check (public.has_organization_permission(id, 'organization.update'));

create policy "organizations_delete_owner"
on public.organizations
for delete
to authenticated
using (public.has_organization_permission(id, 'organization.delete'));

create policy "catalog_roles_select"
on public.organization_roles
for select
to anon, authenticated
using (true);

create policy "catalog_workspace_roles_select"
on public.workspace_roles
for select
to anon, authenticated
using (true);

create policy "catalog_plans_select"
on public.plans
for select
to anon, authenticated
using (is_active);

create policy "catalog_features_select"
on public.features
for select
to anon, authenticated
using (true);

create policy "catalog_plan_features_select"
on public.plan_features
for select
to anon, authenticated
using (true);

create policy "catalog_permissions_select"
on public.permissions
for select
to anon, authenticated
using (true);

create policy "catalog_org_role_permissions_select"
on public.organization_role_permissions
for select
to anon, authenticated
using (true);

create policy "catalog_workspace_role_permissions_select"
on public.workspace_role_permissions
for select
to anon, authenticated
using (true);

create policy "organization_members_select_member"
on public.organization_members
for select
to authenticated
using (public.is_active_organization_member(organization_id));

create policy "organization_members_insert_admin"
on public.organization_members
for insert
to authenticated
with check (public.has_organization_permission(organization_id, 'members.manage'));

create policy "organization_members_update_admin"
on public.organization_members
for update
to authenticated
using (public.has_organization_permission(organization_id, 'members.manage'))
with check (public.has_organization_permission(organization_id, 'members.manage'));

create policy "organization_members_delete_admin"
on public.organization_members
for delete
to authenticated
using (public.has_organization_permission(organization_id, 'members.manage'));

create policy "invitations_select_admin"
on public.invitations
for select
to authenticated
using (public.has_organization_permission(organization_id, 'members.invite'));

create policy "invitations_insert_admin"
on public.invitations
for insert
to authenticated
with check (public.has_organization_permission(organization_id, 'members.invite'));

create policy "invitations_update_admin"
on public.invitations
for update
to authenticated
using (public.has_organization_permission(organization_id, 'members.invite'))
with check (public.has_organization_permission(organization_id, 'members.invite'));

create policy "subscriptions_select_billing"
on public.subscriptions
for select
to authenticated
using (
  public.has_organization_permission(organization_id, 'billing.view')
  or public.has_organization_permission(organization_id, 'billing.manage')
);

create policy "workspaces_select_allowed"
on public.workspaces
for select
to authenticated
using (public.can_access_workspace(id));

create policy "workspaces_insert_admin"
on public.workspaces
for insert
to authenticated
with check (public.has_organization_permission(organization_id, 'workspaces.create'));

create policy "workspaces_update_manager"
on public.workspaces
for update
to authenticated
using (
  public.has_organization_permission(organization_id, 'workspaces.manage')
  or public.has_workspace_permission(id, 'resources.manage')
)
with check (
  public.has_organization_permission(organization_id, 'workspaces.manage')
  or public.has_workspace_permission(id, 'resources.manage')
);

create policy "workspaces_delete_manager"
on public.workspaces
for delete
to authenticated
using (public.has_organization_permission(organization_id, 'workspaces.manage'));

create policy "workspace_members_select_allowed"
on public.workspace_members
for select
to authenticated
using (
  public.can_access_workspace(workspace_id)
  or public.has_organization_permission(organization_id, 'workspaces.manage')
);

create policy "workspace_members_insert_manager"
on public.workspace_members
for insert
to authenticated
with check (
  public.has_organization_permission(organization_id, 'workspaces.manage')
  or public.has_workspace_permission(workspace_id, 'workspace.members.manage')
);

create policy "workspace_members_update_manager"
on public.workspace_members
for update
to authenticated
using (
  public.has_organization_permission(organization_id, 'workspaces.manage')
  or public.has_workspace_permission(workspace_id, 'workspace.members.manage')
)
with check (
  public.has_organization_permission(organization_id, 'workspaces.manage')
  or public.has_workspace_permission(workspace_id, 'workspace.members.manage')
);

create policy "workspace_members_delete_manager"
on public.workspace_members
for delete
to authenticated
using (
  public.has_organization_permission(organization_id, 'workspaces.manage')
  or public.has_workspace_permission(workspace_id, 'workspace.members.manage')
);

create policy "bi_resources_select_workspace"
on public.bi_resources
for select
to authenticated
using (
  public.organization_has_feature(organization_id, 'core.read')
  and (
    public.can_access_workspace(workspace_id)
    or (
      resource_type in ('dashboard', 'report')
      and public.resource_override_effect(organization_id, workspace_id, id, 'dashboard.view') = 'allow'
    )
  )
);

create policy "bi_resources_insert_authorized"
on public.bi_resources
for insert
to authenticated
with check (
  public.has_workspace_permission(workspace_id, 'resources.create')
  or (
    resource_type = 'dashboard'
    and public.has_workspace_permission(workspace_id, 'dashboards.create')
  )
  or (
    resource_type = 'data_source'
    and public.has_workspace_permission(workspace_id, 'data_sources.connect')
  )
  or (
    resource_type = 'dataset'
    and public.has_workspace_permission(workspace_id, 'datasets.create')
  )
  or (
    resource_type = 'metric'
    and public.has_workspace_permission(workspace_id, 'metrics.manage')
  )
  or (
    resource_type = 'alert'
    and public.has_workspace_permission(workspace_id, 'alerts.manage')
  )
);

create policy "bi_resources_update_authorized"
on public.bi_resources
for update
to authenticated
using (public.has_workspace_permission(workspace_id, 'resources.manage'))
with check (public.has_workspace_permission(workspace_id, 'resources.manage'));

create policy "bi_resources_delete_authorized"
on public.bi_resources
for delete
to authenticated
using (public.has_workspace_permission(workspace_id, 'resources.manage'));

create policy "resource_permissions_select_manager"
on public.resource_permissions
for select
to authenticated
using (
  public.has_organization_permission(organization_id, 'workspaces.manage')
  or (workspace_id is not null and public.has_workspace_permission(workspace_id, 'workspace.members.manage'))
);

create policy "resource_permissions_insert_manager"
on public.resource_permissions
for insert
to authenticated
with check (
  public.has_organization_permission(organization_id, 'workspaces.manage')
  or (workspace_id is not null and public.has_workspace_permission(workspace_id, 'workspace.members.manage'))
);

create policy "resource_permissions_update_manager"
on public.resource_permissions
for update
to authenticated
using (
  public.has_organization_permission(organization_id, 'workspaces.manage')
  or (workspace_id is not null and public.has_workspace_permission(workspace_id, 'workspace.members.manage'))
)
with check (
  public.has_organization_permission(organization_id, 'workspaces.manage')
  or (workspace_id is not null and public.has_workspace_permission(workspace_id, 'workspace.members.manage'))
);

create policy "resource_permissions_delete_manager"
on public.resource_permissions
for delete
to authenticated
using (
  public.has_organization_permission(organization_id, 'workspaces.manage')
  or (workspace_id is not null and public.has_workspace_permission(workspace_id, 'workspace.members.manage'))
);

create policy "usage_counters_select_admin"
on public.usage_counters
for select
to authenticated
using (
  public.has_organization_permission(organization_id, 'billing.view')
  or public.has_organization_permission(organization_id, 'audit.read')
);

create policy "usage_events_select_admin"
on public.usage_events
for select
to authenticated
using (
  public.has_organization_permission(organization_id, 'billing.view')
  or public.has_organization_permission(organization_id, 'audit.read')
);

create policy "access_decisions_select_auditor"
on public.access_decisions
for select
to authenticated
using (
  organization_id is not null
  and public.has_organization_permission(organization_id, 'audit.read')
);

create policy "audit_logs_select_auditor"
on public.audit_logs
for select
to authenticated
using (
  organization_id is not null
  and public.has_organization_permission(organization_id, 'audit.read')
);

grant usage on schema public to anon, authenticated, service_role;

grant select on
  public.organization_roles,
  public.workspace_roles,
  public.plans,
  public.features,
  public.plan_features,
  public.permissions,
  public.organization_role_permissions,
  public.workspace_role_permissions
to anon, authenticated;

grant select, insert, update, delete on
  public.profiles,
  public.organizations,
  public.organization_members,
  public.invitations,
  public.subscriptions,
  public.workspaces,
  public.workspace_members,
  public.bi_resources,
  public.resource_permissions,
  public.usage_counters,
  public.usage_events,
  public.access_decisions,
  public.audit_logs
to authenticated;

revoke all on function public.record_access_decision(uuid, uuid, uuid, uuid, text, boolean, text, text, boolean, jsonb)
from public, anon, authenticated;

revoke all on function public.consume_feature_usage(uuid, text, bigint, uuid, jsonb)
from public, anon, authenticated;

revoke all on function public.authorize_action(uuid, text, uuid, uuid, text, bigint, boolean, jsonb)
from public, anon, authenticated;

revoke all on function public.transfer_primary_owner(uuid, uuid)
from public, anon, authenticated;

revoke all on function public.accept_invitation(text)
from public, anon, authenticated;

grant execute on function public.authorize_action(uuid, text, uuid, uuid, text, bigint, boolean, jsonb)
to authenticated;

grant execute on function public.transfer_primary_owner(uuid, uuid)
to authenticated;

grant execute on function public.accept_invitation(text)
to authenticated;

commit;
