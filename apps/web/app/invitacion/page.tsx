"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";
import {
  errorText,
  acceptInvitation,
  getInvitationPreview,
  getSupabaseBrowserClient,
  signUpFromInvitation,
  type InvitationPreview,
} from "@/lib/supabase";
import { BrandMark, LoadingScreen } from "@/components/suite-ui";
import { formatRole } from "@/lib/suite-data";

/** "register" = falta crear la cuenta · "ready" = sólo falta aceptar. */
type Status = "checking" | "register" | "ready" | "done" | "error";

const errorMessages: Record<string, string> = {
  INVITATION_NOT_FOUND: "Esta invitación ya no existe o ya fue usada.",
  INVITATION_EXPIRED: "Esta invitación venció. Pide una nueva a tu contacto en DAVALSY.",
  INVITATION_EMAIL_MISMATCH:
    "Esta invitación es para otro correo. Cierra sesión y entra con el correo al que te la enviaron.",
  INVITATION_TOKEN_REQUIRED: "El enlace está incompleto.",
  UNAUTHENTICATED: "Necesitas iniciar sesión para aceptar la invitación.",
  ACCOUNT_DISABLED: "Tu cuenta está desactivada. Pide a DAVALSY que la reactive.",
  ORGANIZATION_HAS_NO_OWNER:
    "Esa organización todavía no tiene propietario, así que no puede recibir miembros. Avísale a DAVALSY.",
  USER_QUOTA_EXCEEDED:
    "La organización llegó al máximo de usuarios de su plan. Pide que suban el plan antes de aceptar.",
  USERS_FEATURE_NOT_ENABLED: "Esa organización no tiene habilitada la gestión de usuarios.",
};

function describe(error: unknown) {
  const raw = errorText(error);
  for (const [code, message] of Object.entries(errorMessages)) {
    if (raw.includes(code)) return message;
  }
  if (raw.toLowerCase().includes("already registered")) {
    return "Ese correo ya tiene cuenta. Inicia sesión y vuelve a abrir este enlace.";
  }
  return raw || "No pudimos completar la invitación.";
}

function InvitationFlow() {
  const supabase = getSupabaseBrowserClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [status, setStatus] = useState<Status>(supabase && token ? "checking" : "error");
  const [error, setError] = useState(token ? "" : "El enlace no trae un código de invitación.");
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase || !token) return;
    let active = true;

    (async () => {
      try {
        const [{ data: sessionData }, preview] = await Promise.all([
          supabase.auth.getSession(),
          getInvitationPreview(supabase, token),
        ]);
        if (!active) return;

        // undefined = la función de previsualización aún no existe en la
        // base. Se cae al flujo anterior: con sesión se puede aceptar
        // igual, y sin ella se pide iniciar sesión.
        if (preview === undefined) {
          if (sessionData.session) {
            setStatus("ready");
          } else {
            setStatus("error");
            setError(
              "Inicia sesión con el correo al que te enviaron la invitación y vuelve a abrir este enlace.",
            );
          }
          return;
        }

        if (!preview) {
          setError("Esta invitación ya no es válida o venció. Pide una nueva a tu contacto en DAVALSY.");
          setStatus("error");
          return;
        }

        setInvitation(preview);
        // Con sesión abierta sólo falta aceptar; sin ella, se crea la cuenta aquí.
        setStatus(sessionData.session ? "ready" : "register");
      } catch (loadError) {
        if (!active) return;
        setError(describe(loadError));
        setStatus("error");
      }
    })();

    return () => {
      active = false;
    };
  }, [supabase, token]);

  async function accept() {
    if (!supabase) return;

    setError("");
    setBusy(true);
    try {
      await acceptInvitation(supabase, token);
      setStatus("done");
      window.setTimeout(() => router.replace("/lobby"), 1500);
    } catch (acceptError) {
      setError(describe(acceptError));
    } finally {
      setBusy(false);
    }
  }

  async function registerAndAccept(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !invitation) return;

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    setError("");
    setBusy(true);
    try {
      const { needsEmailConfirmation } = await signUpFromInvitation(supabase, {
        fullName,
        email: invitation.email,
        password,
      });

      if (needsEmailConfirmation) {
        setStatus("error");
        setError(
          "Te enviamos un correo para confirmar tu cuenta. Confírmalo y vuelve a abrir este mismo enlace para entrar a la organización.",
        );
        return;
      }

      await acceptInvitation(supabase, token);
      setStatus("done");
      window.setTimeout(() => router.replace("/lobby"), 1500);
    } catch (signupError) {
      setError(describe(signupError));
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking") return <LoadingScreen />;

  return (
    <main className="login-access" style={{ minHeight: "100vh" }}>
      <div className="login-card">
        <div className="mobile-brand"><BrandMark compact /></div>
        <span className="step-label">INVITACIÓN</span>

        {invitation && (status === "register" || status === "ready") && (
          <>
            <h2>Te invitaron a {invitation.organizationName}.</h2>
            <p className="login-intro">
              Entrarás como <strong>{formatRole(invitation.role)}</strong> con el correo{" "}
              <strong>{invitation.email}</strong>.
            </p>
          </>
        )}

        {status === "register" && invitation && (
          <form onSubmit={registerAndAccept}>
            <label htmlFor="invite-name">Tu nombre completo</label>
            <input
              id="invite-name"
              type="text"
              autoComplete="name"
              placeholder="Tu nombre y apellido"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
            />

            <label htmlFor="invite-password" style={{ marginTop: 14 }}>Crea tu contraseña</label>
            <input
              id="invite-password"
              type="password"
              autoComplete="new-password"
              placeholder="Mínimo 8 caracteres"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
            />

            {error && <p className="auth-message is-error">{error}</p>}

            <button className="primary-login" type="submit" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={18} /> : null}
              Crear cuenta y entrar
              {!busy ? <ArrowRight size={18} /> : null}
            </button>

            <p className="signup-hint">
              ¿Ya tienes cuenta? <Link href="/">Inicia sesión</Link> y vuelve a abrir este enlace.
            </p>
          </form>
        )}

        {status === "ready" && invitation && (
          <>
            {error && <p className="auth-message is-error">{error}</p>}
            <button className="primary-login" type="button" onClick={accept} disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={18} /> : null}
              Aceptar invitación
              {!busy ? <ArrowRight size={18} /> : null}
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
            <h2>No pudimos completar la invitación.</h2>
            <p className="auth-message is-error">{error}</p>
            <Link href="/" className="primary-login" style={{ textDecoration: "none" }}>
              Ir al inicio de sesión <ArrowRight size={18} />
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
