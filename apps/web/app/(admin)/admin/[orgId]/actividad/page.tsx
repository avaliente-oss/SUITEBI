"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  adminListOrganizations,
  describeAdminError,
  getSupabaseBrowserClient,
  orgAuditLog,
  orgUsageSummary,
  type AdminOrganizationSummary,
  type AuditEntry,
  type UsageSummary,
} from "@/lib/supabase";
import { UsagePanel } from "@/components/usage-panel";
import { AuditLog } from "@/components/audit-log";

const PERIODOS = [7, 30, 90];

export default function AdminOrganizationActivityPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = use(params);

  const [organization, setOrganization] = useState<AdminOrganizationSummary | null>(null);
  const [dias, setDias] = useState(30);
  const [uso, setUso] = useState<UsageSummary | null>(null);
  const [auditoria, setAuditoria] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    let cancelado = false;

    Promise.all([
      adminListOrganizations(supabase),
      orgUsageSummary(supabase, orgId, dias),
      orgAuditLog(supabase, orgId, 80),
    ])
      .then(([orgs, datos, registro]) => {
        if (cancelado) return;
        setOrganization(orgs.find((o) => o.id === orgId) ?? null);
        setUso(datos);
        setAuditoria(registro);
      })
      .catch((err) => {
        if (!cancelado) setError(describeAdminError(err));
      });

    return () => {
      cancelado = true;
    };
  }, [orgId, dias]);

  return (
    <div className="admin-page">
      <Link href="/admin" className="admin-back-link"><ArrowLeft size={15} /> Todas las organizaciones</Link>

      <div className="admin-page-head">
        <span className="section-kicker">DAVALSY / ADMIN</span>
        <h1>{organization?.name ?? "Organización"}</h1>
        <p>Qué tanto usan la Suite y qué se ha cambiado en su cuenta.</p>
      </div>

      <nav className="admin-tabs">
        <Link href={`/admin/${orgId}`}>Permisos</Link>
        <Link href={`/admin/${orgId}/miembros`}>Miembros</Link>
        <Link href={`/admin/${orgId}/ajustes`}>Ajustes</Link>
        <Link href={`/admin/${orgId}/actividad`} className="active">Actividad</Link>
      </nav>

      {error && <p className="auth-message is-error">{error}</p>}

      <div className="uso-periodos">
        {PERIODOS.map((d) => (
          <button key={d} className={dias === d ? "active" : ""} onClick={() => setDias(d)}>
            {d} días
          </button>
        ))}
      </div>

      {!uso && !error && <p className="admin-loading">Cargando…</p>}
      {uso && <UsagePanel datos={uso} />}

      {auditoria && (
        <>
          <h2 className="admin-section-title">Auditoría</h2>
          <p className="admin-section-note">
            Todo cambio sobre esta organización, hecho por su equipo o por DAVALSY.
          </p>
          <AuditLog entradas={auditoria} />
        </>
      )}
    </div>
  );
}
