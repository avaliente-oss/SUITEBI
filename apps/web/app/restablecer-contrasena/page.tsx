"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { describeAuthError, getSupabaseBrowserClient, updatePassword } from "@/lib/supabase";
import { BrandMark, LoadingScreen } from "@/components/suite-ui";

type LinkStatus = "checking" | "ready" | "invalid" | "done";

export default function ResetPasswordPage() {
  const supabase = getSupabaseBrowserClient();
  const router = useRouter();
  const [status, setStatus] = useState<LinkStatus>(supabase ? "checking" : "invalid");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;

    let active = true;

    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY") setStatus("ready");
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) {
        setStatus((current) => (current === "checking" ? "ready" : current));
      } else {
        window.setTimeout(() => {
          if (active) setStatus((current) => (current === "checking" ? "invalid" : current));
        }, 2500);
      }
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabase]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (!supabase) return;

    setBusy(true);
    try {
      await updatePassword(supabase, password);
      setStatus("done");
      window.setTimeout(() => router.replace("/lobby"), 1500);
    } catch (submitError) {
      setError(describeAuthError(submitError));
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking") return <LoadingScreen />;

  return (
    <main className="login-access" style={{ minHeight: "100vh" }}>
      <div className="login-card">
        <div className="mobile-brand"><BrandMark compact /></div>
        <span className="step-label">RECUPERAR ACCESO</span>

        {status === "invalid" && (
          <>
            <h2>Este enlace ya no es válido.</h2>
            <p className="login-intro">
              Puede que haya vencido o que ya se haya usado. Pide uno nuevo desde la pantalla de acceso.
            </p>
            <Link href="/" className="primary-login" style={{ textDecoration: "none" }}>
              Volver al inicio de sesión <ArrowRight size={18} />
            </Link>
          </>
        )}

        {status === "ready" && (
          <>
            <h2>Elige tu nueva contraseña.</h2>
            <p className="login-intro">Mínimo 8 caracteres. Después de guardarla, entras directo a tu suite.</p>

            <form onSubmit={submit}>
              <label htmlFor="reset-password">Nueva contraseña</label>
              <input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                placeholder="Mínimo 8 caracteres"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
              />

              <label htmlFor="reset-password-confirm" style={{ marginTop: 14 }}>Confirmar contraseña</label>
              <input
                id="reset-password-confirm"
                type="password"
                autoComplete="new-password"
                placeholder="Repite la contraseña"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
                minLength={8}
              />

              {error && <p className="auth-message is-error">{error}</p>}

              <button className="primary-login" type="submit" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={18} /> : null}
                Guardar y entrar
                {!busy ? <ArrowRight size={18} /> : null}
              </button>
            </form>
          </>
        )}

        {status === "done" && (
          <>
            <h2>Listo.</h2>
            <p className="login-intro">Tu contraseña se actualizó. Entrando a tu suite…</p>
          </>
        )}

        <div className="trust-line"><LockKeyhole size={14} /> Sesión cifrada y controlada por permisos</div>
      </div>
    </main>
  );
}
