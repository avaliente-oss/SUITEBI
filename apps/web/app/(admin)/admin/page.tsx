"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";
import { getSupabaseBrowserClient, adminListOrganizations, type AdminOrganizationSummary } from "@/lib/supabase";

export default function AdminOrganizationsPage() {
  const [organizations, setOrganizations] = useState<AdminOrganizationSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    adminListOrganizations(supabase)
      .then(setOrganizations)
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos cargar las organizaciones."));
  }, []);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <span className="section-kicker">DAVALSY / ADMIN</span>
        <h1>Organizaciones</h1>
        <p>Todas las organizaciones de la Suite. Entra a una para ver o forzar sus features.</p>
      </div>

      {error && <p className="auth-message is-error">{error}</p>}

      {!organizations && !error && <p className="admin-loading">Cargando…</p>}

      {organizations && (
        <div className="admin-table">
          <div className="admin-table-head">
            <span>Organización</span>
            <span>Plan</span>
            <span>Estado</span>
            <span>Miembros</span>
            <span>Excepciones</span>
            <span />
          </div>
          {organizations.map((org) => (
            <Link key={org.id} href={`/admin/${org.id}`} className="admin-table-row">
              <span className="admin-org-name"><Building2 size={16} /> {org.name}</span>
              <span>{org.plan_name}</span>
              <span className={`status-chip status-${org.access_status}`}>{org.access_status}</span>
              <span>{org.member_count}</span>
              <span>{org.override_count > 0 ? `${org.override_count} activas` : "—"}</span>
              <span className="admin-row-arrow"><ArrowRight size={16} /></span>
            </Link>
          ))}
          {organizations.length === 0 && <p className="admin-loading">Todavía no hay organizaciones.</p>}
        </div>
      )}
    </div>
  );
}
