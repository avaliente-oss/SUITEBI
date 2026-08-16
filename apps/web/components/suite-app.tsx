"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Blocks,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Code2,
  Command,
  Database,
  ExternalLink,
  FileBarChart,
  GalleryHorizontalEnd,
  Grid2X2,
  Headphones,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquareText,
  PanelLeftClose,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import {
  authorizeSolution,
  completePendingOrganizationSetup,
  getSupabaseBrowserClient,
  isSupabaseConfigured,
  loadViewerContext,
  signUpWithOrganization,
} from "@/lib/supabase";
import {
  demoViewer,
  formatRole,
  news,
  solutions,
  type Solution,
  type SolutionId,
  type ViewerContext,
} from "@/lib/suite-data";

type AppPhase = "loading" | "signed_out" | "signed_in";

const solutionIcons = {
  chart: BarChart3,
  database: Database,
  sparkles: Sparkles,
  bell: Bell,
  file: FileBarChart,
  code: Code2,
};

const accessReasons: Record<string, string> = {
  FEATURE_NOT_INCLUDED: "Esta solución no está incluida en el plan actual.",
  ROLE_NOT_ALLOWED: "Tu rol no permite abrir esta solución.",
  SUBSCRIPTION_INACTIVE: "La suscripción de la organización no está activa.",
  ORGANIZATION_INACTIVE: "La organización se encuentra inactiva.",
  MEMBERSHIP_INACTIVE: "Tu membresía no está activa.",
  WORKSPACE_NOT_ALLOWED: "No tienes acceso al espacio de trabajo solicitado.",
};

