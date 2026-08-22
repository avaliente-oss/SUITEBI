"use client";

import Image from "next/image";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Boxes,
  Database,
  FileText,
  Globe,
  Grid2X2,
  LoaderCircle,
  LockKeyhole,
  PanelLeftClose,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  X,
} from "lucide-react";
import { type Solution, type SolutionId, type ViewerContext } from "@/lib/suite-data";

export const solutionIcons = {
  boxes: Boxes,
  chart: BarChart3,
  users: Users,
  database: Database,
  sparkles: Sparkles,
  bell: Bell,
  file: FileText,
  globe: Globe,
  settings: Settings,
  truck: Truck,
};

export function LoadingScreen() {
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

export function BrandMark({ compact = false }: { compact?: boolean }) {
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

export function Avatar({ viewer, small = false }: { viewer: ViewerContext; small?: boolean }) {
  const initials = viewer.fullName.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return (
    <span className={`avatar ${small ? "small" : ""}`}>
      {viewer.avatarUrl ? (
        <span className="avatar-image" style={{ backgroundImage: `url(${viewer.avatarUrl})` }} />
      ) : initials}
    </span>
  );
}

export function EmptyOrganization({ viewer, onSignOut }: { viewer: ViewerContext; onSignOut: () => Promise<void> }) {
  return (
    <main className="empty-org-screen">
      <BrandMark />
      <div>
        <span><ShieldCheck size={25} /></span>
        <h1>Tu cuenta está lista.</h1>
        <p>{viewer.email} todavía no pertenece a una organización activa. Pide al administrador que te envíe una invitación.</p>
        <button onClick={onSignOut}>Cerrar sesión</button>
      </div>
    </main>
  );
}

export function SolutionCard({
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
    <article className={`solution-card ${!enabled ? "is-locked" : ""}`} style={{ animationDelay: `${index * 70}ms` }}>
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

export function ActiveWorkspace({
  solutions,
  activeSolutions,
  focusedSolution,
  mode,
  onFocus,
  onClose,
  onMode,
}: {
  solutions: Solution[];
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
        <div className="workspace-empty"><span><Plus size={23} /></span><h3>Tu mesa está lista.</h3><p>Abre una solución desde el catálogo para comenzar a trabajar.</p></div>
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

/**
 * Contenedor de una solución dentro de la mesa activa.
 *
 * La mesa está dormida a propósito: hoy todas las soluciones del catálogo
 * viven fuera de la Suite y se abren por puente de sesión, así que nunca
 * llegan aquí. Se conserva el armazón para cuando exista una solución que
 * sí corra dentro de la Suite; lo que se quitó fue la maqueta con datos
 * inventados que se pintaba en su lugar.
 */
export function SolutionWorkspace({ solution }: { solution: Solution }) {
  const Icon = solutionIcons[solution.icon];

  return (
    <article className="workspace-app">
      <header>
        <div>
          <span><Icon size={18} /></span>
          <div><small>{solution.eyebrow}</small><strong>{solution.name}</strong></div>
        </div>
      </header>
      <div className="workspace-app-body">
        <div className="workspace-placeholder">
          <p>Esta solución todavía no tiene una vista integrada dentro de la Suite.</p>
        </div>
      </div>
    </article>
  );
}
