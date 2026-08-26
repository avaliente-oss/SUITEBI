"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle, Zap } from "lucide-react";
import { useSuite } from "@/lib/suite-context";
import {
  errorText,
  describeAdminError,
  describePlanBlock,
  getOrganizationSolutions,
  getSupabaseBrowserClient,
  orgChangePlan,
  orgPlanChangePreview,
  setOrganizationSolutions,
  type BillingInterval,
  type PlanChangePreview,
} from "@/lib/supabase";

export default function PlanPage() {
  const { organization, solutions, setToast, isDemo } = useSuite();

  const [preview, setPreview] = useState<PlanChangePreview | null>(null);
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [changing, setChanging] = useState<string | null>(null);
  const [quota, setQuota] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  // En modo demo no hay nada que traer, así que arranca ya cargado.
  const [loaded, setLoaded] = useState(isDemo);
  const [saving, setSaving] = useState(false);

  const basicSolutions = solutions.filter((solution) => (solution.pricingType ?? "basic") === "basic");
  const addonSolutions = solutions.filter((solution) => solution.pricingType === "addon");

  useEffect(() => {
    if (isDemo) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    let cancelled = false;
    Promise.all([
      orgPlanChangePreview(supabase, organization.id, interval),
      getOrganizationSolutions(supabase, organization.id),
    ])
      .then(([planPreview, current]) => {
        if (cancelled) return;
        setPreview(planPreview);
        setQuota(current.quota);
        setSelected(current.selected);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [organization.id, isDemo, interval]);

  function toggle(id: string) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (quota !== null && current.length >= quota) return [...current.slice(1), id];
      return [...current, id];
    });
  }

  async function changePlan(planId: string, planName: string) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    if (!window.confirm(`¿Cambiar al plan ${planName}? Tu acceso se ajusta de inmediato.`)) return;

    setChanging(planId);
    try {
      const result = await orgChangePlan(supabase, organization.id, planId, interval);
      const recortadas = result?.solucionesRecortadas ?? 0;
      setToast(
        recortadas > 0
          ? `Listo, ahora estás en ${planName}. Se quitaron ${recortadas} ${recortadas === 1 ? "solución que ya no cabía" : "soluciones que ya no cabían"} en tu cupo.`
          : `Listo, ahora estás en ${planName}. Recarga para ver los cambios.`,
      );
      // Se recargan cupo y selección, que pudieron cambiar con el plan.
      const [nuevoPreview, actuales] = await Promise.all([
        orgPlanChangePreview(supabase, organization.id, interval),
        getOrganizationSolutions(supabase, organization.id),
      ]);
      setPreview(nuevoPreview);
      setQuota(actuales.quota);
      setSelected(actuales.selected);
    } catch (error) {
      setToast(describeAdminError(error));
    } finally {
      setChanging(null);
    }
  }

  async function save() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setSaving(true);
    try {
      await setOrganizationSolutions(supabase, organization.id, selected);
      setToast("Listo. Recarga para ver tus soluciones actualizadas.");
    } catch (error) {
      const raw = errorText(error);
      setToast(
        raw.includes("NOT_ALLOWED")
          ? "Sólo el propietario de la organización puede cambiar las soluciones contratadas."
          : raw.includes("QUOTA_EXCEEDED")
            ? "Elegiste más soluciones de las que incluye tu plan."
            : "No pudimos guardar tu selección.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="welcome-row" id="welcome-row">
        <div>
          <span className="today-label"><i /> FACTURACIÓN</span>
          <h1>Plan y facturación.</h1>
          <p>Tu plan actual, las soluciones que incluye y cómo cambiarlas.</p>
        </div>
        <div className="plan-card">
          <span className="plan-icon"><Zap size={17} /></span>
          <div><small>PLAN ACTUAL</small><strong>{organization.planName}</strong></div>
          <span className={`status-chip status-${organization.accessStatus}`}>
            {organization.accessStatus === "trial" ? "Prueba" : "Activo"}
          </span>
        </div>
      </section>

      {!loaded && <p className="admin-loading">Cargando…</p>}

      {loaded && (
        <>
          <section className="settings-card plan-section">
            <div className="settings-card-head">
              <div>
                <h2>Tus soluciones</h2>
                <p>
                  {quota === null
                    ? "Tu plan incluye todas las soluciones básicas."
                    : `Tu plan incluye ${quota} ${quota === 1 ? "solución básica" : "soluciones básicas"}. Elige cuáles quieres usar.`}
                </p>
              </div>
            </div>

            <div className="solution-picker">
              {basicSolutions.map((solution) => {
                const isOn = quota === null || selected.includes(solution.id);
                return (
                  <button
                    type="button"
                    key={solution.id}
                    className={`solution-option ${isOn ? "active" : ""}`}
                    disabled={quota === null}
                    onClick={() => toggle(solution.id)}
                  >
                    <span className="solution-option-check">{isOn && <Check size={13} />}</span>
                    <span>
                      <strong>{solution.name}</strong>
                      <small>{solution.eyebrow}</small>
                    </span>
                  </button>
                );
              })}
              {basicSolutions.length === 0 && (
                <p className="admin-loading">Todavía no hay soluciones básicas en el catálogo.</p>
              )}
            </div>

            {quota !== null && (
              <div className="plan-save-row">
                <span>{selected.length} de {quota} elegidas</span>
                <button className="primary-login settings-submit" type="button" onClick={save} disabled={saving}>
                  {saving ? <LoaderCircle className="spin" size={16} /> : "Guardar selección"}
                </button>
              </div>
            )}
          </section>

          {addonSolutions.length > 0 && (
            <section className="settings-card plan-section">
              <div className="settings-card-head">
                <div>
                  <h2>Soluciones que se contratan aparte</h2>
                  <p>No están incluidas en ningún plan. Se activan al contratarlas con DAVALSY.</p>
                </div>
              </div>
              <div className="solution-picker">
                {addonSolutions.map((solution) => (
                  <div key={solution.id} className="solution-option is-addon">
                    <span>
                      <strong>{solution.name}</strong>
                      <small>{solution.priceNote || solution.eyebrow}</small>
                    </span>
                    <button
                      type="button"
                      className="addon-request"
                      onClick={() => setToast(`Escríbenos para contratar ${solution.name}.`)}
                    >
                      Me interesa
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="settings-card plan-section">
            <div className="settings-card-head">
              <div>
                <h2>Cambiar de plan</h2>
                <p>
                  {preview?.canManage
                    ? "Al cambiar, tu acceso se ajusta de inmediato."
                    : "Sólo el propietario de la organización puede cambiar el plan."}
                </p>
              </div>
              <span className="interval-switch">
                <button
                  type="button"
                  className={interval === "month" ? "active" : ""}
                  onClick={() => setInterval("month")}
                >
                  Mensual
                </button>
                <button
                  type="button"
                  className={interval === "year" ? "active" : ""}
                  onClick={() => setInterval("year")}
                >
                  Anual
                </button>
              </span>
            </div>

            <div className="plan-picker">
              {preview?.plans.map((plan) => {
                const motivo = describePlanBlock(plan.blockedReason, {
                  activeMembers: preview.activeMembers,
                  userLimit: plan.userLimit,
                });

                return (
                  <div key={plan.id} className={`plan-option ${plan.isCurrent ? "active" : ""}`}>
                    <span className="plan-option-top">
                      <strong>{plan.name}</strong>
                      <em>{plan.priceLabel}</em>
                    </span>
                    <span className="plan-option-note">{plan.tagline}</span>

                    {plan.isCurrent ? (
                      <span className="status-chip status-full">Tu plan actual</span>
                    ) : motivo ? (
                      <span className="plan-blocked">{motivo}</span>
                    ) : (
                      <button
                        type="button"
                        className="addon-request"
                        disabled={!preview.canManage || changing === plan.id}
                        onClick={() => changePlan(plan.id, plan.name)}
                      >
                        {changing === plan.id ? <LoaderCircle className="spin" size={14} /> : "Cambiar a este plan"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </>
  );
}
