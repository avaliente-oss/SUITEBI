import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ViewerContext } from "./suite-data";

type LobbyContextPayload = ViewerContext & {
  contractVersion: number;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient() {
  if (!isSupabaseConfigured) return null;

  if (!browserClient) {
    browserClient = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return browserClient;
}

function isLobbyContext(value: unknown): value is LobbyContextPayload {
  if (!value || typeof value !== "object") return false;

  const context = value as Partial<LobbyContextPayload>;
  return (
    context.contractVersion === 1 &&
    typeof context.id === "string" &&
    typeof context.email === "string" &&
    typeof context.fullName === "string" &&
    Array.isArray(context.organizations)
  );
}

export async function loadViewerContext(client: SupabaseClient): Promise<ViewerContext> {
  const { data, error } = await client.rpc("get_suite_lobby_context");

  if (error) throw error;
  if (!isLobbyContext(data)) {
    throw new Error("La base de datos devolvió un contexto de lobby incompatible.");
  }

  return data;
}

function slugifyOrganizationName(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 60);

  return base.length ? base : "organizacion";
}

export async function createOrganizationForCurrentUser(client: SupabaseClient, name: string, userId: string) {
  const baseSlug = slugifyOrganizationName(name);
  let slug = baseSlug;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { error } = await client.from("organizations").insert({
      name,
      slug,
      created_by: userId,
    });

    if (!error) return;
    if (error.code !== "23505") throw error;

    slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  throw new Error("No pudimos crear tu organización, ese nombre ya está muy solicitado. Intenta con otro.");
}

export async function completePendingOrganizationSetup(client: SupabaseClient) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return;

  const pendingName = data.user.user_metadata?.pending_organization_name;
  if (typeof pendingName !== "string" || !pendingName.trim()) return;

  await createOrganizationForCurrentUser(client, pendingName.trim(), data.user.id);
  await client.auth.updateUser({ data: { pending_organization_name: null } });
}

export async function signUpWithOrganization(
  client: SupabaseClient,
  params: { fullName: string; organizationName: string; email: string; password: string },
) {
  const { fullName, organizationName, email, password } = params;

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        pending_organization_name: organizationName,
      },
      emailRedirectTo:
        typeof window !== "undefined" ? window.location.origin : undefined,
    },
  });

  if (error) throw error;

  if (data.session && data.user) {
    await createOrganizationForCurrentUser(client, organizationName, data.user.id);
    await client.auth.updateUser({ data: { pending_organization_name: null } });
    return { needsEmailConfirmation: false };
  }

  return { needsEmailConfirmation: true };
}

export async function updateFullName(client: SupabaseClient, fullName: string) {
  const { error } = await client.auth.updateUser({ data: { full_name: fullName } });
  if (error) throw error;
}

export async function updatePassword(client: SupabaseClient, password: string) {
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
}

export async function requestPasswordReset(client: SupabaseClient, email: string) {
  const redirectTo =
    typeof window !== "undefined" ? `${window.location.origin}/restablecer-contrasena` : undefined;
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function requestSolutionBridgeRedirect(
  client: SupabaseClient,
  organizationId: string,
  solutionId: string,
) {
  const { data: sessionData } = await client.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("No hay una sesión activa.");

  const response = await fetch("/api/solution-bridge", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ organizationId, solutionId }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error ?? "No pudimos conectar con esa solución.");
  }

  return payload as { redirectUrl: string };
}

export async function listActiveSolutions(client: SupabaseClient) {
  const { data, error } = await client.rpc("list_active_solutions");
  if (error) throw error;
  return (data ?? []) as import("./suite-data").Solution[];
}

export type AdminOrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_id: string;
  plan_name: string;
  access_status: string;
  member_count: number;
  override_count: number;
};

export type AdminOrganizationFeature = {
  key: string;
  name: string;
  description: string | null;
  plan_enabled: boolean;
  override_enabled: boolean | null;
  effective: boolean;
};

export async function checkPlatformAdmin(client: SupabaseClient) {
  const { data, error } = await client.rpc("am_i_platform_admin");
  if (error) return false;
  return Boolean(data);
}

export async function adminListOrganizations(client: SupabaseClient) {
  const { data, error } = await client.rpc("admin_list_organizations");
  if (error) throw error;
  return (data ?? []) as AdminOrganizationSummary[];
}

