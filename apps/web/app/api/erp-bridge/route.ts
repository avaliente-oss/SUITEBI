import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const bridgeSecret = process.env.ERP_BRIDGE_SECRET;
const erpAppUrl = process.env.ERP_APP_URL;

type AuthorizeDecision = {
  allowed?: boolean;
  reason_code?: string;
};

export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 500 });
  }
  if (!bridgeSecret || !erpAppUrl) {
    return NextResponse.json({ error: "ERP_BRIDGE_NOT_CONFIGURED" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!accessToken) {
    return NextResponse.json({ error: "MISSING_ACCESS_TOKEN" }, { status: 401 });
  }

  let body: { organizationId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const organizationId = body.organizationId;
  if (!organizationId) {
    return NextResponse.json({ error: "MISSING_ORGANIZATION_ID" }, { status: 400 });
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

  // Re-verificamos el permiso en el servidor con el mismo motor que usa el
  // frontend: nunca confiamos en lo que el cliente diga sobre su propio acceso.
  const { data: decision, error: decisionError } = await userClient.rpc("authorize_action", {
    p_organization_id: organizationId,
    p_action: "suite.launch",
    p_workspace_id: null,
    p_resource_id: null,
    p_feature_key: "erp.access",
    p_usage_units: 0,
    p_consume_quota: false,
    p_metadata: { surface: "erp_bridge" },
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

  const secretKey = new TextEncoder().encode(bridgeSecret);
  const token = await new SignJWT({
    organization_id: organizationId,
    role: membership.role,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userData.user.id)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setIssuer("davalsy-suite")
    .setAudience("davalsy-erp")
    .sign(secretKey);

  const redirectUrl = `${erpAppUrl.replace(/\/$/, "")}/auth/callback?token=${token}`;

  return NextResponse.json({ redirectUrl });
}
