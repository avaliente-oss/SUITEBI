begin;

-- ============================================================
-- Comparación de precio al cambiar de plan
--
-- Para que el cliente sepa ANTES de confirmar qué va a pagar y qué gana
-- o pierde, la previsualización ahora devuelve también lo que paga hoy:
-- su plan, su periodicidad contratada y su tarifa actual.
--
-- La comparación honesta es "lo que pagas hoy" contra "lo que pagarías",
-- no dos tarifas hipotéticas. Por eso la actual se resuelve con la
-- periodicidad realmente contratada, no con la que el cliente esté
-- mirando en pantalla.
-- ============================================================

create or replace function public.org_plan_change_preview(
  p_organization_id uuid,
  p_billing_interval text default 'month'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_country text;
  v_current_plan text;
  v_current_interval text;
  v_current_precio jsonb;
  v_current_row public.plans%rowtype;
  v_current_user_limit bigint;
  v_active_members bigint;
  v_selected bigint;
  v_has_provider boolean;
begin
  if not public.is_active_organization_member(p_organization_id) then
    raise exception 'NOT_ORGANIZATION_MEMBER' using errcode = '42501';
  end if;

  select o.country into v_country from public.organizations o where o.id = p_organization_id;

  select s.plan_id, coalesce(s.billing_interval, 'month'), s.provider_subscription_id is not null
  into v_current_plan, v_current_interval, v_has_provider
  from public.subscriptions s
  where s.organization_id = p_organization_id and s.is_current
  limit 1;

  select * into v_current_row from public.plans where id = v_current_plan;

  select pf.limit_value into v_current_user_limit
  from public.plan_features pf
  where pf.plan_id = v_current_plan and pf.feature_key = 'users';

  -- La tarifa actual se resuelve con la periodicidad contratada.
  v_current_precio := public.resolve_plan_price(v_current_plan, v_country, v_current_interval);

  select count(*) into v_active_members
  from public.organization_members
  where organization_id = p_organization_id and status = 'active';

  select count(*) into v_selected
  from public.organization_solutions
  where organization_id = p_organization_id;

  return jsonb_build_object(
    'currentPlan', v_current_plan,
    'activeMembers', v_active_members,
    'selectedSolutions', v_selected,
    'canManage', public.has_organization_permission(p_organization_id, 'plan.change'),
    'current', jsonb_build_object(
      'planId', v_current_plan,
      'name', coalesce(v_current_row.name, 'Sin plan'),
      'billingInterval', v_current_interval,
      'amountCents', (v_current_precio ->> 'amountCents')::bigint,
      'priceLabel', public.format_plan_price(
        (v_current_precio ->> 'amountCents')::bigint,
        v_current_precio ->> 'currency',
        v_current_interval,
        coalesce(v_current_row.price_label, '')
      ),
      'basicQuota', v_current_row.basic_solution_quota,
      'userLimit', v_current_user_limit
    ),
    'plans', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'tagline', p.tagline,
          'basicQuota', p.basic_solution_quota,
          'userLimit', lim.valor,
          'priceLabel', public.format_plan_price(
            (precio ->> 'amountCents')::bigint, precio ->> 'currency',
            p_billing_interval, p.price_label
          ),
          'amountCents', (precio ->> 'amountCents')::bigint,
          'currency', precio ->> 'currency',
          'isCurrent', p.id = v_current_plan,
          'blockedReason', case
            when p.id = v_current_plan then null
            when not p.is_self_serve then 'CONTACT_SALES'
            when lim.valor is not null and v_active_members > lim.valor then 'TOO_MANY_MEMBERS'
            when coalesce((precio ->> 'amountCents')::bigint, 0) > 0 and not coalesce(v_has_provider, false)
              then 'PAYMENT_REQUIRED'
            else null
          end
        )
        order by p.sort_order
      )
      from public.plans p
      cross join lateral (
        select public.resolve_plan_price(p.id, v_country, p_billing_interval) as precio
      ) pr
      left join lateral (
        select pf.limit_value as valor
        from public.plan_features pf
        where pf.plan_id = p.id and pf.feature_key = 'users'
      ) lim on true
      where p.is_self_serve or p.id = 'enterprise'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.org_plan_change_preview(uuid, text) from public, anon;
grant execute on function public.org_plan_change_preview(uuid, text) to authenticated;

commit;
