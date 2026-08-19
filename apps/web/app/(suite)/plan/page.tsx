"use client";

import { Check, X, Zap } from "lucide-react";
import { useSuite } from "@/lib/suite-context";

type PlanFeature = { label: string; starter: string | boolean; business: string | boolean; enterprise: string | boolean };

const planFeatures: PlanFeature[] = [
  { label: "Dashboards activos", starter: "5", business: "25", enterprise: "Sin límite" },
  { label: "Usuarios por organización", starter: "3", business: "15", enterprise: "Sin límite" },
  { label: "Fuentes de datos", starter: "2", business: "10", enterprise: "Sin límite" },
  { label: "Actualizaciones diarias", starter: "1 / día", business: "8 / día", enterprise: "Sin límite" },
  { label: "Exportar dashboards", starter: false, business: true, enterprise: true },
  { label: "Alertas", starter: false, business: true, enterprise: true },
  { label: "Análisis con IA", starter: false, business: "500 / mes", enterprise: "Sin límite" },
  { label: "Marca blanca", starter: false, business: false, enterprise: true },
  { label: "Acceso a la API", starter: false, business: true, enterprise: true },
  { label: "DavOps ERP", starter: true, business: true, enterprise: true },
];

const plans = [
  { id: "starter", name: "Starter", price: "Desde $0", description: "Para equipos que están empezando a centralizar datos." },
  { id: "business", name: "Business", price: "Plan operativo", description: "Para empresas en crecimiento con varios equipos." },
  { id: "enterprise", name: "Enterprise", price: "A medida", description: "Para organizaciones corporativas con necesidades específicas." },
] as const;

export default function PlanPage() {
  const { organization, setToast } = useSuite();

  function requestPlanChange(planName: string) {
    setToast(`La facturación en línea todavía no está disponible. Escríbenos para activar ${planName}.`);
  }

  return (
    <>
      <section className="welcome-row" id="welcome-row">
        <div>
          <span className="today-label"><i /> FACTURACIÓN</span>
          <h1>Plan y facturación.</h1>
          <p>Consulta tu plan actual y compara qué incluye cada nivel de la Suite.</p>
        </div>
        <div className="plan-card">
          <span className="plan-icon"><Zap size={17} /></span>
          <div><small>PLAN ACTUAL</small><strong>{organization.planName}</strong></div>
          <span className={`status-chip status-${organization.accessStatus}`}>
            {organization.accessStatus === "trial" ? "Prueba" : organization.accessStatus === "full" ? "Activo" : organization.accessStatus}
          </span>
        </div>
      </section>

      <section className="plans-compare">
        <div className="plans-compare-head">
          <span />
          {plans.map((plan) => (
            <div key={plan.id} className="plans-compare-col-head">
              <strong>{plan.name}</strong>
              <span>{plan.price}</span>
              <p>{plan.description}</p>
              {plan.id === organization.planId ? (
                <span className="included-chip">PLAN ACTUAL</span>
              ) : (
                <button type="button" onClick={() => requestPlanChange(plan.name)}>
                  Cambiar a {plan.name}
                </button>
              )}
            </div>
          ))}
        </div>

        {planFeatures.map((feature) => (
          <div className="plans-compare-row" key={feature.label}>
            <span className="plans-compare-label">{feature.label}</span>
            {[feature.starter, feature.business, feature.enterprise].map((value, index) => (
              <span className="plans-compare-value" key={index}>
                {typeof value === "boolean" ? (
                  value ? <Check size={16} className="plans-yes" /> : <X size={16} className="plans-no" />
                ) : (
                  value
                )}
              </span>
            ))}
          </div>
        ))}
      </section>

      <p className="plans-footnote">
        La facturación en línea con tarjeta todavía no está disponible. Para cambiar de plan, escríbenos a
        soporte@davalsy.com y lo activamos manualmente mientras conectamos el pago automático.
      </p>
    </>
  );
}
