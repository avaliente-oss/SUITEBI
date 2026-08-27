"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { useSuite } from "@/lib/suite-context";
import {
  describeAdminError,
  getSupabaseBrowserClient,
  orgAuditLog,
  orgUsageSummary,
  type AuditEntry,
  type UsageSummary,
} from "@/lib/supabase";
import { UsagePanel } from "@/components/usage-panel";
import { AuditLog } from "@/components/audit-log";

const PERIODOS = [
  { dias: 7, etiqueta: "7 días" },
  { dias: 30, etiqueta: "30 días" },
  { dias: 90, etiqueta: "90 días" },
];

export default function ActividadPage() {
  const { organization, isDemo } = useSuite();
  const [vista, setVista] = useState<"uso" | "auditoria">("uso");
  const [dias, setDias] = useState(30);
  const [uso, setUso] = useState<UsageSummary | null>(null);
  const [auditoria, setAuditoria] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");
  const [sinPermiso, setSinPermiso] = useState(false);

  useEffect(() => {
    if (isDemo) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    let cancelado = false;
    orgUsageSummary(supabase, organization.id, dias)
      .then((datos) => {
        if (!cancelado) setUso(datos);
      })
      .catch((err) => {
        if (!cancelado) setError(describeAdminError(err));
      });

    return () => {
      cancelado = true;
    };
  }, [organization.id, dias, isDemo]);

  useEffect(() => {
    if (isDemo || vista !== "auditoria" || auditoria) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    let cancelado = false;
    orgAuditLog(supabase, organization.id)
      .then((lista) => {
        if (!cancelado) setAuditoria(lista);
      })
      .catch(() => {
        // Sin permiso audit.read: se explica en vez de mostrar un error crudo.
        if (!cancelado) setSinPermiso(true);
      });

    return () => {
      cancelado = true;
    };
  }, [vista, auditoria, organization.id, isDemo]);

  return (
    <>
      <section className="welcome-row" id="welcome-row">
        <div>
          <span className="today-label"><i /> ACTIVIDAD</span>
          <h1>Cómo se está usando tu suite.</h1>
          <p>Con qué frecuencia entra tu equipo, a qué soluciones, y dónde se está topando.</p>
        </div>
        <div className="plan-card">
          <span className="plan-icon"><Activity size={17} /></span>
          <div><small>ORGANIZACIÓN</small><strong>{organization.name}</strong></div>
        </div>
      </section>

      <nav className="admin-tabs">
        <button className={vista === "uso" ? "active" : ""} onClick={() => setVista("uso")}>
          Uso
        </button>
        <button className={vista === "auditoria" ? "active" : ""} onClick={() => setVista("auditoria")}>
          Auditoría
        </button>
      </nav>

      {error && <p className="auth-message is-error">{error}</p>}

      {vista === "uso" && (
        <>
          <div className="uso-periodos">
            {PERIODOS.map((p) => (
              <button
                key={p.dias}
                className={dias === p.dias ? "active" : ""}
                onClick={() => setDias(p.dias)}
              >
                {p.etiqueta}
              </button>
            ))}
          </div>

          {!uso && !error && <p className="admin-loading">Cargando…</p>}
          {uso && <UsagePanel datos={uso} />}
        </>
      )}

      {vista === "auditoria" && (
        <>
          {sinPermiso ? (
            <p className="admin-section-note">
              Tu rol no permite ver la auditoría. Pídesela a un propietario o administrador de la
              organización.
            </p>
          ) : !auditoria ? (
            <p className="admin-loading">Cargando…</p>
          ) : (
            <>
              <p className="admin-section-note">
                Todo cambio hecho sobre esta organización, por tu equipo o por DAVALSY.
              </p>
              <AuditLog entradas={auditoria} />
            </>
          )}
        </>
      )}
    </>
  );
}
