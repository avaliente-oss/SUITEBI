# DAVALSY Business Suite

Repositorio de la suite de soluciones DAVALSY. Incluye el modelo de usuarios y seguridad en Supabase y el lobby web donde cada cliente accede a las soluciones de su plan.

## Frontend

La aplicación vive en `apps/web` y está construida con Next.js, TypeScript y Supabase. Incluye:

- Inicio de sesión con correo/contraseña o enlace seguro.
- Selección de organización y contexto de plan.
- Contexto del lobby servido por `get_suite_lobby_context()` desde la base existente.
- Soluciones habilitadas por `subscriptions`, `plans` y `plan_features`.
- Validación en servidor con el RPC `authorize_action` antes de abrir una app.
- Mesa multitarea para mantener varias soluciones abiertas.
- Experiencia adaptable a escritorio y móvil.
- Modo demo automático cuando no hay variables de Supabase configuradas.

### Desarrollo local

```bash
cd apps/web
cp .env.example .env.local
pnpm install
pnpm dev
```

Variables requeridas:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SITE_URL=https://your-project.vercel.app
```

Nunca uses la `service_role` en el frontend.

## Supabase

El frontend usa como única fuente de verdad el modelo existente de `supabase/migrations`:

1. `20260813000100_user_security_core.sql` crea usuarios, organizaciones, membresías, planes, features, suscripciones, RLS y `authorize_action`.
2. `20260815000100_suite_lobby_access.sql` agrega el permiso organizacional `suite.launch`.
3. `20260815000200_suite_lobby_context.sql` expone el contrato seguro `get_suite_lobby_context()` para el frontend.

El navegador sólo recibe la llave `anon`. No consulta datos de Stripe ni usa `service_role`. Supabase Auth identifica al usuario, el RPC devuelve únicamente sus organizaciones activas y `authorize_action` vuelve a validar membresía, rol, suscripción y feature antes de abrir una solución.

## GitHub y Vercel

1. Publica este repositorio en GitHub.
2. Importa el repositorio en Vercel.
3. Define `apps/web` como **Root Directory**.
4. Ejecuta las tres migraciones anteriores en el mismo proyecto Supabase que contiene tus usuarios.
5. Agrega `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `NEXT_PUBLIC_SITE_URL` en Vercel.
6. En Supabase Auth, agrega el dominio de Vercel a **Site URL** y **Redirect URLs** para habilitar enlaces seguros.
