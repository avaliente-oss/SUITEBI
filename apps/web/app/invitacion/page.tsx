"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { acceptInvitation, getSupabaseBrowserClient } from "@/lib/supabase";
import { BrandMark, LoadingScreen } from "@/components/suite-ui";

type Status = "checking" | "needs_login" | "ready" | "accepting" | "done" | "error";

const errorMessages: Record<string, string> = {
  INVITATION_NOT_FOUND: "Esta invitación ya no existe o ya fue usada.",
  INVITATION_EXPIRED: "Esta invitación venció. Pide una nueva a tu contacto en DAVALSY.",
  INVITATION_EMAIL_MISMATCH:
    "Esta invitación es para otro correo. Inicia sesión con el correo al que te la enviaron.",
  INVITATION_TOKEN_REQUIRED: "El enlace está incompleto.",
  UNAUTHENTICATED: "Necesitas iniciar sesión para aceptar la invitación.",
};

function describe(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  for (const [code, message] of Object.entries(errorMessages)) {
    if (raw.includes(code)) return message;
  }
  return raw || "No pudimos aceptar la invitación.";
}

function InvitationFlow() {
  const supabase = getSupabaseBrowserClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [status, setStatus] = useState<Status>(supabase && token ? "checking" : "error");
  const [error, setError] = useState(token ? "" : "El enlace no trae un código de invitación.");

  useEffect(() => {
    if (!supabase || !token) return;

    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setStatus(data.session ? "ready" : "needs_login");
    });

    return () => {
      active = false;
    };
  }, [supabase, token]);

  async function accept() {
    if (!supabase) return;

    setError("");
    setStatus("accepting");
    try {
      await acceptInvitation(supabase, token);
      setStatus("done");
      window.setTimeout(() => router.replace("/lobby"), 1500);
    } catch (acceptError) {
      setError(describe(acceptError));
      setStatus("error");
    }
  }

  if (status === "checking") return <LoadingScreen />;

  return (
    <main className="login-access" style={{ minHeight: "100vh" }}>
      <div className="login-card">
        <div className="mobile-brand"><BrandMark compact /></div>
        <span className="step-label">INVITACIÓN</span>

        {status === "needs_login" && (
          <>
            <h2>Inicia sesión para aceptar.</h2>
            <p className="login-intro">
              Entra (o crea tu cuenta) con el mismo correo al que te enviaron la invitación y vuelve a abrir
              este enlace.
            </p>
            <Link href="/" className="primary-login" style={{ textDecoration: "none" }}>
              Ir al inicio de sesión <ArrowRight size={18} />
            </Link>
          </>
        )}

        {(status === "ready" || status === "accepting") && (
          <>
            <h2>Te invitaron a una organización.</h2>
            <p className="login-intro">
              Al aceptar, esta organización aparecerá en tu suite con los permisos que te asignaron.
            </p>
            <button className="primary-login" type="button" onClick={accept} disabled={status === "accepting"}>
              {status === "accepting" ? <LoaderCircle className="spin" size={18} /> : null}
              Aceptar invitación
              {status !== "accepting" ? <ArrowRight size={18} /> : null}
            </button>
          </>
        )}

        {status === "done" && (
          <>
            <h2>Listo.</h2>
            <p className="login-intro">Ya formas parte de la organización. Entrando a tu suite…</p>
          </>
        )}

        {status === "error" && (
          <>
            <h2>No pudimos aceptar la invitación.</h2>
            <p className="auth-message is-error">{error}</p>
            <Link href="/" className="primary-login" style={{ textDecoration: "none" }}>
              Volver al inicio <ArrowRight size={18} />
            </Link>
          </>
        )}

        <div className="trust-line"><LockKeyhole size={14} /> Sesión cifrada y controlada por permisos</div>
      </div>
    </main>
  );
}

export default function InvitationPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <InvitationFlow />
    </Suspense>
  );
}
