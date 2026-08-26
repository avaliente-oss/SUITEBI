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

/** El nombre es único sin distinguir mayúsculas ni acentos sobrantes. */
export async function isOrganizationNameAvailable(client: SupabaseClient, name: string) {
  const { data, error } = await client.rpc("organization_name_available", { p_name: name });
  // Si la función todavía no existe en la base, no se bloquea el registro:
  // el índice único sigue siendo la garantía real.
  if (error) return true;
  return Boolean(data);
}

export async function createOrganizationForCurrentUser(client: SupabaseClient, name: string, userId: string) {
  if (!(await isOrganizationNameAvailable(client, name))) {
    throw new Error("ORGANIZATION_NAME_TAKEN");
  }

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

/**
 * Extrae el texto de un error.
 *
 * Supabase no lanza objetos Error: lanza objetos planos
 * ({ message, details, hint, code }). Sin esto, String(error) devuelve
 * "[object Object]" y ningún mensaje traducido llega a la pantalla.
 */
export function errorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;

  if (typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    const partes = ["message", "details", "hint", "code"]
      .map((clave) => candidate[clave])
      .filter((valor): valor is string => typeof valor === "string" && valor.length > 0);
    if (partes.length) return partes.join(" · ");
  }

  return String(error);
}

/** Traduce los errores de Supabase Auth, que llegan en inglés. */
export function describeAuthError(error: unknown) {
  const raw = errorText(error).toLowerCase();

  if (raw.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (raw.includes("email not confirmed")) {
    return "Falta confirmar tu correo. Busca el mensaje que te enviamos y abre el enlace.";
  }
  if (raw.includes("signups not allowed") || raw.includes("user not found")) {
    return "No encontramos una cuenta con ese correo. Crea tu cuenta primero.";
  }
  if (raw.includes("already registered") || raw.includes("already been registered")) {
    return "Ese correo ya tiene cuenta. Inicia sesión o recupera tu contraseña.";
  }
  if (raw.includes("rate limit") || raw.includes("too many requests")) {
    return "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.";
  }
  if (raw.includes("password should be")) return "La contraseña debe tener al menos 8 caracteres.";
  if (raw.includes("unable to validate email") || raw.includes("invalid email")) {
    return "Ese correo no parece válido.";
  }
  if (raw.includes("organization_name_taken")) {
    return "Ya existe una organización con ese nombre. Usa uno distinto.";
  }

  return errorText(error) || "No pudimos completar la operación.";
}

export type OrganizationNameCheck = {
  available: boolean;
  reason: "OK" | "TAKEN" | "EMPTY";
  similar: string[];
};

/** Verifica disponibilidad exacta y devuelve nombres parecidos como aviso. */
export async function checkOrganizationName(client: SupabaseClient, name: string) {
  const { data, error } = await client.rpc("check_organization_name", { p_name: name });
  // Si la migración aún no está aplicada, no se bloquea el registro.
  if (error) return null;
  return data as OrganizationNameCheck;
}

export type PublicPlan = {
  id: string;
  name: string;
  description: string | null;
  tagline: string;
  priceLabel: string;
  basicQuota: number | null;
  selfServe: boolean;
};

export type BasicSolution = {
  id: string;
  name: string;
  eyebrow: string;
  description: string;
  icon: string;
};

export async function listPublicPlans(client: SupabaseClient) {
  const { data, error } = await client.rpc("list_public_plans");
  if (error) throw error;
  return (data ?? []) as PublicPlan[];
}

export async function listBasicSolutions(client: SupabaseClient) {
  const { data, error } = await client.rpc("list_basic_solutions");
  if (error) throw error;
  return (data ?? []) as BasicSolution[];
}

async function applySignupPlan(
  client: SupabaseClient,
  organizationId: string,
  planId: string,
  solutionIds: string[],
) {
  const { error } = await client.rpc("apply_signup_plan", {
    p_organization_id: organizationId,
    p_plan_id: planId,
    p_solution_ids: solutionIds,
  });
  if (error) throw error;
}

export async function signUpWithOrganization(
  client: SupabaseClient,
  params: {
    fullName: string;
    organizationName: string;
    email: string;
    password: string;
    planId: string;
    solutionIds: string[];
  },
) {
  const { fullName, organizationName, email, password, planId, solutionIds } = params;

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        pending_organization_name: organizationName,
        pending_plan_id: planId,
        pending_solution_ids: solutionIds,
      },
      emailRedirectTo:
        typeof window !== "undefined" ? window.location.origin : undefined,
    },
  });

  if (error) throw error;

  if (data.session && data.user) {
    await createOrganizationForCurrentUser(client, organizationName, data.user.id);
    const context = await loadViewerContext(client);
    const organization = context.organizations[0];
    if (organization) {
      await applySignupPlan(client, organization.id, planId, solutionIds);
    }
    await client.auth.updateUser({
      data: { pending_organization_name: null, pending_plan_id: null, pending_solution_ids: null },
    });
    return { needsEmailConfirmation: false };
  }

  return { needsEmailConfirmation: true };
}