export async function adminGetOrganizationFeatures(client: SupabaseClient, organizationId: string) {
  const { data, error } = await client.rpc("admin_get_organization_features", {
    p_organization_id: organizationId,
  });
  if (error) throw error;
  return (data ?? []) as AdminOrganizationFeature[];
}

export async function adminSetFeatureOverride(
  client: SupabaseClient,
  organizationId: string,
  featureKey: string,
  enabled: boolean,
  note?: string,
) {
  const { error } = await client.rpc("admin_set_feature_override", {
    p_organization_id: organizationId,
    p_feature_key: featureKey,
    p_enabled: enabled,
    p_note: note ?? null,
  });
  if (error) throw error;
}

export async function adminClearFeatureOverride(client: SupabaseClient, organizationId: string, featureKey: string) {
  const { error } = await client.rpc("admin_clear_feature_override", {
    p_organization_id: organizationId,
    p_feature_key: featureKey,
  });
  if (error) throw error;
}

export type AdminSolution = {
  id: string;
  name: string;
  eyebrow: string;
  description: string;
  icon: string;
  feature_key: string;
  action: string;
  is_external: boolean;
  external_url: string | null;
  metric: string;
  metric_label: string;
  sort_order: number;
  is_active: boolean;
};

export async function adminListSolutions(client: SupabaseClient) {
  const { data, error } = await client.rpc("admin_list_solutions");
  if (error) throw error;
  return (data ?? []) as AdminSolution[];
}

export async function adminUpsertSolution(
  client: SupabaseClient,
  input: {
    id: string;
    name: string;
    eyebrow: string;
    description: string;
    icon: string;
    featureKey: string;
    featureName: string;
    isExternal: boolean;
    externalUrl: string;
    metric?: string;
    metricLabel?: string;
    sortOrder?: number;
  },
) {
  const { error } = await client.rpc("admin_upsert_solution", {
    p_id: input.id,
    p_name: input.name,
    p_eyebrow: input.eyebrow,
    p_description: input.description,
    p_icon: input.icon,
    p_feature_key: input.featureKey,
    p_feature_name: input.featureName,
    p_is_external: input.isExternal,
    p_external_url: input.externalUrl,
    p_metric: input.metric ?? "",
    p_metric_label: input.metricLabel ?? "",
    p_sort_order: input.sortOrder ?? 100,
  });
  if (error) throw error;
}

export async function adminSetSolutionActive(client: SupabaseClient, id: string, active: boolean) {
  const { error } = await client.rpc("admin_set_solution_active", { p_id: id, p_active: active });
  if (error) throw error;
}

export async function adminDeleteSolution(client: SupabaseClient, id: string) {
  const { error } = await client.rpc("admin_delete_solution", { p_id: id });
  if (error) throw error;
}

// ── Gestión de usuarios (panel admin) ───────────────────────────────

export const ORGANIZATION_ROLE_OPTIONS = [
  "admin",
  "analyst",
  "editor",
  "viewer",
  "external_viewer",
] as const;

export type AssignableOrganizationRole = (typeof ORGANIZATION_ROLE_OPTIONS)[number];

export type AdminMember = {
  userId: string;
  email: string | null;
  fullName: string;
  role: string;
  status: string;
  isPrimaryOwner: boolean;
  joinedAt: string | null;
  createdAt: string;
};

export type AdminInvitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  token: string;
  expiresAt: string;
  createdAt: string;
};

export type AdminUserSearchResult = {
  userId: string;
  email: string | null;
  fullName: string;
  isActive: boolean;
  createdAt: string;
  organizations: {
    organizationId: string;
    organizationName: string;
    role: string;
    status: string;
    isPrimaryOwner: boolean;
  }[];
};

export type AdminPlatformAdmin = {
  email: string;
  createdAt: string;
  hasAccount: boolean;
};

