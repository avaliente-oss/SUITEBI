"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Building2, LoaderCircle, Plus } from "lucide-react";
import {
  adminCreateOrganization,
  adminListOrganizations,
  adminListPlans,
  describeAdminError,
  getSupabaseBrowserClient,
  type AdminOrganizationSummary,
  type AdminPlan,
} from "@/lib/supabase";

export default function AdminOrganizationsPage() {
  const [organizations, setOrganizations] = useState<AdminOrganizationSummary[] | null>(null);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState("");
  const [planId, setPlanId] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");

  async function load() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    try {
      const [orgList, planList] = await Promise.all([
        adminListOrganizations(supabase),
        adminListPlans(supabase),
      ]);
      setOrganizations(orgList);
      setPlans(planList);
      if (!planId && planList.length) setPlanId(planList[0].id);
    } catch (err) {
      setError(describeAdminError(err));
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() se reutiliza tras crear una organización
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setError("");
    setNotice("");
    setCreating(true);
    try {
      const created = await adminCreateOrganization(supabase, {
        name,
        planId,
        ownerEmail: ownerEmail.trim() || undefined,
      });
      setName("");
      setOwnerEmail("");
      setShowForm(false);
      await load();
      setNotice(
        created.hasOwner
          ? "Organización creada y activa."
          : "Organización creada sin propietario, por eso quedó inactiva. Asígnale dueño desde su pestaña Ajustes.",
      );
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <span className="section-kicker">DAVALSY / ADMIN</span>
        <h1>Organizaciones</h1>
        <p>Todas las organizaciones de la Suite. Entra a una para ver sus permisos, miembros y ajustes.</p>
      </div>

      {error && <p className="auth-message is-error">{error}</p>}
      {notice && <p className="auth-message is-ok">{notice}</p>}

      <div className="admin-toolbar">
        <button type="button" className="admin-primary-button" onClick={() => setShowForm((current) => !current)}>
          <Plus size={15} /> {showForm ? "Cancelar" : "Nueva organización"}
        </button>
      </div>

      {showForm && (
        <form className="settings-card admin-invite-form" onSubmit={submit}>
          <div className="settings-card-head">
            <span className="settings-icon"><Building2 size={17} /></span>
            <div>
              <h2>Nueva organización</h2>
              <p>Si el propietario todavía no tiene cuenta, créala sin dueño y asígnalo después.</p>
            </div>
          </div>

          <div className="settings-form admin-invite-grid">
            <label>
              Nombre
              <input
                required
                placeholder="Norte Industrial"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Plan
              <select value={planId} onChange={(event) => setPlanId(event.target.value)}>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>{plan.name}</option>
                ))}
              </select>
            </label>
            <label className="admin-solution-full">
              Correo del propietario <span className="admin-optional">(opcional, debe tener cuenta en la Suite)</span>
              <input
                type="email"
                placeholder="persona@empresa.com"
                value={ownerEmail}
                onChange={(event) => setOwnerEmail(event.target.value)}
              />
            </label>
          </div>

          <button className="primary-login settings-submit" type="submit" disabled={creating}>
            {creating ? <LoaderCircle className="spin" size={16} /> : "Crear organización"}
          </button>
        </form>
      )}

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
              <span className="admin-org-name">
                <Building2 size={16} /> {org.name}
                {org.status !== "active" && <em className="admin-org-flag">{org.status}</em>}
              </span>
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