export async function getOrganizationSolutions(client: SupabaseClient, organizationId: string) {
  const { data, error } = await client.rpc("get_organization_solutions", {
    p_organization_id: organizationId,
  });
  if (error) throw error;
  return (data ?? { quota: null, selected: [] }) as { quota: number | null; selected: string[] };
}

export async function setOrganizationSolutions(
  client: SupabaseClient,
  organizationId: string,
  solutionIds: string[],
) {
  const { error } = await client.rpc("set_organization_solutions", {
    p_organization_id: organizationId,
    p_solution_ids: solutionIds,
  });
  if (error) throw error;
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
  pricing_type: "basic" | "addon";
  price_note: string;
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
    pricingType?: "basic" | "addon";
    priceNote?: string;
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
    p_pricing_type: input.pricingType ?? "basic",
    p_price_note: input.priceNote ?? "",
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
  const raw = errorText(error);
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
    ORGANIZATION_NAME_TAKEN: "Ya existe una organización con ese nombre. Usa uno distinto.",
    ORGANIZATION_HAS_NO_OWNER:
      "Esta organización no tiene propietario activo. Asígnale uno en Ajustes antes de invitar gente.",
    ACCOUNT_DISABLED: "Esa cuenta está desactivada. Reactívala antes de continuar.",
    NOT_ALLOWED: "Tu rol no permite hacer ese cambio en el equipo.",
    NOT_ORGANIZATION_MEMBER: "No perteneces a esta organización.",
    CANNOT_CHANGE_SELF: "No puedes cambiar tu propio rol ni quitarte a ti mismo.",
    USER_IS_PRIMARY_OWNER:
      "Es propietaria de una organización que tiene más miembros. Traspasa esa propiedad antes de darla de baja, para no dejar al resto del equipo sin dueño.",
    USER_OWNS_SOLO_ORGS:
      "Es propietaria de organizaciones donde es la única integrante. Confirma para desactivarlas junto con su cuenta.",
    INVITATION_NOT_FOUND: "Esa invitación ya no existe.",
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

/** Agrega directamente a alguien que ya tiene cuenta, sin invitación. */
export async function adminAddMember(
  client: SupabaseClient,
  organizationId: string,
  email: string,
  role: string,
) {
  const { error } = await client.rpc("admin_add_member", {
    p_organization_id: organizationId,
    p_email: email,
    p_role: role,
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

// ── Edición de planes ───────────────────────────────────────────────

export const CURRENCY_OPTIONS = ["MXN", "COP", "USD"] as const;

export type AdminPlanDetailed = {
  id: string;
  name: string;
  description: string;
  tagline: string;
  priceLabel: string;
  priceDisplay: string;
  priceAmountCents: number | null;
  currency: string;
  billingInterval: "month" | "year";
  basicQuota: number | null;
  selfServe: boolean;
  sortOrder: number;
  organizations: number;
};

export type AdminPlanFeature = {
  key: string;
  name: string;
  unit: string;
  enabled: boolean;
  limitValue: number | null;
  isSolution: boolean;
};

export async function adminListPlansDetailed(client: SupabaseClient) {
  const { data, error } = await client.rpc("admin_list_plans_detailed");
  if (error) throw error;
  return (data ?? []) as AdminPlanDetailed[];
}

export async function adminUpsertPlan(
  client: SupabaseClient,
  input: {
    id: string;
    name: string;
    description: string;
    tagline: string;
    priceLabel: string;
    basicQuota: number | null;
    selfServe: boolean;
    sortOrder: number;
    priceAmountCents: number | null;
    currency: string;
    billingInterval: "month" | "year";
  },
) {
  const { error } = await client.rpc("admin_upsert_plan", {
    p_id: input.id,
    p_name: input.name,
    p_description: input.description,
    p_tagline: input.tagline,
    p_price_label: input.priceLabel,
    p_basic_quota: input.basicQuota,
    p_is_self_serve: input.selfServe,
    p_sort_order: input.sortOrder,
    p_price_amount_cents: input.priceAmountCents,
    p_currency: input.currency,
    p_billing_interval: input.billingInterval,
  });
  if (error) throw error;
}

export async function adminDeletePlan(client: SupabaseClient, id: string) {
  const { error } = await client.rpc("admin_delete_plan", { p_id: id });
  if (error) throw error;
}

export async function adminGetPlanFeatures(client: SupabaseClient, planId: string) {
  const { data, error } = await client.rpc("admin_get_plan_features", { p_plan_id: planId });
  if (error) throw error;
  return (data ?? []) as AdminPlanFeature[];
}

export async function adminSetPlanFeature(
  client: SupabaseClient,
  planId: string,
  featureKey: string,
  enabled: boolean,
  limitValue: number | null,
) {
  const { error } = await client.rpc("admin_set_plan_feature", {
    p_plan_id: planId,
    p_feature_key: featureKey,
    p_enabled: enabled,
    p_limit_value: limitValue,
  });
  if (error) throw error;
}

export async function adminGetOrganizationSolutions(client: SupabaseClient, organizationId: string) {
  const { data, error } = await client.rpc("admin_get_organization_solutions", {
    p_organization_id: organizationId,
  });
  if (error) throw error;
  return data as {
    quota: number | null;
    selected: string[];
    catalog: { id: string; name: string; pricingType: string }[];
  };
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

export type InvitationPreview = {
  email: string;
  role: string;
  organizationName: string;
  expiresAt: string;
};

/**
 * Datos mínimos de una invitación vigente, legibles sin sesión con el token.
 * Devuelve `undefined` si la función todavía no existe en la base, para que
 * la pantalla pueda caer al flujo antiguo en vez de romperse.
 */
export async function getInvitationPreview(client: SupabaseClient, token: string) {
  const { data, error } = await client.rpc("get_invitation_preview", { p_token: token });
  if (error) {
    if (error.code === "PGRST202") return undefined;
    throw error;
  }
  return (data ?? null) as InvitationPreview | null;
}

/**
 * Crea la cuenta de una persona invitada. A diferencia del registro
 * normal, NO crea una organización: la persona entra a la que la invitó.
 */
export async function signUpFromInvitation(
  client: SupabaseClient,
  params: { fullName: string; email: string; password: string },
) {
  const { fullName, email, password } = params;

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: typeof window !== "undefined" ? window.location.href : undefined,
    },
  });

  if (error) throw error;
  return { needsEmailConfirmation: !data.session };
}

// ── Equipo, desde el panel del cliente ──────────────────────────────

export type OrgTeamMember = {
  userId: string;
  email: string | null;
  fullName: string;
  role: string;
  status: string;
  isPrimaryOwner: boolean;
  isSelf: boolean;
  joinedAt: string | null;
};

export type OrgTeam = {
  canManage: boolean;
  canInvite: boolean;
  userLimit: number | null;
  activeCount: number;
  members: OrgTeamMember[];
  invitations: { id: string; email: string; role: string; token: string; expiresAt: string }[];
};

export async function orgListTeam(client: SupabaseClient, organizationId: string) {
  const { data, error } = await client.rpc("org_list_team", { p_organization_id: organizationId });
  if (error) throw error;
  return data as OrgTeam;
}

export async function orgAddMember(
  client: SupabaseClient,
  organizationId: string,
  email: string,
  role: string,
) {
  const { error } = await client.rpc("org_add_member", {
    p_organization_id: organizationId,
    p_email: email,
    p_role: role,
  });
  if (error) throw error;
}

export async function orgSetMemberRole(
  client: SupabaseClient,
  organizationId: string,
  userId: string,
  role: string,
) {
  const { error } = await client.rpc("org_set_member_role", {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw error;
}

export async function orgSetMemberStatus(
  client: SupabaseClient,
  organizationId: string,
  userId: string,
  status: "active" | "suspended" | "removed",
) {
  const { error } = await client.rpc("org_set_member_status", {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_status: status,
  });
  if (error) throw error;
}

export async function orgCreateInvitation(
  client: SupabaseClient,
  organizationId: string,
  email: string,
  role: string,
) {
  const { data, error } = await client.rpc("org_create_invitation", {
    p_organization_id: organizationId,
    p_email: email,
    p_role: role,
  });
  if (error) throw error;
  return data as { id: string; token: string; email: string };
}

export async function orgRevokeInvitation(client: SupabaseClient, invitationId: string) {
  const { error } = await client.rpc("org_revoke_invitation", { p_invitation_id: invitationId });
  if (error) throw error;
}

/**
 * Desvincula al usuario de todo y desactiva su perfil.
 * `closeSoloOrgs` autoriza además desactivar las organizaciones donde
 * era el único miembro; sin eso, la función se niega y avisa.
 */
export async function adminPurgeUser(
  client: SupabaseClient,
  userId: string,
  closeSoloOrgs = false,
) {
  const { data, error } = await client.rpc("admin_purge_user", {
    p_user_id: userId,
    p_close_solo_orgs: closeSoloOrgs,
  });
  if (error) throw error;
  return data as { membresias: number; organizacionesDesactivadas: number };
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