export function SuiteApp() {
  const [phase, setPhase] = useState<AppPhase>(isSupabaseConfigured ? "loading" : "signed_out");
  const [viewer, setViewer] = useState<ViewerContext | null>(null);
  const [authError, setAuthError] = useState("");
  const [isDemo, setIsDemo] = useState(false);
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    if (!supabase) return;

    let active = true;

    const hydrate = async () => {
      try {
        await completePendingOrganizationSetup(supabase);
        const context = await loadViewerContext(supabase);
        if (!active) return;
        setViewer(context);
        setPhase("signed_in");
        setAuthError("");
      } catch (error) {
        if (!active) return;
        setViewer(null);
        setPhase("signed_out");
        setAuthError(error instanceof Error ? error.message : "No pudimos cargar tu cuenta.");
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) hydrate();
      else setPhase("signed_out");
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session) hydrate();
      else {
        setViewer(null);
        setPhase("signed_out");
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  async function refreshViewer() {
    if (!supabase) return;
    setPhase("loading");
    try {
      await completePendingOrganizationSetup(supabase);
      setViewer(await loadViewerContext(supabase));
      setPhase("signed_in");
      setAuthError("");
    } catch (error) {
      setPhase("signed_out");
      setAuthError(error instanceof Error ? error.message : "No pudimos cargar tu cuenta.");
    }
  }

  function enterDemo() {
    setViewer(demoViewer);
    setIsDemo(true);
    setPhase("signed_in");
  }

  async function signOut() {
    if (!isDemo && supabase) await supabase.auth.signOut();
    setViewer(null);
    setIsDemo(false);
    setPhase("signed_out");
  }

  if (phase === "loading") return <LoadingScreen />;

  if (phase === "signed_out" || !viewer) {
    return (
      <LoginScreen
        error={authError}
        onAuthenticated={refreshViewer}
        onDemo={enterDemo}
      />
    );
  }

  return <SuiteLobby viewer={viewer} isDemo={isDemo} onSignOut={signOut} />;
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <BrandMark />
      <div className="loading-orbit" aria-label="Cargando tu suite">
        <span />
      </div>
      <p>Preparando tu centro de control</p>
    </main>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-mark ${compact ? "is-compact" : ""}`} aria-label="DAVALSY Solutions">
      <Image
        className="brand-logo-full"
        src="/davalsy-logo.png"
        alt="DAVALSY Solutions"
        width={418}
        height={94}
        priority
      />
      <Image
        className="brand-logo-icon"
        src="/davalsy-icon.png"
        alt=""
        width={256}
        height={256}
        priority
      />
    </div>
  );
}

function LoginScreen({
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

function SuiteLobby({
  viewer,
  isDemo,
  onSignOut,
}: {
  viewer: ViewerContext;
  isDemo: boolean;
  onSignOut: () => Promise<void>;
}) {
  const [organizationId, setOrganizationId] = useState(viewer.organizations[0]?.id ?? "");
  const [activeSolutions, setActiveSolutions] = useState<SolutionId[]>(["command"]);
  const [focusedSolution, setFocusedSolution] = useState<SolutionId>("command");
  const [workspaceMode, setWorkspaceMode] = useState<"focus" | "split">("focus");
  const [toast, setToast] = useState("");
  const [opening, setOpening] = useState<SolutionId | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [navView, setNavView] = useState<"lobby" | "workspace" | "solutions">("lobby");
  const organization =
    viewer.organizations.find((item) => item.id === organizationId) ?? viewer.organizations[0];

  function goToView(view: "lobby" | "workspace" | "solutions") {
    setNavView(view);
    setMobileNav(false);
    const targetId =
      view === "lobby" ? "welcome-row" : view === "workspace" ? "active-workspace" : "solutions-section";
    document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!organization) {
    return <EmptyOrganization viewer={viewer} onSignOut={onSignOut} />;
  }

  const availableCount = solutions.filter((solution) =>
    organization.enabledFeatures.includes(solution.featureKey),
  ).length;

  async function openSolution(solution: Solution) {
    if (!organization.enabledFeatures.includes(solution.featureKey)) {
      setToast(`${solution.name} no está incluido en el plan ${organization.planName}.`);
      return;
    }

    setOpening(solution.id);
    try {
      if (!isDemo) {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) throw new Error("Supabase no está configurado.");
        const decision = await authorizeSolution(
          supabase,
          organization.id,
          solution.action,
          solution.featureKey,
        );
        if (!decision.allowed) {
          setToast(accessReasons[decision.reason_code] ?? "No tienes acceso a esta solución.");
          return;
        }
      }

      setActiveSolutions((current) =>
        current.includes(solution.id) ? current : [...current, solution.id],
      );
      setFocusedSolution(solution.id);
      setToast(`${solution.name} ya está lista en tu mesa de trabajo.`);
      goToView("workspace");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "No pudimos abrir la solución.");
    } finally {
      setOpening(null);
    }
  }

  function closeSolution(solutionId: SolutionId) {
    setActiveSolutions((current) => {
      const next = current.filter((id) => id !== solutionId);
      if (solutionId === focusedSolution && next.length) setFocusedSolution(next[0]);
      return next;
    });
  }

  return (
    <main className="suite-shell">
      <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
        <div className="sidebar-head">
          <BrandMark compact />
          <button className="close-mobile" onClick={() => setMobileNav(false)} aria-label="Cerrar menú"><X size={19} /></button>
        </div>

        <nav className="primary-nav" aria-label="Navegación principal">
          <span className="nav-label">ESPACIO</span>
          <button
            className={navView === "lobby" ? "active" : ""}
            onClick={() => goToView("lobby")}
          >
            <LayoutDashboard size={18} /> Lobby <span>⌘1</span>
          </button>
          <button
            className={navView === "workspace" ? "active" : ""}
            onClick={() => goToView("workspace")}
          >
            <GalleryHorizontalEnd size={18} /> Mesa activa <b>{activeSolutions.length}</b>
          </button>
          <button
            className={navView === "solutions" ? "active" : ""}
            onClick={() => goToView("solutions")}
          >
            <Blocks size={18} /> Todas las soluciones
          </button>

          <span className="nav-label second">ORGANIZACIÓN</span>
          <button><MessageSquareText size={18} /> Noticias DAVALSY <i /></button>
          <button><BookOpen size={18} /> Recursos</button>
          <button><ShieldCheck size={18} /> Equipo y accesos</button>
        </nav>

        <div className="sidebar-support">
          <button><Headphones size={17} /> Centro de ayuda</button>
          <button><CircleHelp size={17} /> Hablar con DAVALSY</button>
        </div>

        <div className="sidebar-profile">
          <Avatar viewer={viewer} />
          <div><strong>{viewer.fullName}</strong><span>{formatRole(organization.role)}</span></div>
          <button onClick={onSignOut} title="Cerrar sesión" aria-label="Cerrar sesión"><LogOut size={17} /></button>
        </div>
      </aside>

      <section className="suite-main">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Abrir menú"><Menu size={21} /></button>
          <div className="organization-picker">
            <span className="org-monogram">{organization.name.charAt(0)}</span>
            <div><small>ORGANIZACIÓN</small><strong>{organization.name}</strong></div>
            {viewer.organizations.length > 1 && (
              <select
                aria-label="Cambiar organización"
                value={organization.id}
                onChange={(event) => {
                  setOrganizationId(event.target.value);
                  setActiveSolutions([]);
                }}
              >
                {viewer.organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            )}
            <ChevronDown size={16} />
          </div>

          <button className="command-search"><Search size={17} /><span>Buscar en la suite</span><kbd>⌘ K</kbd></button>

          <div className="topbar-actions">
            {isDemo && <span className="demo-badge">MODO DEMO</span>}
            <button aria-label="Notificaciones" className="icon-button"><Bell size={19} /><i /></button>
            <Avatar viewer={viewer} small />
          </div>
        </header>

        <div className="dashboard-content">
          <section className="welcome-row" id="welcome-row">
            <div>
              <span className="today-label"><i /> VIERNES · 15 AGOSTO</span>
              <h1>Tu negocio está en movimiento.</h1>
              <p>Estas son las soluciones listas para trabajar contigo hoy.</p>
            </div>
            <div className="plan-card">
              <span className="plan-icon"><Zap size={17} /></span>
              <div><small>PLAN ACTUAL</small><strong>{organization.planName}</strong></div>
              <span className={`status-chip status-${organization.accessStatus}`}>{organization.accessStatus === "trial" ? "Prueba" : "Activo"}</span>
              <button>Administrar</button>
            </div>
          </section>

          <section className="pulse-strip">
            <div className="pulse-intro"><span><Command size={17} /></span><div><small>PULSO DAVALSY</small><strong>Todo bajo control</strong></div></div>
            <div className="pulse-stat"><small>SOLUCIONES ACTIVAS</small><strong>{availableCount}<span> / {solutions.length}</span></strong></div>
            <div className="pulse-stat"><small>ÚLTIMA ACTUALIZACIÓN</small><strong>Hace 8 min</strong></div>
            <div className="pulse-stat positive"><small>ESTADO DE DATOS</small><strong><i /> Saludable</strong></div>
            <button><ExternalLink size={15} /> Ver actividad</button>
          </section>

          <div className="dashboard-grid">
            <section className="solutions-section" id="solutions-section">
              <div className="section-heading">
                <div><span className="section-kicker">TU SUITE</span><h2>Soluciones disponibles</h2></div>
                <button>Ver catálogo <ArrowRight size={16} /></button>
              </div>
              <div className="solution-grid">
                {solutions.map((solution, index) => (
                  <SolutionCard
                    key={solution.id}
                    solution={solution}
                    enabled={organization.enabledFeatures.includes(solution.featureKey)}
                    open={activeSolutions.includes(solution.id)}
                    opening={opening === solution.id}
                    index={index}
                    onOpen={() => openSolution(solution)}
                  />
                ))}
              </div>
            </section>

            <aside className="news-panel">
              <div className="section-heading compact">
                <div><span className="section-kicker">AL DÍA</span><h2>Noticias DAVALSY</h2></div>
                <button aria-label="Ver todas las noticias"><ArrowRight size={17} /></button>
              </div>
              <article className="featured-news">
                <div className="news-visual"><span>NUEVO</span><Sparkles size={31} /><b>AI</b></div>
                <div className="news-copy"><span>DESTACADO · 3 MIN</span><h3>La inteligencia que explica, no sólo predice.</h3><p>Conoce la nueva generación de análisis DAVALSY.</p><button>Descubrir más <ArrowRight size={15} /></button></div>
              </article>
              <div className="news-list">
                {news.map((item) => (
                  <article key={item.title}>
                    <time><strong>{item.date.split(" ")[0]}</strong><span>{item.date.split(" ")[1]}</span></time>
                    <div><span className={`news-tag ${item.tone}`}>{item.tag}</span><h3>{item.title}</h3><p>{item.excerpt}</p></div>
                  </article>
                ))}
              </div>
              <button className="all-news">Ver todas las novedades <ArrowRight size={16} /></button>
            </aside>
          </div>

          <ActiveWorkspace
            activeSolutions={activeSolutions}
            focusedSolution={focusedSolution}
            mode={workspaceMode}
            onFocus={setFocusedSolution}
            onClose={closeSolution}
            onMode={setWorkspaceMode}
          />
        </div>
      </section>

      {toast && <div className="toast"><span><Check size={16} /></span>{toast}<button onClick={() => setToast("")} aria-label="Cerrar aviso"><X size={15} /></button></div>}
    </main>
  );
}

function SolutionCard({
  solution,
  enabled,
  open,
  opening,
  index,
  onOpen,
}: {
  solution: Solution;
  enabled: boolean;
  open: boolean;
  opening: boolean;
  index: number;
  onOpen: () => void;
}) {
  const Icon = solutionIcons[solution.icon];

  return (
    <article className={`solution-card accent-${solution.accent} ${!enabled ? "is-locked" : ""}`} style={{ animationDelay: `${index * 70}ms` }}>
      <div className="solution-card-top">
        <span className="solution-icon"><Icon size={22} /></span>
        {open ? <span className="open-chip"><i /> ABIERTA</span> : enabled ? <span className="included-chip">INCLUIDA</span> : <span className="locked-chip"><LockKeyhole size={12} /> BLOQUEADA</span>}
      </div>
      <span className="solution-eyebrow">{solution.eyebrow}</span>
      <h3>{solution.name}</h3>
      <p>{solution.description}</p>
      <div className="solution-metric"><strong>{solution.metric}</strong><span>{solution.metricLabel}</span></div>
      <button onClick={onOpen} disabled={opening}>
        {opening ? <LoaderCircle className="spin" size={16} /> : enabled ? (open ? "Ir a la solución" : "Abrir solución") : "Ver opciones"}
        {!opening && (enabled ? <ArrowRight size={16} /> : <LockKeyhole size={15} />)}
      </button>
    </article>
  );
}

function ActiveWorkspace({
  activeSolutions,
  focusedSolution,
  mode,
  onFocus,
  onClose,
  onMode,
}: {
  activeSolutions: SolutionId[];
  focusedSolution: SolutionId;
  mode: "focus" | "split";
  onFocus: (id: SolutionId) => void;
  onClose: (id: SolutionId) => void;
  onMode: (mode: "focus" | "split") => void;
}) {
  const opened = activeSolutions
    .map((id) => solutions.find((solution) => solution.id === id))
    .filter(Boolean) as Solution[];
  const visible = mode === "split" ? opened : opened.filter((item) => item.id === focusedSolution);

  return (
    <section className="active-workspace" id="active-workspace">
      <div className="workspace-heading">
        <div><span className="section-kicker">MULTITAREA</span><h2>Tu mesa activa</h2><p>Abre y combina soluciones sin perder el contexto.</p></div>
        <div className="workspace-controls">
          <button className={mode === "focus" ? "active" : ""} onClick={() => onMode("focus")}><PanelLeftClose size={16} /> Enfoque</button>
          <button className={mode === "split" ? "active" : ""} onClick={() => onMode("split")}><Grid2X2 size={16} /> Mosaico</button>
        </div>
      </div>

      {!opened.length ? (
        <div className="workspace-empty"><span><Plus size={23} /></span><h3>Tu mesa está lista.</h3><p>Abre una solución para comenzar a trabajar.</p></div>
      ) : (
        <>
          <div className="workspace-tabs">
            {opened.map((solution) => {
              const Icon = solutionIcons[solution.icon];
              return (
                <div key={solution.id} className={focusedSolution === solution.id ? "active" : ""}>
                  <button onClick={() => onFocus(solution.id)}>
                    <Icon size={15} /> {solution.name}
                  </button>
                  <button onClick={() => onClose(solution.id)} aria-label={`Cerrar ${solution.name}`}><X size={13} /></button>
                </div>
              );
            })}
          </div>
          <div className={`workspace-canvas mode-${mode}`}>
            {visible.map((solution) => <SolutionWorkspace key={solution.id} solution={solution} />)}
          </div>
        </>
      )}
    </section>
  );
}

function SolutionWorkspace({ solution }: { solution: Solution }) {
  const Icon = solutionIcons[solution.icon];
  const bars = solution.id === "forecast" ? [34, 48, 43, 58, 61, 72, 78, 86] : [41, 55, 49, 64, 60, 74, 68, 88];

  return (
    <article className={`workspace-app accent-${solution.accent}`}>
      <header><div><span><Icon size={18} /></span><div><small>{solution.eyebrow}</small><strong>{solution.name}</strong></div></div><button><ExternalLink size={15} /> Pantalla completa</button></header>
      <div className="workspace-app-body">
        <div className="mini-kpis">
          <div><small>RESULTADO</small><strong>{solution.metric}</strong><span>vs. periodo anterior</span></div>
          <div><small>SEÑAL</small><strong>Positiva</strong><span className="up">+6.2% esta semana</span></div>
        </div>
        <div className="mini-chart">
          <div className="chart-title"><div><small>TENDENCIA</small><strong>Últimos 8 periodos</strong></div><span>Actualizado ahora</span></div>
          <div className="bars">{bars.map((height, index) => <i key={index} style={{ height: `${height}%` }}><b /></i>)}</div>
        </div>
        <div className="insight-note"><Sparkles size={17} /><div><small>LECTURA DAVALSY</small><p>El desempeño mantiene una trayectoria positiva. Revisa el segmento norte para capturar la oportunidad detectada.</p></div><ArrowRight size={16} /></div>
      </div>
    </article>
  );
}

function Avatar({ viewer, small = false }: { viewer: ViewerContext; small?: boolean }) {
  const initials = viewer.fullName.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return (
    <span className={`avatar ${small ? "small" : ""}`}>
      {viewer.avatarUrl ? (
        <span className="avatar-image" style={{ backgroundImage: `url(${viewer.avatarUrl})` }} />
      ) : initials}
    </span>
  );
}

function EmptyOrganization({ viewer, onSignOut }: { viewer: ViewerContext; onSignOut: () => Promise<void> }) {
  return (
    <main className="empty-org-screen">
      <BrandMark />
      <div><span><ShieldCheck size={25} /></span><h1>Tu cuenta está lista.</h1><p>{viewer.email} todavía no pertenece a una organización activa. Pide al administrador que te envíe una invitación.</p><button onClick={onSignOut}>Cerrar sesión</button></div>
    </main>
  );
}
