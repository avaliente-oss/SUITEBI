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

Con Supabase CLI:

```bash
supabase db push
```

En entornos con migraciones locales:

```bash
supabase migration up
```

La migracion asume un proyecto Supabase con `auth.users` disponible.
