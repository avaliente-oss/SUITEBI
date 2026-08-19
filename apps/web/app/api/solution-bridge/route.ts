import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const bridgeSecret = process.env.SUITE_BRIDGE_SECRET;

type AuthorizeDecision = {
  allowed?: boolean;
  reason_code?: string;
};

type SolutionRow = {
  id: string;
  feature_key: string;
  is_external: boolean;
  external_url: string | null;
};

export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 500 });
  }
  if (!bridgeSecret) {
    return NextResponse.json({ error: "BRIDGE_NOT_CONFIGURED" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!accessToken) {
    return NextResponse.json({ error: "MISSING_ACCESS_TOKEN" }, { status: 401 });
  }

  let body: { organizationId?: string; solutionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { organizationId, solutionId } = body;
  if (!organizationId || !solutionId) {
    return NextResponse.json({ error: "MISSING_ORGANIZATION_OR_SOLUTION" }, { status: 400 });
  }

  // Cliente con el token del usuario, no una service key: todo lo que sigue
  // corre bajo RLS como ese usuario, nunca con privilegios elevados.
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return NextResponse.json({ error: "INVALID_SESSION" }, { status: 401 });
  }

  // La solución (feature_key, URL destino) sale del catálogo en base de
  // datos, no de una constante en el código: así una solución nueva
  // registrada desde el panel admin funciona sin tocar este archivo.
  const { data: solutionsList, error: solutionsError } = await userClient.rpc("list_active_solutions");
  if (solutionsError) {
    return NextResponse.json({ error: "SOLUTIONS_LOOKUP_FAILED" }, { status: 500 });
  }

  const solution = ((solutionsList ?? []) as SolutionRow[]).find((item) => item.id === solutionId);
  if (!solution || !solution.is_external || !solution.external_url) {
    return NextResponse.json({ error: "SOLUTION_NOT_BRIDGEABLE" }, { status: 404 });
  }

  // Re-verificamos el permiso en el servidor con el mismo motor que usa el
  // frontend: nunca confiamos en lo que el cliente diga sobre su propio acceso.
  const { data: decision, error: decisionError } = await userClient.rpc("authorize_action", {
    p_organization_id: organizationId,
    p_action: "suite.launch",
    p_workspace_id: null,
    p_resource_id: null,
    p_feature_key: solution.feature_key,
    p_usage_units: 0,
    p_consume_quota: false,
    p_metadata: { surface: "solution_bridge", solution_id: solutionId },
  });

  if (decisionError) {
    return NextResponse.json({ error: "AUTHORIZATION_FAILED" }, { status: 500 });
  }

  const typedDecision = decision as AuthorizeDecision | null;
  if (!typedDecision?.allowed) {
    return NextResponse.json(
      { error: typedDecision?.reason_code ?? "NOT_ALLOWED" },
      { status: 403 },
    );
  }

  const { data: membership, error: membershipError } = await userClient
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userData.user.id)
    .eq("status", "active")
    .maybeSingle();

  if (membershipError || !membership) {
    return NextResponse.json({ error: "NOT_ORGANIZATION_MEMBER" }, { status: 403 });
  }

  const { data: organization, error: organizationError } = await userClient
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();

  if (organizationError || !organization) {
    return NextResponse.json({ error: "ORGANIZATION_NOT_FOUND" }, { status: 404 });
  }

  if (!userData.user.email) {
    return NextResponse.json({ error: "USER_HAS_NO_EMAIL" }, { status: 400 });
  }

  const secretKey = new TextEncoder().encode(bridgeSecret);
  const token = await new SignJWT({
    email: userData.user.email,
    organization_id: organizationId,
    organization_name: organization.name,
    role: membership.role,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userData.user.id)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setIssuer("davalsy-suite")
    .setAudience("davalsy-erp")
    .sign(secretKey);

  const separator = solution.external_url.includes("?") ? "&" : "?";
  const redirectUrl = `${solution.external_url}${separator}token=${token}`;

  return NextResponse.json({ redirectUrl });
}
