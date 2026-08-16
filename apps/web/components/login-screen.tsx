"use client";

import { FormEvent, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
  signUpWithOrganization,
} from "@/lib/supabase";
import { BrandMark } from "@/components/suite-ui";

export function LoginScreen({
  error,
  onAuthenticated,
  onDemo,
}: {
  error: string;
  onAuthenticated: () => Promise<void>;
  onDemo: () => void;
}) {
  const supabase = getSupabaseBrowserClient();
  const [screen, setScreen] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState(error);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const submitLockRef = useRef(false);

  function switchScreen(next: "login" | "signup") {
    setScreen(next);
    setFormError("");
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || submitLockRef.current) return;
    submitLockRef.current = true;

    setBusy(true);
    setFormError("");
    setMessage("");

    try {
      if (mode === "magic") {
        const { error: magicError } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin },
        });
        if (magicError) throw magicError;
        setMessage("Te enviamos un enlace seguro. Revisa tu correo para entrar.");
      } else {
        const { error: passwordError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (passwordError) throw passwordError;
        await onAuthenticated();
      }
    } catch (submitError) {
      setFormError(
        submitError instanceof Error ? submitError.message : "No pudimos iniciar tu sesión.",
      );
    } finally {
      setBusy(false);
      submitLockRef.current = false;
    }
  }

  async function submitSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || submitLockRef.current) return;

    if (signupPassword.length < 8) {
      setFormError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    submitLockRef.current = true;
    setBusy(true);
    setFormError("");
    setMessage("");

    try {
      const { needsEmailConfirmation } = await signUpWithOrganization(supabase, {
        fullName,
        organizationName,
        email: signupEmail,
        password: signupPassword,
      });

      if (needsEmailConfirmation) {
        setScreen("login");
        setFormError("");
        setMessage(
          "Te enviamos un correo para confirmar tu cuenta. Confírmalo y luego inicia sesión: tu organización se creará automáticamente.",
        );
      } else {
        await onAuthenticated();
      }
    } catch (submitError) {
      setFormError(
        submitError instanceof Error ? submitError.message : "No pudimos crear tu cuenta.",
      );
    } finally {
      setBusy(false);
      submitLockRef.current = false;
    }
  }

  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="login-story-top">
          <BrandMark />
          <span className="secure-pill"><ShieldCheck size={15} /> Acceso protegido</span>
        </div>

        <div className="login-statement">
          <span className="overline">TU NEGOCIO, EN UN SOLO LUGAR</span>
          <h1>Decide con claridad.<br /><em>Opera sin fricción.</em></h1>
          <p>
            Tus datos, soluciones y equipos trabajando juntos en una experiencia creada para avanzar.
          </p>
        </div>

        <div className="login-preview" aria-hidden="true">
          <div className="preview-head">
            <span>Panorama de hoy</span>
            <span className="live-dot">EN VIVO</span>
          </div>
          <div className="preview-metrics">
            <div><small>VENTAS</small><strong>$2.84M</strong><span>+18.4%</span></div>
            <div><small>EFICIENCIA</small><strong>94.2%</strong><span>+3.1%</span></div>
            <div><small>SEÑALES</small><strong>03</strong><span className="warning">Revisar</span></div>
          </div>
          <div className="preview-chart">
            {[38, 45, 41, 56, 52, 65, 62, 78, 74, 88, 84, 96].map((height, index) => (
              <i key={index} style={{ height: `${height}%` }} />
            ))}
          </div>
        </div>

        <p className="login-footnote">Diseñado por DAVALSY Solutions · Monterrey, México</p>
      </section>

      <section className="login-access">
        <div className="login-card">
          <div className="mobile-brand"><BrandMark compact /></div>
          <span className="step-label">ACCESO A LA SUITE</span>
          <h2>{screen === "login" ? "Qué bueno verte." : "Crea tu cuenta."}</h2>
          <p className="login-intro">
            {screen === "login"
              ? "Ingresa con la cuenta vinculada a tu organización."
              : "Crea tu cuenta y tu organización para empezar a trabajar hoy mismo."}
          </p>

          <div className="auth-tabs" role="tablist" aria-label="Pantalla de acceso">
            <button
              type="button"
              className={screen === "login" ? "active" : ""}
              onClick={() => switchScreen("login")}
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              className={screen === "signup" ? "active" : ""}
              onClick={() => switchScreen("signup")}
            >
              Crear cuenta
            </button>
          </div>

          {screen === "login" && (
            <>
              <div className="auth-tabs" role="tablist" aria-label="Método de acceso">
                <button
                  type="button"
                  className={mode === "password" ? "active" : ""}
                  onClick={() => setMode("password")}
                >
                  Contraseña
                </button>
                <button
                  type="button"
                  className={mode === "magic" ? "active" : ""}
                  onClick={() => setMode("magic")}
                >
                  Enlace seguro
                </button>
              </div>

              <form onSubmit={submit}>
                <label htmlFor="email">Correo de trabajo</label>
                <div className="input-wrap">
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="nombre@empresa.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    disabled={!isSupabaseConfigured}
                  />
                  <Check size={17} />
                </div>

                {mode === "password" && (
                  <>
                    <div className="label-row">
                      <label htmlFor="password">Contraseña</label>
                      <button type="button" className="text-action">¿La olvidaste?</button>
                    </div>
                    <input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="Tu contraseña"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      disabled={!isSupabaseConfigured}
                    />
                  </>
                )}

                {(formError || message) && (
                  <p className={`auth-message ${formError ? "is-error" : ""}`}>
                    {formError || message}
                  </p>
                )}

                <button className="primary-login" type="submit" disabled={busy || !isSupabaseConfigured}>
                  {busy ? <LoaderCircle className="spin" size={18} /> : null}
                  {mode === "password" ? "Entrar a mi suite" : "Enviar enlace de acceso"}
                  {!busy ? <ArrowRight size={18} /> : null}
                </button>
              </form>
            </>
          )}

          {screen === "signup" && (
            <form onSubmit={submitSignup}>
              <label htmlFor="full-name">Nombre completo</label>
              <div className="input-wrap">
                <input
                  id="full-name"
                  type="text"
                  autoComplete="name"
                  placeholder="Tu nombre y apellido"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                  disabled={!isSupabaseConfigured}
                />
              </div>

              <label htmlFor="organization-name">Nombre de tu organización</label>
              <div className="input-wrap">
                <input
                  id="organization-name"
                  type="text"
                  autoComplete="organization"
                  placeholder="Ej. Mi Empresa SA de CV"
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                  required
                  disabled={!isSupabaseConfigured}
                />
              </div>

              <label htmlFor="signup-email">Correo de trabajo</label>
              <div className="input-wrap">
                <input
                  id="signup-email"
                  type="email"
                  autoComplete="email"
                  placeholder="nombre@empresa.com"
                  value={signupEmail}
                  onChange={(event) => setSignupEmail(event.target.value)}
                  required
                  disabled={!isSupabaseConfigured}
                />
                <Check size={17} />
              </div>

              <label htmlFor="signup-password">Contraseña</label>
              <input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                placeholder="Mínimo 8 caracteres"
                value={signupPassword}
                onChange={(event) => setSignupPassword(event.target.value)}
                required
                minLength={8}
                disabled={!isSupabaseConfigured}
              />

              {(formError || message) && (
                <p className={`auth-message ${formError ? "is-error" : ""}`}>
                  {formError || message}
                </p>
              )}

              <button className="primary-login" type="submit" disabled={busy || !isSupabaseConfigured}>
                {busy ? <LoaderCircle className="spin" size={18} /> : null}
                Crear mi cuenta
                {!busy ? <ArrowRight size={18} /> : null}
              </button>
            </form>
          )}

          {!isSupabaseConfigured && (
            <div className="demo-access">
              <div className="demo-divider"><span>VISTA PREVIA</span></div>
              <p>La conexión real se activa al agregar las llaves públicas de Supabase.</p>
              <button type="button" onClick={onDemo}>
                Explorar lobby de demostración <ArrowRight size={17} />
              </button>
            </div>
          )}

          <div className="trust-line"><LockKeyhole size={14} /> Sesión cifrada y controlada por permisos</div>
        </div>
      </section>
    </main>
  );
}