/** Traduce los códigos de error de los RPC a algo que un humano entienda. */
export function describeAdminError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const messages: Record<string, string> = {
    NOT_PLATFORM_ADMIN: "No tienes permisos de administrador de plataforma.",
    MEMBER_NOT_FOUND: "Ese usuario ya no pertenece a la organización.",
    CANNOT_CHANGE_PRIMARY_OWNER:
      "No se puede modificar al propietario principal desde el panel. El cambio de propiedad lo hace el dueño de la organización.",
    CANNOT_DEACTIVATE_PRIMARY_OWNER:
      "No se puede suspender ni quitar al propietario principal: toda organización activa necesita uno.",
    OWNERSHIP_CHANGE_NOT_ALLOWED_HERE:
      "Los roles de propietario y copropietario los administra el dueño de la organización, no el panel de plataforma.",
    OWNERSHIP_INVITATION_NOT_ALLOWED_HERE:
      "No se puede invitar como propietario o copropietario desde el panel de plataforma.",
    USER_QUOTA_EXCEEDED:
      "La organización llegó al máximo de usuarios de su plan. Sube el plan o agrega una excepción al feature 'users'.",
    USERS_FEATURE_NOT_ENABLED:
      "La organización no tiene habilitado el feature 'users'. Actívalo en la hoja de permisos.",
    ALREADY_A_MEMBER: "Ese correo ya pertenece a la organización.",
    INVALID_EMAIL: "El correo no tiene un formato válido.",
    INVALID_STATUS: "Estado no válido.",
    CANNOT_REMOVE_SELF: "No puedes quitarte a ti mismo del panel de administradores.",
    LAST_PLATFORM_ADMIN: "No se puede quedar sin administradores de plataforma.",
    NAME_REQUIRED: "El nombre no puede quedar vacío.",
    OWNER_HAS_NO_ACCOUNT:
      "Ese correo todavía no tiene cuenta en la Suite. Crea la organización sin dueño y asígnalo cuando la persona se registre, o invítala primero.",
    ORGANIZATION_ALREADY_HAS_OWNER:
      "Esta organización ya tiene propietario. El cambio de propiedad lo hace el dueño actual desde su cuenta.",
    ORGANIZATION_NOT_FOUND: "Esa organización ya no existe.",
    CONFIRMATION_MISMATCH: "El nombre que escribiste no coincide con el de la organización.",
    PLAN_NOT_FOUND: "Ese plan no existe.",
    SLUG_UNAVAILABLE: "No pudimos generar un identificador único para ese nombre. Prueba con otro.",
    CANNOT_DEACTIVATE_SELF: "No puedes desactivar tu propia cuenta.",
    ROLE_CHANGE_REQUIRES_OWNER:
      "Ese cambio de propiedad lo debe hacer el dueño de la organización desde su cuenta.",
  };

  for (const [code, message] of Object.entries(messages)) {
    if (raw.includes(code)) return message;
  }

  return raw || "Ocurrió un error inesperado.";
}

export async function adminListOrganizationMembers(client: SupabaseClient, organizationId: string) {
  const { data, error } = await client.rpc("admin_list_organization_members", {
    p_organization_id: organizationId,
  });
  if (error) throw error;
  return (data ?? []) as AdminMember[];
}

