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

export async function requestErpBridgeRedirect(client: SupabaseClient, organizationId: string) {
  const { data: sessionData } = await client.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("No hay una sesión activa.");

  const response = await fetch("/api/erp-bridge", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ organizationId }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error ?? "No pudimos conectar con DavOps ERP.");
  }

  return payload as { redirectUrl: string };
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
