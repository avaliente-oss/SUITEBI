"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Boxes, LoaderCircle, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  adminDeleteSolution,
  adminListSolutions,
  adminSetSolutionActive,
  adminUpsertSolution,
  getSupabaseBrowserClient,
  type AdminSolution,
} from "@/lib/supabase";
import { SOLUTION_ICON_OPTIONS } from "@/lib/suite-data";
import { solutionIcons } from "@/components/suite-ui";

const emptyForm = {
  id: "",
  name: "",
  eyebrow: "",
  description: "",
  icon: "boxes" as (typeof SOLUTION_ICON_OPTIONS)[number],
  featureKey: "",
  featureName: "",
  isExternal: true,
  externalUrl: "",
  metric: "",
  metricLabel: "",
  sortOrder: 100,
};

export default function AdminSolucionesPage() {
  const [solutions, setSolutions] = useState<AdminSolution[] | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    try {
      setSolutions(await adminListSolutions(supabase));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar las soluciones.");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() reruns on demand after admin actions, not only on mount
    load();
  }, []);

  function startEdit(solution: AdminSolution) {
    setEditingId(solution.id);
    setForm({
      id: solution.id,
      name: solution.name,
      eyebrow: solution.eyebrow,
      description: solution.description,
      icon: (SOLUTION_ICON_OPTIONS as readonly string[]).includes(solution.icon)
        ? (solution.icon as (typeof SOLUTION_ICON_OPTIONS)[number])
        : "boxes",
      featureKey: solution.feature_key,
      featureName: solution.name,
      isExternal: solution.is_external,
      externalUrl: solution.external_url ?? "",
      metric: solution.metric,
      metricLabel: solution.metric_label,
      sortOrder: solution.sort_order,
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
    setSaving(true);
    try {
      await adminUpsertSolution(supabase, form);
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar la solución.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(solution: AdminSolution) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setBusyId(solution.id);
    try {
      await adminSetSolutionActive(supabase, solution.id, !solution.is_active);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos actualizar la solución.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(solution: AdminSolution) {
    if (!window.confirm(`¿Eliminar "${solution.name}"? Esta acción no se puede deshacer.`)) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setBusyId(solution.id);
    try {
      await adminDeleteSolution(supabase, solution.id);
      if (editingId === solution.id) cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos eliminar la solución.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <span className="section-kicker">DAVALSY / ADMIN</span>
        <h1>Soluciones</h1>
        <p>
          Da de alta nuevas soluciones (propias o externas como DavOps ERP) sin tocar código. Cada
          solución queda ligada a un feature que puedes habilitar por plan o por excepción en la
          hoja de <Link href="/admin">Organizaciones</Link>.
        </p>
      </div>

      {error && <p className="auth-message is-error">{error}</p>}

      <div className="admin-solutions-layout">
        <form className="settings-card admin-solution-form" onSubmit={submit}>
          <div className="settings-card-head">
            <span className="settings-icon">{editingId ? <Pencil size={17} /> : <Plus size={17} />}</span>
            <div>
              <h2>{editingId ? `Editar "${form.name}"` : "Nueva solución"}</h2>
              <p>{editingId ? `id: ${form.id}` : "Se crea también el feature si no existe."}</p>
            </div>
          </div>

          <div className="settings-form admin-solution-grid">
            <label>
              Identificador (id)
              <input
                required
                disabled={Boolean(editingId)}
                pattern="[a-z0-9][a-z0-9-]*"
                placeholder="crm"
                value={form.id}
                onChange={(event) => setForm((f) => ({ ...f, id: event.target.value.toLowerCase() }))}
              />
            </label>
            <label>
              Nombre
              <input
                required
                placeholder="DavOps CRM"
                value={form.name}
                onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
              />
            </label>

            <label>
              Categoría (eyebrow)
              <input
                placeholder="Operación"
                value={form.eyebrow}
                onChange={(event) => setForm((f) => ({ ...f, eyebrow: event.target.value }))}
              />
            </label>
            <label>
              Ícono
              <select value={form.icon} onChange={(event) => setForm((f) => ({ ...f, icon: event.target.value as typeof form.icon }))}>
                {SOLUTION_ICON_OPTIONS.map((icon) => (
                  <option key={icon} value={icon}>
                    {icon}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-solution-full">
              Descripción
              <input
                placeholder="Qué hace esta solución, en una línea."
                value={form.description}
                onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
              />
            </label>

            <label>
              Feature key
              <input
                required
                placeholder="crm.access"
                value={form.featureKey}
                onChange={(event) => setForm((f) => ({ ...f, featureKey: event.target.value }))}
              />
            </label>
            <label>
              Nombre del feature
              <input
                placeholder="Acceso a DavOps CRM"
                value={form.featureName}
                onChange={(event) => setForm((f) => ({ ...f, featureName: event.target.value }))}
              />
            </label>

            <label className="admin-solution-checkbox">
              <input
                type="checkbox"
                checked={form.isExternal}
                onChange={(event) => setForm((f) => ({ ...f, isExternal: event.target.checked }))}
              />
              Vive fuera de la Suite (se abre por puente de sesión)
            </label>
            <label>
              Orden
              <input
                type="number"
                value={form.sortOrder}
                onChange={(event) => setForm((f) => ({ ...f, sortOrder: Number(event.target.value) }))}
              />
            </label>

            {form.isExternal && (
              <label className="admin-solution-full">
                URL de entrada externa
                <input
                  required={form.isExternal}
                  placeholder="https://mi-app.vercel.app/auth/suite-entry"
                  value={form.externalUrl}
                  onChange={(event) => setForm((f) => ({ ...f, externalUrl: event.target.value }))}
                />
              </label>
            )}

            <label>
              Métrica
              <input
                placeholder="Conectado"
                value={form.metric}
                onChange={(event) => setForm((f) => ({ ...f, metric: event.target.value }))}
              />
            </label>
            <label>
              Etiqueta de métrica
              <input
                placeholder="operación en tiempo real"
                value={form.metricLabel}
                onChange={(event) => setForm((f) => ({ ...f, metricLabel: event.target.value }))}
              />
            </label>
          </div>

          <div className="admin-solution-form-actions">
            <button className="primary-login settings-submit" type="submit" disabled={saving}>
              {saving ? <LoaderCircle className="spin" size={16} /> : editingId ? "Guardar cambios" : "Crear solución"}
            </button>
            {editingId && (
              <button type="button" className="admin-solution-cancel" onClick={cancelEdit} disabled={saving}>
                Cancelar
              </button>
            )}
          </div>
        </form>

        <div className="admin-solution-list">
          {!solutions && !error && <p className="admin-loading">Cargando…</p>}

          {solutions?.map((solution) => {
            const Icon = solutionIcons[solution.icon as keyof typeof solutionIcons] ?? Boxes;
            const busy = busyId === solution.id;

            return (
              <div key={solution.id} className="admin-feature-row admin-solution-row">
                <div>
                  <strong><Icon size={15} /> {solution.name}</strong>
                  <span className="admin-feature-key">{solution.id} · {solution.feature_key}</span>
                  {solution.description && <p>{solution.description}</p>}
                </div>

                <div className="admin-feature-status">
                  <span className={`status-chip ${solution.is_active ? "status-full" : "status-trial"}`}>
                    {solution.is_active ? "Activa" : "Desactivada"}
                  </span>
                  <span className="status-chip">{solution.is_external ? "Externa" : "En la Suite"}</span>
                </div>

                <div className="admin-feature-actions">
                  <button type="button" onClick={() => startEdit(solution)} disabled={busy}>
                    <Pencil size={13} /> Editar
                  </button>
                  <button type="button" disabled={busy} onClick={() => toggleActive(solution)}>
                    <RotateCcw size={13} /> {solution.is_active ? "Desactivar" : "Activar"}
                  </button>
                  <button type="button" disabled={busy} onClick={() => remove(solution)}>
                    <Trash2 size={13} /> Eliminar
                  </button>
                </div>
              </div>
            );
          })}

          {solutions?.length === 0 && <p className="admin-loading">Todavía no hay soluciones registradas.</p>}
        </div>
      </div>
    </div>
  );
}
