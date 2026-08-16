begin;

insert into public.features (key, name, description, unit, allowed_when_limited)
values (
  'erp.access',
  'DavOps ERP',
  'Acceso a la solución DavOps ERP (app separada) desde el lobby de la Suite.',
  'boolean',
  false
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  updated_at = now();

insert into public.plan_features (plan_id, feature_key, enabled, limit_value, quota_period)
select id, 'erp.access', true, null, 'none'
from public.plans
on conflict (plan_id, feature_key) do update set
  enabled = excluded.enabled,
  updated_at = now();

commit;
