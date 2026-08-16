begin;

create or replace function public.get_suite_lobby_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_context jsonb;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED'
      using errcode = '42501';
  end if;

  with viewer as (
    select
      au.id,
      coalesce(p.email, lower(au.email)) as email,
      coalesce(
        p.full_name,
        au.raw_user_meta_data ->> 'full_name',
        au.raw_user_meta_data ->> 'name',
        split_part(coalesce(au.email, ''), '@', 1),
        'Usuario DAVALSY'
      ) as full_name,
      coalesce(p.avatar_url, au.raw_user_meta_data ->> 'avatar_url') as avatar_url
    from auth.users au
    left join public.profiles p on p.id = au.id
    where au.id = v_user_id
      and coalesce(p.is_active, true)
  ),
  visible_organizations as (
    select
      o.id,
      o.name,
      o.slug,
      om.role::text as role,
      coalesce(s.plan_id, 'sin_plan') as plan_id,
      coalesce(pl.name, 'Sin plan activo') as plan_name,
      coalesce(s.access_status::text, 'pending') as access_status,
      s.current_period_end as renewal_date
    from public.organization_members om
    join public.organizations o
      on o.id = om.organization_id
     and o.status = 'active'
    left join lateral (
      select
        subscription.plan_id,
        subscription.access_status,
        subscription.current_period_end
      from public.subscriptions subscription
      where subscription.organization_id = o.id
        and subscription.is_current
      order by subscription.updated_at desc
      limit 1
    ) s on true
    left join public.plans pl on pl.id = s.plan_id
    where om.user_id = v_user_id
      and om.status = 'active'
  )
  select jsonb_build_object(
    'contractVersion', 1,
    'id', viewer.id,
    'email', viewer.email,
    'fullName', viewer.full_name,
    'avatarUrl', viewer.avatar_url,
    'organizations', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', organization.id,
            'name', organization.name,
            'slug', organization.slug,
            'role', organization.role,
            'planId', organization.plan_id,
            'planName', organization.plan_name,
            'accessStatus', organization.access_status,
            'renewalDate', organization.renewal_date,
            'enabledFeatures', coalesce(
              (
                select jsonb_agg(plan_feature.feature_key order by plan_feature.feature_key)
                from public.plan_features plan_feature
                where plan_feature.plan_id = organization.plan_id
                  and plan_feature.enabled
                  and public.organization_has_feature(
                    organization.id,
                    plan_feature.feature_key
                  )
              ),
              '[]'::jsonb
            )
          )
          order by organization.name
        )
        from visible_organizations organization
      ),
      '[]'::jsonb
    )
  )
  into v_context
  from viewer;

  if v_context is null then
    raise exception 'USER_INACTIVE_OR_NOT_FOUND'
      using errcode = '42501';
  end if;

  return v_context;
end;
$$;

comment on function public.get_suite_lobby_context() is
  'Contrato seguro del lobby: perfil, organizaciones, plan visible y features efectivas del usuario autenticado.';

revoke all on function public.get_suite_lobby_context()
from public, anon, authenticated;

grant execute on function public.get_suite_lobby_context()
to authenticated;

commit;
