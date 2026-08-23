"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
import {
  getSupabaseBrowserClient,
  adminListOrganizations,
  adminGetOrganizationFeatures,
  adminSetFeatureOverride,
  adminClearFeatureOverride,
  type AdminOrganizationSummary,
  type AdminOrganizationFeature,
} from "@/lib/supabase";

export default function AdminOrganizationDetailPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);

  const [organization, setOrganization] = useState<AdminOrganizationSummary | null>(null);
  const [features, setFeatures] = useState<AdminOrganizationFeature[] | null>(null);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function load() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    try {
      const [organizations, featureList] = await Promise.all([
        adminListOrganizations(supabase),
        adminGetOrganizationFeatures(supabase, orgId),
      ]);
      setOrganization(organizations.find((org) => org.id === orgId) ?? null);
      setFeatures(featureList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar esta organización.");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() reruns on demand after admin actions, not only on mount
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function setOverride(featureKey: string, enabled: boolean) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setBusyKey(featureKey);
    try {
      await adminSetFeatureOverride(supabase, orgId, featureKey, enabled);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar la excepción.");
    } finally {
      setBusyKey(null);
    }
  }

  async function clearOverride(featureKey: string) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setBusyKey(featureKey);
    try {
      await adminClearFeatureOverride(supabase, orgId, featureKey);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos quitar la excepción.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="admin-page">
      <Link href="/admin" className="admin-back-link"><ArrowLeft size={15} /> Todas las organizaciones</Link>

      <div className="admin-page-head">
        <span className="section-kicker">DAVALSY / ADMIN</span>
        <h1>{organization?.name ?? "Organización"}</h1>
        <p>
          {organization
            ? `Plan ${organization.plan_name} · ${organization.access_status}`
            : "Excepciones de feature encima de su plan actual."}
        </p>
      </div>

      <nav className="admin-tabs">
        <Link href={`/admin/${orgId}`} className="active">Permisos</Link>
        <Link href={`/admin/${orgId}/miembros`}>Miembros</Link>
        <Link href={`/admin/${orgId}/ajustes`}>Ajustes</Link>
      </nav>

      {error && <p className="auth-message is-error">{error}</p>}

      {!features && !error && <p className="admin-loading">Cargando…</p>}

      {features && (
        <div className="admin-feature-list">
          {features.map((feature) => {
            const hasOverride = feature.override_enabled !== null;
            const busy = busyKey === feature.key;

            return (
              <div key={feature.key} className="admin-feature-row">
                <div>
                  <strong>{feature.name}</strong>
                  <span className="admin-feature-key">{feature.key}</span>
                  {feature.description && <p>{feature.description}</p>}
                </div>

                <div className="admin-feature-status">
                  <span className={`status-chip ${feature.plan_enabled ? "status-full" : ""}`}>
                    Plan: {feature.plan_enabled ? "incluido" : "no incluido"}
                  </span>
                  {hasOverride && (
                    <span className={`status-chip ${feature.override_enabled ? "status-full" : "status-trial"}`}>
                      Excepción: {feature.override_enabled ? "forzado ON" : "forzado OFF"}
                    </span>
                  )}
                  <span className={`status-chip ${feature.effective ? "status-full" : ""}`}>
                    Efectivo: {feature.effective ? "activo" : "inactivo"}
                  </span>
                </div>

                <div className="admin-feature-actions">
                  <button
                    type="button"
                    disabled={busy}
                    className={feature.override_enabled === true ? "active" : ""}
                    onClick={() => setOverride(feature.key, true)}
                  >
                    Forzar ON
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={feature.override_enabled === false ? "active" : ""}
                    onClick={() => setOverride(feature.key, false)}
                  >
                    Forzar OFF
                  </button>
                  {hasOverride && (
                    <button type="button" disabled={busy} onClick={() => clearOverride(feature.key)} title="Quitar excepción, volver al plan">
                      <RotateCcw size={13} /> Quitar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
