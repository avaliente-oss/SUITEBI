# Core de usuarios, membresias y seguridad

Esta carpeta aterriza el modelo del PDF en Supabase/Postgres. La primera migracion crea el core multiempresa para la Suite BI: organizaciones, miembros, workspaces, roles, permisos, suscripciones, features, cuotas, recursos BI, auditoria y el motor central `authorize_action`.

## Idea base

La organizacion es el tenant y el cliente comercial. El usuario vive en `auth.users` y su perfil extendido vive en `public.profiles`. La relacion real entre una persona y una empresa esta en `public.organization_members`.

Los workspaces separan areas, filiales, equipos o proyectos dentro de la misma organizacion. Todo recurso BI debe resolverse hacia un `organization_id` y un `workspace_id`.

## Tablas principales

- `profiles`: perfil extendido de Supabase Auth.
- `organizations`: tenant comercial.
- `organization_members`: usuario + organizacion + rol + estado.
- `workspaces`: frontera operativa dentro de una organizacion.
- `workspace_members`: acceso local al workspace.
- `plans`, `features`, `plan_features`: catalogo comercial y limites.
- `subscriptions`: proyeccion local de Stripe por organizacion.
- `bi_resources`: registro comun para dashboards, datasets, fuentes, reportes, metricas y alertas.
- `resource_permissions`: excepciones puntuales por recurso.
- `usage_counters`, `usage_events`: cuotas atomicas y trazabilidad.
- `access_decisions`, `audit_logs`: observabilidad de seguridad.

## Motor de autorizacion

La funcion publica para decidir acciones es:

```sql
select public.authorize_action(
  p_organization_id := '00000000-0000-0000-0000-000000000000',
  p_action := 'dashboard.export',
  p_workspace_id := '00000000-0000-0000-0000-000000000000',
  p_resource_id := '00000000-0000-0000-0000-000000000000',
  p_consume_quota := false
);
```

Respuesta esperada:

```json
{
  "allowed": true,
  "reason_code": "OK",
  "decision_id": "...",
  "required_feature": "dashboard.export",
  "upgrade_required": false
}
```

RPCs operativos incluidos:

- `authorize_action(...)`: decide y audita una accion.
- `accept_invitation(token_hash)`: convierte una invitacion pendiente en membresia activa.
- `transfer_primary_owner(organization_id, new_primary_owner_member_id)`: transfiere propiedad de forma auditada.
- `get_suite_lobby_context()`: devuelve al frontend el perfil, organizaciones, plan visible y features efectivas del usuario autenticado.

Codigos importantes:

- `UNAUTHENTICATED`
- `USER_INACTIVE`
- `NOT_ORGANIZATION_MEMBER`
- `ORGANIZATION_INACTIVE`
- `MEMBERSHIP_INACTIVE`
- `FEATURE_NOT_INCLUDED`
- `ROLE_NOT_ALLOWED`
- `WORKSPACE_NOT_ALLOWED`
- `RESOURCE_NOT_ALLOWED`
- `QUOTA_EXCEEDED`

## Reglas duras incluidas

- Una organizacion activa no puede quedar sin `primary_owner`.
- Solo quien tenga `ownership.transfer` puede tocar roles `owner`, `co_owner` o `is_primary_owner`.
- `workspace_members.organization_id` se sincroniza desde el workspace y se valida contra `organization_members`.
- `bi_resources.organization_id` se sincroniza desde el workspace.
- `resource_permissions` rechaza cruces entre organizaciones, workspaces, recursos y miembros.
- Las cuotas de `users`, `dashboards` y `data_sources` se validan con triggers.
- Los consumos atomicos pasan por `authorize_action`; `consume_feature_usage` no queda expuesta al cliente.

## Aplicacion

Las migraciones se aplican en este orden:

1. `20260813000100_user_security_core.sql`
2. `20260815000100_suite_lobby_access.sql`
3. `20260815000200_suite_lobby_context.sql`
4. `20260815000300_self_serve_trial.sql`

Con Supabase CLI:

```bash
supabase db push
```

En entornos con migraciones locales:

```bash
supabase migration up
```

La migracion asume un proyecto Supabase con `auth.users` disponible.

## Alta self-serve (registro desde la app)

El frontend (`apps/web`) implementa registro self-serve: el usuario crea su cuenta con
`supabase.auth.signUp` y en el mismo flujo se inserta una fila en `public.organizations`
con `created_by = auth.uid()`. Esto dispara dos triggers ya existentes en cadena:

- `organizations_create_owner_membership`: crea la membresia `owner` del usuario en su
  organizacion nueva.
- `organizations_start_trial_subscription` (nuevo, en `20260815000300_self_serve_trial.sql`):
  crea una suscripcion `trial` de 14 dias sobre el plan `starter` para que la organizacion
  tenga features activas desde el primer segundo, sin esperar a Stripe.

Si el proyecto tiene activa la confirmacion de correo en Supabase Auth, el `signUp` no
devuelve sesion de inmediato. El frontend guarda el nombre de la organizacion pendiente en
`user_metadata.pending_organization_name` y la crea automaticamente en el primer login
confirmado (`completePendingOrganizationSetup` en `apps/web/lib/supabase.ts`).

Para que el acceso sea inmediato sin confirmar correo (como se definio para este proyecto),
desactiva "Confirm email" en el dashboard de Supabase: Authentication → Sign In / Providers →
Email → "Confirm email" (off). Con eso, `signUp` entrega sesion activa de inmediato y la
organizacion se crea en el mismo submit del formulario de registro.
