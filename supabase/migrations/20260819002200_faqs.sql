begin;

-- ============================================================
-- Preguntas frecuentes
--
-- Editables desde el panel admin, igual que las soluciones y los
-- planes: agregar una pregunta no debe requerir un despliegue.
--
-- Se siembran las que hoy responde el equipo a mano, para que la
-- sección no nazca vacía.
-- ============================================================

create table if not exists public.faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint faqs_question_not_blank check (length(trim(question)) > 0),
  constraint faqs_answer_not_blank check (length(trim(answer)) > 0)
);

alter table public.faqs enable row level security;

create trigger faqs_set_updated_at
before update on public.faqs
for each row execute function public.set_updated_at();

insert into public.faqs (question, answer, sort_order) values
  (
    '¿Cómo invito a alguien a mi organización?',
    'Entra a Equipo y accesos desde el menú. Si la persona ya tiene cuenta en la Suite, la agregas al instante con su correo. Si no la tiene, se genera un enlace de invitación que le envías tú y con el que crea su contraseña. Sólo el propietario, copropietario o administrador pueden hacerlo.',
    10
  ),
  (
    '¿Cómo cambio de plan?',
    'En Plan y facturación ves todos los planes con su precio. Al elegir uno, te mostramos qué cambia antes de confirmar: cuánto sube o baja tu cobro, cuántas soluciones incluye y cuántos usuarios permite. El cambio de plan lo hace el propietario de la organización.',
    20
  ),
  (
    '¿Qué pasa si bajo a un plan más chico?',
    'Tu acceso se ajusta al nuevo plan. Si tenías más soluciones de las que caben en el cupo, se quitan las más recientes y te lo avisamos antes de confirmar. Si tienes más miembros activos de los que permite el plan nuevo, el cambio no se aplica hasta que quites a algunos: nunca dejamos a alguien fuera sin avisarte.',
    30
  ),
  (
    '¿Puedo usar más de una solución?',
    'Depende de tu plan. Cada plan incluye un número de soluciones básicas y tú eliges cuáles quieres usar desde Plan y facturación. Puedes cambiar tu elección cuando quieras, dentro del cupo que tengas.',
    40
  ),
  (
    '¿Cómo cambio mi contraseña?',
    'Desde Mi cuenta puedes actualizarla en cualquier momento. Si la olvidaste, usa "¿La olvidaste?" en la pantalla de acceso y te llega un enlace por correo para elegir una nueva.',
    50
  ),
  (
    'No puedo abrir una solución, ¿qué hago?',
    'Casi siempre es que esa solución no está incluida en tu plan: en el catálogo aparece marcada como bloqueada. Revisa en Plan y facturación qué incluye tu plan y cuáles elegiste. Si crees que sí debería estar disponible, escríbenos desde aquí y lo revisamos.',
    60
  )
on conflict do nothing;

-- ------------------------------------------------------------
-- Lectura para el cliente
-- ------------------------------------------------------------

create or replace function public.list_active_faqs()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', f.id, 'question', f.question, 'answer', f.answer)
      order by f.sort_order, f.created_at
    ),
    '[]'::jsonb
  )
  from public.faqs f
  where f.is_active;
$$;

revoke all on function public.list_active_faqs() from public, anon;
grant execute on function public.list_active_faqs() to authenticated;

-- ------------------------------------------------------------
-- Administración
-- ------------------------------------------------------------

create or replace function public.admin_list_faqs()
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
        'id', f.id,
        'question', f.question,
        'answer', f.answer,
        'sortOrder', f.sort_order,
        'isActive', f.is_active
      )
      order by f.sort_order, f.created_at
    ),
    '[]'::jsonb
  )
  into v_result
  from public.faqs f;

  return v_result;
end;
$$;

revoke all on function public.admin_list_faqs() from public, anon;
grant execute on function public.admin_list_faqs() to authenticated;

create or replace function public.admin_upsert_faq(
  p_id uuid,
  p_question text,
  p_answer text,
  p_sort_order integer default 100,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_question, ''))) = 0 then
    raise exception 'QUESTION_REQUIRED';
  end if;

  if length(trim(coalesce(p_answer, ''))) = 0 then
    raise exception 'ANSWER_REQUIRED';
  end if;

  if p_id is null then
    insert into public.faqs (question, answer, sort_order, is_active, created_by)
    values (trim(p_question), trim(p_answer), coalesce(p_sort_order, 100),
            coalesce(p_is_active, true), auth.uid())
    returning id into v_id;
  else
    update public.faqs
    set question = trim(p_question),
        answer = trim(p_answer),
        sort_order = coalesce(p_sort_order, sort_order),
        is_active = coalesce(p_is_active, is_active),
        updated_at = now()
    where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'FAQ_NOT_FOUND';
    end if;
  end if;

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (auth.uid(), 'admin.faq.upsert', 'faqs', v_id, jsonb_build_object('question', p_question));

  return v_id;
end;
$$;

revoke all on function public.admin_upsert_faq(uuid, text, text, integer, boolean) from public, anon;
grant execute on function public.admin_upsert_faq(uuid, text, text, integer, boolean) to authenticated;

create or replace function public.admin_delete_faq(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  delete from public.faqs where id = p_id;

  insert into public.audit_logs (actor_user_id, action, target_table, target_id, metadata)
  values (auth.uid(), 'admin.faq.delete', 'faqs', p_id, '{}'::jsonb);
end;
$$;

revoke all on function public.admin_delete_faq(uuid) from public, anon;
grant execute on function public.admin_delete_faq(uuid) to authenticated;

commit;