export async function adminSetMemberRole(
  client: SupabaseClient,
  organizationId: string,
  userId: string,
  role: string,
) {
  const { error } = await client.rpc("admin_set_member_role", {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw error;
}

export async function adminSetMemberStatus(
  client: SupabaseClient,
  organizationId: string,
  userId: string,
  status: "active" | "suspended" | "removed",
) {
  const { error } = await client.rpc("admin_set_member_status", {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_status: status,
  });
  if (error) throw error;
}

export async function adminListInvitations(client: SupabaseClient, organizationId: string) {
  const { data, error } = await client.rpc("admin_list_invitations", {
    p_organization_id: organizationId,
  });
  if (error) throw error;
  return (data ?? []) as AdminInvitation[];
}

export async function adminCreateInvitation(
  client: SupabaseClient,
  organizationId: string,
  email: string,
  role: string,
) {
  const { data, error } = await client.rpc("admin_create_invitation", {
    p_organization_id: organizationId,
    p_email: email,
    p_role: role,
  });
  if (error) throw error;
  return data as { id: string; token: string; email: string };
}

export async function adminRevokeInvitation(client: SupabaseClient, invitationId: string) {
  const { error } = await client.rpc("admin_revoke_invitation", { p_invitation_id: invitationId });
  if (error) throw error;
}

export async function adminSearchUsers(client: SupabaseClient, query: string) {
  const { data, error } = await client.rpc("admin_search_users", { p_query: query });
  if (error) throw error;
  return (data ?? []) as AdminUserSearchResult[];
}

export async function adminListPlatformAdmins(client: SupabaseClient) {
  const { data, error } = await client.rpc("admin_list_platform_admins");
  if (error) throw error;
  return (data ?? []) as AdminPlatformAdmin[];
}

export async function adminAddPlatformAdmin(client: SupabaseClient, email: string) {
  const { error } = await client.rpc("admin_add_platform_admin", { p_email: email });
  if (error) throw error;
}

export async function adminRemovePlatformAdmin(client: SupabaseClient, email: string) {
  const { error } = await client.rpc("admin_remove_platform_admin", { p_email: email });
  if (error) throw error;
}

// ── Administración de organizaciones ────────────────────────────────

export const ORGANIZATION_STATUS_OPTIONS = ["active", "suspended", "inactive"] as const;
export const ACCESS_STATUS_OPTIONS = ["trial", "full", "limited", "pending", "suspended"] as const;

export type AdminPlan = { id: string; name: string; description: string | null };

export async function adminListPlans(client: SupabaseClient) {
  const { data, error } = await client.rpc("admin_list_plans");
  if (error) throw error;
  return (data ?? []) as AdminPlan[];
}

export async function adminCreateOrganization(
  client: SupabaseClient,
  input: { name: string; planId?: string; ownerEmail?: string },
) {
  const { data, error } = await client.rpc("admin_create_organization", {
    p_name: input.name,
    p_plan_id: input.planId ?? null,
    p_owner_email: input.ownerEmail ?? null,
  });
  if (error) throw error;
  return data as { id: string; slug: string; hasOwner: boolean };
}

export async function adminSetPrimaryOwner(client: SupabaseClient, organizationId: string, email: string) {
  const { error } = await client.rpc("admin_set_primary_owner", {
    p_organization_id: organizationId,
    p_email: email,
  });
  if (error) throw error;
}

export async function adminUpdateOrganization(client: SupabaseClient, organizationId: string, name: string) {
  const { error } = await client.rpc("admin_update_organization", {
    p_organization_id: organizationId,
    p_name: name,
  });
  if (error) throw error;
}

export async function adminSetOrganizationStatus(
  client: SupabaseClient,
  organizationId: string,
  status: string,
) {
  const { error } = await client.rpc("admin_set_organization_status", {
    p_organization_id: organizationId,
    p_status: status,
  });
  if (error) throw error;
}

export async function adminSetOrganizationPlan(
  client: SupabaseClient,
  organizationId: string,
  planId: string,
  accessStatus: string,
) {
  const { error } = await client.rpc("admin_set_organization_plan", {
    p_organization_id: organizationId,
    p_plan_id: planId,
    p_access_status: accessStatus,
  });
  if (error) throw error;
}

export async function adminDeleteOrganization(
  client: SupabaseClient,
  organizationId: string,
  confirmName: string,
) {
  const { error } = await client.rpc("admin_delete_organization", {
    p_organization_id: organizationId,
    p_confirm_name: confirmName,
  });
  if (error) throw error;
}

export async function adminUpdateUserProfile(client: SupabaseClient, userId: string, fullName: string) {
  const { error } = await client.rpc("admin_update_user_profile", {
    p_user_id: userId,
    p_full_name: fullName,
  });
  if (error) throw error;
}

export async function adminSetUserActive(client: SupabaseClient, userId: string, isActive: boolean) {
  const { error } = await client.rpc("admin_set_user_active", {
    p_user_id: userId,
    p_is_active: isActive,
  });
  if (error) throw error;
}

/** Acepta una invitación con el token del enlace. La usa /invitacion. */
export async function acceptInvitation(client: SupabaseClient, token: string) {
  const { data, error } = await client.rpc("accept_invitation", { p_token_hash: token });
  if (error) throw error;
  return data as string;
}

export async function authorizeSolution(
  client: SupabaseClient,
  organizationId: string,
  requestedAction: string,
  featureKey: string,
) {
  const { data, error } = await client.rpc("authorize_action", {
    p_organization_id: organizationId,
    p_action: "suite.launch",
    p_workspace_id: null,
    p_resource_id: null,
    p_feature_key: featureKey,
    p_usage_units: 0,
    p_consume_quota: false,
    p_metadata: { surface: "suite_lobby", requested_action: requestedAction },
  });

  if (error) throw error;
  return data as { allowed: boolean; reason_code: string; upgrade_required?: boolean };
}
