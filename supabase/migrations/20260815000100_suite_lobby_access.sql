begin;

insert into public.permissions (
  key,
  scope,
  description,
  required_feature_key,
  consumes_feature_key,
  default_usage_units,
  is_sensitive
)
values (
  'suite.launch',
  'organization',
  'Abrir una solución adquirida desde el lobby de la suite.',
  null,
  null,
  0,
  false
)
on conflict (key) do update set
  description = excluded.description,
  scope = excluded.scope,
  updated_at = now();

insert into public.organization_role_permissions (role, permission_key)
select role, 'suite.launch'
from public.organization_roles
on conflict (role, permission_key) do nothing;

commit;
