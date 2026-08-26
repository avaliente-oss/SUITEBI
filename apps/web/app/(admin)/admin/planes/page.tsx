"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import {
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  countryName,
  adminDeletePlanPrice,
  adminListPlanPrices,
  adminSetPlanPrice,
  adminDeletePlan,
  type AdminPlanPrice,
  adminGetPlanFeatures,
  adminListPlansDetailed,
  adminSetPlanFeature,
  adminUpsertPlan,
  describeAdminError,
  getSupabaseBrowserClient,
  type AdminPlanDetailed,
  type AdminPlanFeature,
} from "@/lib/supabase";

const emptyForm = {
  id: "",
  name: "",
  description: "",
  tagline: "",
  priceLabel: "",
  basicQuota: "" as string,
  selfServe: true,
  sortOrder: 100,
  // El monto se captura en pesos y se convierte a centavos al guardar.
  price: "" as string,
  currency: "COP",
  billingInterval: "month" as "month" | "year",
};

export default function AdminPlanesPage() {
  const [plans, setPlans] = useState<AdminPlanDetailed[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [featuresPlan, setFeaturesPlan] = useState<string | null>(null);
  const [features, setFeatures] = useState<AdminPlanFeature[] | null>(null);
  const [busyFeature, setBusyFeature] = useState<string | null>(null);

  const [pricesPlan, setPricesPlan] = useState<string | null>(null);
  const [prices, setPrices] = useState<AdminPlanPrice[] | null>(null);
  const [newPrice, setNewPrice] = useState({ country: "CO", currency: "COP", amount: "" });
  const [savingPrice, setSavingPrice] = useState(false);

  async function load() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    try {
      setPlans(await adminListPlansDetailed(supabase));
    } catch (err) {
      setError(describeAdminError(err));
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() se reutiliza tras cada acción
    load();
  }, []);

  async function openFeatures(planId: string) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    if (featuresPlan === planId) {
      setFeaturesPlan(null);
      setFeatures(null);
      return;
    }

    setFeaturesPlan(planId);
    setFeatures(null);
    try {
      setFeatures(await adminGetPlanFeatures(supabase, planId));
    } catch (err) {
      setError(describeAdminError(err));
    }
  }

  async function saveFeature(feature: AdminPlanFeature, enabled: boolean, limitValue: number | null) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !featuresPlan) return;

    setBusyFeature(feature.key);
    setError("");
    try {
      await adminSetPlanFeature(supabase, featuresPlan, feature.key, enabled, limitValue);
      setFeatures(await adminGetPlanFeatures(supabase, featuresPlan));
      setNotice("Límite actualizado.");
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setBusyFeature(null);
    }
  }

  async function openPrices(planId: string) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    if (pricesPlan === planId) {
      setPricesPlan(null);
      setPrices(null);
      return;
    }

    setPricesPlan(planId);
    setPrices(null);
    try {
      setPrices(await adminListPlanPrices(supabase, planId));
    } catch (err) {
      setError(describeAdminError(err));
    }
  }

  async function savePrice(country: string, currency: string, amount: string) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !pricesPlan) return;

    setError("");
    setSavingPrice(true);
    try {
      await adminSetPlanPrice(supabase, {
        planId: pricesPlan,
        country,
        currency,
        amountCents: Math.round(Number(amount) * 100),
      });
      setPrices(await adminListPlanPrices(supabase, pricesPlan));
      setNewPrice({ country: "CO", currency: "COP", amount: "" });
      await load();
      setNotice("Precio guardado.");
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setSavingPrice(false);
    }
  }

  async function removePrice(country: string) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !pricesPlan) return;

    setSavingPrice(true);
    try {
      await adminDeletePlanPrice(supabase, pricesPlan, country);
      setPrices(await adminListPlanPrices(supabase, pricesPlan));
      await load();
      setNotice("Precio eliminado.");
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setSavingPrice(false);
    }
  }

  function startEdit(plan: AdminPlanDetailed) {
    setEditingId(plan.id);
    setForm({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      tagline: plan.tagline,
      priceLabel: plan.priceLabel,
      basicQuota: plan.basicQuota === null ? "" : String(plan.basicQuota),
      selfServe: plan.selfServe,
      sortOrder: plan.sortOrder,
      price: plan.priceAmountCents === null ? "" : String(plan.priceAmountCents / 100),
      currency: plan.currency || "COP",
      billingInterval: plan.billingInterval || "month",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setError("");
    setNotice("");
    setSaving(true);
    try {
      await adminUpsertPlan(supabase, {
        ...form,
        basicQuota: form.basicQuota.trim() === "" ? null : Number(form.basicQuota),
        // Se guarda en centavos: es como lo esperan Stripe y Mercado Pago.
        priceAmountCents: form.price.trim() === "" ? null : Math.round(Number(form.price) * 100),
      });
      cancelEdit();
      await load();
      setNotice("Plan guardado.");
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(plan: AdminPlanDetailed) {
    if (!window.confirm(`¿Eliminar el plan "${plan.name}"?`)) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setBusyId(plan.id);
    setError("");
    try {
      await adminDeletePlan(supabase, plan.id);
      await load();
      setNotice("Plan eliminado.");
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <span className="section-kicker">DAVALSY / ADMIN</span>
        <h1>Planes</h1>
        <p>
          Define los planes, cuántas soluciones básicas incluye cada uno y los límites operativos
          (usuarios, dashboards, fuentes de datos). Antes esto sólo se podía cambiar por SQL.
        </p>
      </div>

      {error && <p className="auth-message is-error">{error}</p>}
      {notice && <p className="auth-message is-ok">{notice}</p>}

      <div className="admin-solutions-layout">
        <form className="settings-card admin-solution-form" onSubmit={submit}>
          <div className="settings-card-head">
            <span className="settings-icon">{editingId ? <Pencil size={17} /> : <Plus size={17} />}</span>
            <div>
              <h2>{editingId ? `Editar "${form.name}"` : "Nuevo plan"}</h2>
              <p>{editingId ? `id: ${form.id}` : "El identificador no se puede cambiar después."}</p>
            </div>
          </div>

          <div className="settings-form admin-solution-grid">
            <label>
              Identificador
              <input
                required
                disabled={Boolean(editingId)}
                pattern="[a-z0-9][a-z0-9_-]*"
                placeholder="pro"
                value={form.id}
                onChange={(e) => setForm((f) => ({ ...f, id: e.target.value.toLowerCase() }))}
              />
            </label>
            <label>
              Nombre
              <input
                required
                placeholder="Pro"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>

            <label className="admin-solution-full">
              Frase corta <span className="admin-optional">(la ve el cliente al registrarse)</span>
              <input
                placeholder="Las tres soluciones básicas."
                value={form.tagline}
                onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
              />
            </label>

            <label>
              Precio <span className="admin-optional">(vacío = sin cifra pública)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                placeholder="499.00"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              />
            </label>
            <label>
              Moneda
              <select
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>

            <label>
              Periodicidad
              <select
                value={form.billingInterval}
                onChange={(e) =>
                  setForm((f) => ({ ...f, billingInterval: e.target.value as "month" | "year" }))
                }
              >
                <option value="month">Mensual</option>
                <option value="year">Anual</option>
              </select>
            </label>
            <label>
              Texto si no hay cifra
              <input
                placeholder="Hablemos"
                value={form.priceLabel}
                onChange={(e) => setForm((f) => ({ ...f, priceLabel: e.target.value }))}
              />
            </label>
            <label>
              Cupo de soluciones <span className="admin-optional">(vacío = sin límite)</span>
              <input
                type="number"
                min={0}
                placeholder="3"
                value={form.basicQuota}
                onChange={(e) => setForm((f) => ({ ...f, basicQuota: e.target.value }))}
              />
            </label>

            <label>
              Orden
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
              />
            </label>
            <label className="admin-solution-checkbox">
              <input
                type="checkbox"
                checked={form.selfServe}
                onChange={(e) => setForm((f) => ({ ...f, selfServe: e.target.checked }))}
              />
              Se puede contratar solo al registrarse
            </label>

            <label className="admin-solution-full">
              Descripción interna
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </label>
          </div>

          <div className="admin-solution-form-actions">
            <button className="primary-login settings-submit" type="submit" disabled={saving}>
              {saving ? <LoaderCircle className="spin" size={16} /> : editingId ? "Guardar cambios" : "Crear plan"}
            </button>
            {editingId && (
              <button type="button" className="admin-solution-cancel" onClick={cancelEdit} disabled={saving}>
                Cancelar
              </button>
            )}
          </div>
        </form>

        <div className="admin-solution-list">
          {!plans && !error && <p className="admin-loading">Cargando…</p>}

          {plans?.map((plan) => (
            <div key={plan.id} className="admin-feature-row admin-member-row">
              <div>
                <strong>{plan.name}</strong>
                <span className="admin-feature-key">
                  {plan.id} · {plan.organizations} {plan.organizations === 1 ? "organización" : "organizaciones"}
                </span>
                {plan.tagline && <p>{plan.tagline}</p>}
              </div>

              <div className="admin-feature-status">
                <span className="status-chip status-full">{plan.priceDisplay}</span>
                <span className="status-chip">
                  {plan.basicQuota === null ? "Sin límite" : `${plan.basicQuota} soluciones`}
                </span>
                <span className={`status-chip ${plan.selfServe ? "status-full" : "status-trial"}`}>
                  {plan.selfServe ? "Autoservicio" : "Con asesor"}
                </span>
              </div>

              <div className="admin-feature-actions">
                <button type="button" onClick={() => startEdit(plan)} disabled={busyId === plan.id}>
                  <Pencil size={13} /> Editar
                </button>
                <button
                  type="button"
                  className={pricesPlan === plan.id ? "active" : ""}
                  onClick={() => openPrices(plan.id)}
                >
                  Precios por país
                </button>
                <button
                  type="button"
                  className={featuresPlan === plan.id ? "active" : ""}
                  onClick={() => openFeatures(plan.id)}
                >
                  Límites
                </button>
                <button
                  type="button"
                  disabled={busyId === plan.id || plan.organizations > 0}
                  title={plan.organizations > 0 ? "Hay organizaciones en este plan" : undefined}
                  onClick={() => remove(plan)}
                >
                  <Trash2 size={13} /> Eliminar
                </button>
              </div>
            </div>
          ))}

          {pricesPlan && (
            <div className="settings-card">
              <div className="settings-card-head">
                <div>
                  <h2>Precios de {plans?.find((p) => p.id === pricesPlan)?.name}</h2>
                  <p>
                    Un precio por país, en su moneda. La fila <strong>*</strong> es el precio por
                    defecto para países sin precio propio.
                  </p>
                </div>
              </div>

              {!prices && <p className="admin-loading">Cargando…</p>}

              <div className="admin-plan-features">
                {prices?.map((price) => (
                  <div key={price.country} className="admin-plan-feature-row admin-price-row">
                    <div>
                      <strong>{price.country === "*" ? "Por defecto" : countryName(price.country)}</strong>
                      <span className="admin-feature-key">{price.country}</span>
                    </div>
                    <span className="status-chip status-full">
                      {(price.amountCents / 100).toLocaleString("es-CO", { minimumFractionDigits: 2 })} {price.currency}
                    </span>
                    <button type="button" disabled={savingPrice} onClick={() => removePrice(price.country)}>
                      <Trash2 size={13} /> Quitar
                    </button>
                  </div>
                ))}
                {prices?.length === 0 && (
                  <p className="admin-loading">Este plan todavía no tiene precios definidos.</p>
                )}
              </div>

              <div className="admin-assign-row">
                <select
                  value={newPrice.country}
                  onChange={(e) => {
                    const code = e.target.value;
                    const monedaPorPais: Record<string, string> = { CO: "COP", MX: "MXN", US: "USD" };
                    setNewPrice((p) => ({ ...p, country: code, currency: monedaPorPais[code] ?? p.currency }));
                  }}
                >
                  <option value="*">Por defecto (todos los demás)</option>
                  {COUNTRY_OPTIONS.map((c) => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </select>
                <select
                  value={newPrice.currency}
                  onChange={(e) => setNewPrice((p) => ({ ...p, currency: e.target.value }))}
                >
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <input
                  className="admin-plan-limit"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Monto"
                  value={newPrice.amount}
                  onChange={(e) => setNewPrice((p) => ({ ...p, amount: e.target.value }))}
                />
                <button
                  type="button"
                  className="admin-primary-button"
                  disabled={savingPrice || newPrice.amount.trim() === ""}
                  onClick={() => savePrice(newPrice.country, newPrice.currency, newPrice.amount)}
                >
                  {savingPrice ? <LoaderCircle className="spin" size={14} /> : "Guardar precio"}
                </button>
              </div>
            </div>
          )}

          {featuresPlan && (
            <div className="settings-card">
              <div className="settings-card-head">
                <div>
                  <h2>Límites de {plans?.find((p) => p.id === featuresPlan)?.name}</h2>
                  <p>Vacío significa sin límite. Los features de soluciones se marcan aparte.</p>
                </div>
              </div>

              {!features && <p className="admin-loading">Cargando…</p>}

              <div className="admin-plan-features">
                {features?.map((feature) => (
                  <div key={feature.key} className="admin-plan-feature-row">
                    <div>
                      <strong>{feature.name}</strong>
                      <span className="admin-feature-key">{feature.key}</span>
                      {feature.isSolution && <span className="status-chip">solución</span>}
                    </div>
                    <label className="admin-plan-feature-toggle">
                      <input
                        type="checkbox"
                        checked={feature.enabled}
                        disabled={busyFeature === feature.key}
                        onChange={(e) => saveFeature(feature, e.target.checked, feature.limitValue)}
                      />
                      Incluido
                    </label>
                    <input
                      className="admin-plan-limit"
                      type="number"
                      min={0}
                      placeholder="sin límite"
                      defaultValue={feature.limitValue ?? ""}
                      disabled={busyFeature === feature.key || feature.unit === "boolean"}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const next = raw === "" ? null : Number(raw);
                        if (next !== feature.limitValue) saveFeature(feature, feature.enabled, next);
                      }}
                    />
                    {busyFeature === feature.key ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Check size={14} className="admin-plan-feature-ok" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
