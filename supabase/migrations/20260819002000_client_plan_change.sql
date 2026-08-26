begin;

-- ============================================================
-- Cambio de plan desde el panel del cliente
--
-- Tres riesgos que esta migración cierra:
--
--   1. Bajar de plan dejaba miembros de más. El límite de usuarios sólo
--      se revisaba al AGREGAR gente, no al cambiar de plan. Una
--      organización con 15 miembros podía pasarse a un plan de 1 y
--      conservarlos. Ahora el cambio se rechaza hasta que sobre cupo.
--
--   2. Bajar de plan dejaba soluciones de más. Se recorta la selección
--      al cupo nuevo, igual que ya hacía el panel de plataforma.
--
--   3. Subirse solo a un plan de paga. Mientras no exista cobro
--      conectado, cambiarse a un plan con precio queda bloqueado con
--      PAYMENT_REQUIRED. Bajar a un plan gratuito siempre se permite:
--      ahí el cliente pierde cosas, no gana.
--
-- Además se expone una previsualización para que la pantalla muestre
-- POR QUÉ un plan no está disponible, en vez de fallar al hacer clic.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Previsualización: a qué planes puede moverse y por qué no
-- ------------------------------------------------------------

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
  v_active_members bigint;
  v_selected bigint;
  v_has_provider boolean;
begin
  if not public.is_active_organization_member(p_organization_id) then
    raise exception 'NOT_ORGANIZATION_MEMBER' using errcode = '42501';
  end if;

  select o.country into v_country from public.organizations o where o.id = p_organization_id;

  select s.plan_id, s.provider_subscription_id is not null
  into v_current_plan, v_has_provider
  from public.subscriptions s
  where s.organization_id = p_organization_id and s.is_current
  limit 1;

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
          'isCurrent', p.id = v_current_plan,
          -- Motivo por el que no se puede cambiar, o null si sí se puede.
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
      -- left join: un plan sin límite de usuarios definido no debe
      -- desaparecer de la lista, sólo queda sin tope.
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

-- ------------------------------------------------------------
-- 2. Cambio de plan
-- ------------------------------------------------------------

create or replace function public.org_change_plan(
  p_organization_id uuid,
  p_plan_id text,
  p_billing_interval text default 'month'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.plans%rowtype;
  v_country text;
  v_precio jsonb;
  v_monto bigint;
  v_user_limit bigint;
  v_active_members bigint;
  v_has_provider boolean;
  v_recortadas integer := 0;
begin
  if not public.has_organization_permission(p_organization_id, 'plan.change') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if p_billing_interval not in ('month', 'year') then
    raise exception 'INVALID_INTERVAL';
  end if;

  select * into v_plan from public.plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'PLAN_NOT_FOUND';
  end if;

  if not v_plan.is_self_serve then
    raise exception 'CONTACT_SALES';
  end if;

  select o.country into v_country from public.organizations o where o.id = p_organization_id;
  v_precio := public.resolve_plan_price(p_plan_id, v_country, p_billing_interval);
  v_monto := coalesce((v_precio ->> 'amountCents')::bigint, 0);

  select s.provider_subscription_id is not null into v_has_provider
  from public.subscriptions s
  where s.organization_id = p_organization_id and s.is_current
  limit 1;

  -- Sin cobro conectado, nadie se sube solo a un plan de paga.
  if v_monto > 0 and not coalesce(v_has_provider, false) then
    raise exception 'PAYMENT_REQUIRED';
  end if;

  -- El plan nuevo debe alcanzar para la gente que ya está dentro.
  select pf.limit_value into v_user_limit
  from public.plan_features pf
  where pf.plan_id = p_plan_id and pf.feature_key = 'users';

  if v_user_limit is not null then
    select count(*) into v_active_members
    from public.organization_members
    where organization_id = p_organization_id and status = 'active';

    if v_active_members > v_user_limit then
      raise exception 'TOO_MANY_MEMBERS: % activos, el plan permite %', v_active_members, v_user_limit;
    end if;
  end if;

  update public.subscriptions
  set plan_id = p_plan_id,
      billing_interval = p_billing_interval,
      updated_at = now()
  where organization_id = p_organization_id and is_current;

  -- Recorta las soluciones que ya no caben en el cupo nuevo.
  if v_plan.basic_solution_quota is not null then
    with ordenadas as (
      select os.solution_id,
             row_number() over (order by os.created_at, os.solution_id) as rn
      from public.organization_solutions os
      where os.organization_id = p_organization_id
    )
    delete from public.organization_solutions os
    using ordenadas
    where os.organization_id = p_organization_id
      and os.solution_id = ordenadas.solution_id
      and ordenadas.rn > v_plan.basic_solution_quota;

    get diagnostics v_recortadas = row_count;
  end if;

  insert into public.audit_logs (organization_id, actor_user_id, action, target_table, target_id, metadata)
  values (
    p_organization_id, auth.uid(), 'organization.change_plan', 'subscriptions', p_organization_id,
    jsonb_build_object('plan_id', p_plan_id, 'interval', p_billing_interval,
                       'soluciones_recortadas', v_recortadas)
  );

  return jsonb_build_object('planId', p_plan_id, 'solucionesRecortadas', v_recortadas);
end;
$$;

revoke all on function public.org_change_plan(uuid, text, text) from public, anon;
grant execute on function public.org_change_plan(uuid, text, text) to authenticated;

commit;
