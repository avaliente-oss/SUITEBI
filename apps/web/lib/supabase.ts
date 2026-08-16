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
