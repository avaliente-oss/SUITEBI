begin;

-- ============================================================
-- Registro desde una invitación
--
-- Problema que resuelve: una persona invitada que todavía no tiene
-- cuenta quedaba atorada. El enlace le pedía iniciar sesión, y al
-- registrarse por la vía normal el sistema le creaba una organización
-- propia en lugar de meterla a la que la invitó.
--
-- Con esto, la pantalla de invitación puede mostrar a qué organización
-- la invitaron y dejarla crear su contraseña ahí mismo.
--
-- Seguridad: la función recibe el token, que es un valor aleatorio de
-- 64 caracteres imposible de adivinar y que sólo tiene quien recibió el
-- enlace. Devuelve únicamente el correo invitado, el nombre de la
-- organización y el rol — nada de datos de otros miembros. Se limita a
-- invitaciones vigentes y sin usar.
-- ============================================================

create or replace function public.get_invitation_preview(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'email', i.email,
    'role', i.role,
    'organizationName', o.name,
    'expiresAt', i.expires_at
  )
  from public.invitations i
  join public.organizations o on o.id = i.organization_id
  where i.token_hash = p_token
    and i.status = 'pending'
    and i.expires_at >= now()
  limit 1;
$$;

grant execute on function public.get_invitation_preview(text) to anon, authenticated;

commit;
