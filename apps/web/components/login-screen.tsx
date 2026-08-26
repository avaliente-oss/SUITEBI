"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
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
  requestPasswordReset,
  signUpWithOrganization,
  listPublicPlans,
  listBasicSolutions,
  checkOrganizationName,
  describeAuthError,
  COUNTRY_OPTIONS,
  type BillingInterval,
  type PublicPlan,
  type BasicSolution,
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
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [basicSolutions, setBasicSolutions] = useState<BasicSolution[]>([]);
  const [country, setCountry] = useState("CO");
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");
  const [planId, setPlanId] = useState("free");
  const [selectedSolutions, setSelectedSolutions] = useState<string[]>([]);
  const [nameTaken, setNameTaken] = useState(false);
  const [similarNames, setSimilarNames] = useState<string[]>([]);
  const [checkingName, setCheckingName] = useState(false);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState(error);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const submitLockRef = useRef(false);

  // El catálogo comercial (planes y soluciones básicas) es público: se
  // carga sin sesión para poder elegir plan durante el registro.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    // El país entra en la consulta: cada uno tiene su propio precio.
    Promise.all([listPublicPlans(supabase, country, billingInterval), listBasicSolutions(supabase)])
      .then(([planList, solutionList]) => {
        if (cancelled) return;
        setPlans(planList);
        setBasicSolutions(solutionList);
      })
      .catch(() => {
        /* Sin catálogo, el registro sigue funcionando con el plan por defecto. */
      });

    return () => {
      cancelled = true;
    };
  }, [supabase, country, billingInterval]);

  const activePlan = plans.find((plan) => plan.id === planId) ?? null;
  const quota = activePlan?.basicQuota ?? null;
  const needsSolutionPick = Boolean(activePlan?.selfServe && quota && basicSolutions.length > 0);

  function toggleSolution(id: string) {
    setSelectedSolutions((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (quota !== null && current.length >= quota) {
        // Al llegar al cupo, la nueva elección reemplaza a la más antigua.
        return [...current.slice(1), id];
      }
      return [...current, id];
    });
  }

  // Se consulta al salir del campo, no en cada tecla: una llamada por
  // nombre escrito en vez de una por letra.
  async function validateOrganizationName() {
    const value = organizationName.trim();
    if (!supabase || value.length < 2) {
      setNameTaken(false);
      setSimilarNames([]);
      return;
    }

    setCheckingName(true);
    try {
      const result = await checkOrganizationName(supabase, value);
      if (!result) return;
      setNameTaken(!result.available);
      setSimilarNames(result.similar ?? []);
    } finally {
      setCheckingName(false);
    }
  }

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
          options: {
            emailRedirectTo: `${window.location.origin}/lobby`,
            // Sin esto, Supabase crearía una cuenta para cualquier correo
            // que se escriba aquí: usuarios fantasma sin organización.
            shouldCreateUser: false,
          },
        });
        if (magicError) throw magicError;
        setMessage(
          "Te enviamos un enlace seguro. Revisa tu correo — el enlace sirve una sola vez y vence pronto.",
        );
      } else {
        const { error: passwordError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (passwordError) throw passwordError;
        await onAuthenticated();
      }
    } catch (submitError) {
      setFormError(describeAuthError(submitError));
    } finally {
      setBusy(false);
      submitLockRef.current = false;
    }
  }

  async function submitForgotPassword() {
    if (!supabase || forgotBusy) return;

    setFormError("");
    setMessage("");

    if (!email.trim()) {
      setFormError("Escribe tu correo arriba y dale clic de nuevo a \"¿La olvidaste?\".");
      return;
    }

    setForgotBusy(true);
    try {
      await requestPasswordReset(supabase, email.trim());
      setMessage("Si ese correo tiene cuenta, te enviamos un enlace para restablecer tu contraseña.");
    } catch (resetError) {
      setFormError(
        describeAuthError(resetError),
      );
    } finally {
      setForgotBusy(false);
    }
  }

  async function submitSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || submitLockRef.current) return;

    if (signupPassword.length < 8) {
      setFormError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    if (needsSolutionPick && selectedSolutions.length === 0) {
      setFormError("Elige al menos una solución para tu plan.");
      return;
    }

    // Última verificación por si no pasó por el evento de salida del campo.
    if (supabase) {
      const check = await checkOrganizationName(supabase, organizationName.trim());
      if (check && !check.available) {
        setNameTaken(true);
        setFormError("Ya existe una organización con ese nombre. Elige otro o inicia sesión.");
        return;
      }
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
        planId,
        solutionIds: selectedSolutions,
        country,
        billingInterval,
      });

      if (needsEmailConfirmation) {
        setScreen("login");
        setFormError("");
        setMessage(
          "Te enviamos un correo para confirmar tu cuenta. Confírmalo y luego inicia sesión: tu organización se creará automáticamente.",
        );
      } else if (activePlan && !activePlan.selfServe) {
        setScreen("login");
        setMessage(
          "Tu cuenta quedó creada y en revisión. Un asesor de DAVALSY te contactará para activar tu plan Enterprise.",
        );
      } else {
        await onAuthenticated();
      }
    } catch (submitError) {
      setFormError(describeAuthError(submitError));
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
                      <button type="button" className="text-action" onClick={submitForgotPassword} disabled={forgotBusy}>
                        {forgotBusy ? "Enviando..." : "¿La olvidaste?"}
                      </button>
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
                  onChange={(event) => {
                    setOrganizationName(event.target.value);
                    setNameTaken(false);
                    setSimilarNames([]);
                  }}
                  onBlur={validateOrganizationName}
                  required
                  disabled={!isSupabaseConfigured}
                  aria-invalid={nameTaken}
                />
              </div>

              {checkingName && <p className="signup-hint">Verificando el nombre…</p>}

              {nameTaken && (
                <p className="auth-message is-error">
                  Ya existe una organización con ese nombre. Si es la tuya,{" "}
                  <button type="button" className="inline-link" onClick={() => switchScreen("login")}>
                    inicia sesión
                  </button>{" "}
                  en vez de crear otra.
                </p>
              )}

              {!nameTaken && similarNames.length > 0 && (
                <p className="auth-message is-warning">
                  ¿Seguro que no te has registrado ya? Existe{" "}
                  {similarNames.length === 1 ? "una organización parecida" : "organizaciones parecidas"}:{" "}
                  <strong>{similarNames.slice(0, 3).join(", ")}</strong>.{" "}
                  <button type="button" className="inline-link" onClick={() => switchScreen("login")}>
                    Iniciar sesión
                  </button>
                </p>
              )}

              <label htmlFor="signup-country">País de tu organización</label>
              <select
                id="signup-country"
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                disabled={!isSupabaseConfigured}
              >
                {COUNTRY_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>{option.name}</option>
                ))}
              </select>

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

              {plans.length > 0 && (
                <>
                  <span className="signup-section-label">
                    Elige tu plan
                    <span className="interval-switch">
                      <button
                        type="button"
                        className={billingInterval === "month" ? "active" : ""}
                        onClick={() => setBillingInterval("month")}
                      >
                        Mensual
                      </button>
                      <button
                        type="button"
                        className={billingInterval === "year" ? "active" : ""}
                        onClick={() => setBillingInterval("year")}
                      >
                        Anual
                      </button>
                    </span>
                  </span>
                  <div className="plan-picker">
                    {plans.map((plan) => (
                      <button
                        type="button"
                        key={plan.id}
                        className={`plan-option ${planId === plan.id ? "active" : ""}`}
                        onClick={() => {
                          setPlanId(plan.id);
                          setSelectedSolutions([]);
                        }}
                      >
                        <span className="plan-option-top">
                          <strong>{plan.name}</strong>
                          <em>{plan.priceLabel}</em>
                        </span>
                        <span className="plan-option-note">{plan.tagline || plan.description}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {needsSolutionPick && (
                <>
                  <span className="signup-section-label">
                    {quota === 1
                      ? "Elige la solución que quieres usar"
                      : `Elige hasta ${quota} soluciones`}
                    <em>{selectedSolutions.length} de {quota}</em>
                  </span>
                  <div className="solution-picker">
                    {basicSolutions.map((solution) => (
                      <button
                        type="button"
                        key={solution.id}
                        className={`solution-option ${selectedSolutions.includes(solution.id) ? "active" : ""}`}
                        onClick={() => toggleSolution(solution.id)}
                      >
                        <span className="solution-option-check">
                          {selectedSolutions.includes(solution.id) && <Check size={13} />}
                        </span>
                        <span>
                          <strong>{solution.name}</strong>
                          <small>{solution.eyebrow}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="signup-hint">Podrás cambiar tu elección después desde Plan y facturación.</p>
                </>
              )}

              {activePlan && !activePlan.selfServe && (
                <p className="signup-hint">
                  Creamos tu cuenta y un asesor de DAVALSY te contacta para configurar tu plan a la medida.
                  Mientras tanto, tu organización queda en revisión.
                </p>
              )}

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
