"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle, Zap } from "lucide-react";
import { useSuite } from "@/lib/suite-context";
import {
  getOrganizationSolutions,
  getSupabaseBrowserClient,
  listPublicPlans,
  setOrganizationSolutions,
  type PublicPlan,
} from "@/lib/supabase";

export default function PlanPage() {
  const { organization, solutions, setToast, isDemo } = useSuite();

  const [plans, setPlans] = useState<PublicPlan[]>([]);
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
    Promise.all([listPublicPlans(supabase), getOrganizationSolutions(supabase, organization.id)])
      .then(([planList, current]) => {
        if (cancelled) return;
        setPlans(planList);
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
  }, [organization.id, isDemo]);

  function toggle(id: string) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (quota !== null && current.length >= quota) return [...current.slice(1), id];
      return [...current, id];
    });
  }

  async function save() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setSaving(true);
    try {
      await setOrganizationSolutions(supabase, organization.id, selected);
      setToast("Listo. Recarga para ver tus soluciones actualizadas.");
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
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
                <h2>Planes disponibles</h2>
                <p>El cambio de plan todavía se hace con un asesor: aún no hay cobro en línea.</p>
              </div>
            </div>
            <div className="plan-picker">
              {plans.map((plan) => (
                <div key={plan.id} className={`plan-option ${plan.id === organization.planId ? "active" : ""}`}>
                  <span className="plan-option-top">
                    <strong>{plan.name}</strong>
                    <em>{plan.priceLabel}</em>
                  </span>
                  <span className="plan-option-note">{plan.tagline || plan.description}</span>
                  {plan.id !== organization.planId && (
                    <button
                      type="button"
                      className="addon-request"
                      onClick={() =>
                        setToast(
                          plan.selfServe
                            ? `Escríbenos para cambiar al plan ${plan.name}.`
                            : `Un asesor te contactará para armar tu plan ${plan.name}.`,
                        )
                      }
                    >
                      {plan.selfServe ? "Cambiar a este plan" : "Hablar con DAVALSY"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}
