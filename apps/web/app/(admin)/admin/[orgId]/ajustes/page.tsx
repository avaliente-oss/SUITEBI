"use client";

import { use, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  ACCESS_STATUS_OPTIONS,
  ORGANIZATION_STATUS_OPTIONS,
  adminDeleteOrganization,
  adminListOrganizationMembers,
  adminListOrganizations,
  adminListPlans,
  adminSetOrganizationPlan,
  adminSetOrganizationStatus,
  adminSetPrimaryOwner,
  adminUpdateOrganization,
  describeAdminError,
  getSupabaseBrowserClient,
  type AdminOrganizationSummary,
  type AdminPlan,
} from "@/lib/supabase";

const statusLabels: Record<string, string> = {
  active: "Activa",
  suspended: "Suspendida",
  inactive: "Inactiva",
};

const accessLabels: Record<string, string> = {
  trial: "Prueba",
  full: "Activa (pagada)",
  limited: "Limitada (falta de pago)",
  pending: "Pendiente",
  suspended: "Suspendida",
};

export default function AdminOrganizationSettingsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  const router = useRouter();

  const [organization, setOrganization] = useState<AdminOrganizationSummary | null>(null);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [hasOwner, setHasOwner] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [planId, setPlanId] = useState("");
  const [accessStatus, setAccessStatus] = useState("trial");
  const [status, setStatus] = useState("active");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [confirmName, setConfirmName] = useState("");

  async function load() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    try {
      const [organizations, planList, members] = await Promise.all([
        adminListOrganizations(supabase),
        adminListPlans(supabase),
        adminListOrganizationMembers(supabase, orgId),
      ]);
      const found = organizations.find((org) => org.id === orgId) ?? null;
      setOrganization(found);
      setPlans(planList);
      setHasOwner(members.some((member) => member.isPrimaryOwner && member.status === "active"));
      if (found) {
        setName(found.name);
        setPlanId(found.plan_id);
        setAccessStatus(found.access_status);
        setStatus(found.status);
      }
    } catch (err) {
      setError(describeAdminError(err));
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() se reutiliza tras cada acción
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function run(key: string, action: () => Promise<void>, message: string) {
    setError("");
    setNotice("");
    setBusy(key);
    try {
      await action();
      await load();
      setNotice(message);
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setBusy(null);
    }
  }

  function submitName(event: FormEvent) {
    event.preventDefault();
    run("name", async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      await adminUpdateOrganization(supabase, orgId, name);
    }, "Nombre actualizado.");
  }

  function submitPlan(event: FormEvent) {
    event.preventDefault();
    run("plan", async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      await adminSetOrganizationPlan(supabase, orgId, planId, accessStatus);
    }, "Plan y estado de acceso actualizados.");
  }

  function submitStatus(event: FormEvent) {
    event.preventDefault();
    run("status", async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      await adminSetOrganizationStatus(supabase, orgId, status);
    }, "Estado de la organización actualizado.");
  }

  function submitOwner(event: FormEvent) {
    event.preventDefault();
    run("owner", async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      await adminSetPrimaryOwner(supabase, orgId, ownerEmail);
    }, "Propietario asignado.");
  }

  async function submitDelete(event: FormEvent) {
    event.preventDefault();
    if (!window.confirm(`Esto elimina "${organization?.name}" y todo su contenido de forma permanente. ¿Continuar?`)) {
      return;
    }

    setError("");
    setBusy("delete");
    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      await adminDeleteOrganization(supabase, orgId, confirmName);
      router.replace("/admin");
    } catch (err) {
      setError(describeAdminError(err));
      setBusy(null);
    }
  }

  return (
    <div className="admin-page">
      <Link href="/admin" className="admin-back-link"><ArrowLeft size={15} /> Todas las organizaciones</Link>

      <div className="admin-page-head">
        <span className="section-kicker">DAVALSY / ADMIN</span>
        <h1>{organization?.name ?? "Organización"}</h1>
        <p>Datos, plan y estado de esta organización.</p>
      </div>

      <nav className="admin-tabs">
        <Link href={`/admin/${orgId}`}>Permisos</Link>
        <Link href={`/admin/${orgId}/miembros`}>Miembros</Link>
        <Link href={`/admin/${orgId}/ajustes`} className="active">Ajustes</Link>
      </nav>

      {error && <p className="auth-message is-error">{error}</p>}
      {notice && <p className="auth-message is-ok">{notice}</p>}

      {!organization && !error && <p className="admin-loading">Cargando…</p>}

      {organization && (
        <div className="admin-settings-stack">
          {!hasOwner && (
            <form className="settings-card" onSubmit={submitOwner}>
              <div className="settings-card-head">
                <span className="settings-icon"><ShieldCheck size={17} /></span>
                <div>
                  <h2>Falta asignar propietario</h2>
                  <p>Esta organización no tiene dueño, por eso está inactiva. La persona debe tener cuenta en la Suite.</p>
                </div>
              </div>
              <div className="settings-form">
                <label>
                  Correo del propietario
                  <input
                    required
                    type="email"
                    placeholder="persona@empresa.com"
                    value={ownerEmail}
                    onChange={(event) => setOwnerEmail(event.target.value)}
                  />
                </label>
              </div>
              <button className="primary-login settings-submit" type="submit" disabled={busy === "owner"}>
                {busy === "owner" ? <LoaderCircle className="spin" size={16} /> : "Asignar propietario"}
              </button>
            </form>
          )}

          <form className="settings-card" onSubmit={submitName}>
            <div className="settings-card-head">
              <div>
                <h2>Nombre</h2>
                <p>Así lo ve el cliente dentro de la Suite. El identificador interno ({organization.slug}) no cambia.</p>
              </div>
            </div>
            <div className="settings-form">
              <label>
                Nombre de la organización
                <input required value={name} onChange={(event) => setName(event.target.value)} />
              </label>
            </div>
            <button className="primary-login settings-submit" type="submit" disabled={busy === "name"}>
              {busy === "name" ? <LoaderCircle className="spin" size={16} /> : "Guardar nombre"}
            </button>
          </form>

          <form className="settings-card" onSubmit={submitPlan}>
            <div className="settings-card-head">
              <div>
                <h2>Plan y acceso</h2>
                <p>El plan define qué features trae incluidos. El estado de acceso controla si puede usarlos.</p>
              </div>
            </div>
            <div className="settings-form admin-invite-grid">
              <label>
                Plan
                <select value={planId} onChange={(event) => setPlanId(event.target.value)}>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>{plan.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Estado de acceso
                <select value={accessStatus} onChange={(event) => setAccessStatus(event.target.value)}>
                  {ACCESS_STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>{accessLabels[option] ?? option}</option>
                  ))}
                </select>
              </label>
            </div>
            <button className="primary-login settings-submit" type="submit" disabled={busy === "plan"}>
              {busy === "plan" ? <LoaderCircle className="spin" size={16} /> : "Guardar plan"}
            </button>
          </form>

          <form className="settings-card" onSubmit={submitStatus}>
            <div className="settings-card-head">
              <div>
                <h2>Estado de la organización</h2>
                <p>Suspender corta el acceso de todos sus miembros sin borrar nada. Es reversible.</p>
              </div>
            </div>
            <div className="settings-form">
              <label>
                Estado
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  {ORGANIZATION_STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>{statusLabels[option] ?? option}</option>
                  ))}
                </select>
              </label>
            </div>
            <button className="primary-login settings-submit" type="submit" disabled={busy === "status"}>
              {busy === "status" ? <LoaderCircle className="spin" size={16} /> : "Guardar estado"}
            </button>
          </form>

          <form className="settings-card admin-danger-card" onSubmit={submitDelete}>
            <div className="settings-card-head">
              <span className="settings-icon admin-danger-icon"><TriangleAlert size={17} /></span>
              <div>
                <h2>Eliminar organización</h2>
                <p>
                  Borra de forma permanente sus miembros, suscripción, permisos, invitaciones e historial.
                  No se puede deshacer salvo restaurando un respaldo. Si sólo quieres cortarle el acceso,
                  usa <strong>Suspender</strong> arriba.
                </p>
              </div>
            </div>
            <div className="settings-form">
              <label>
                Escribe <strong>{organization.name}</strong> para confirmar
                <input
                  required
                  placeholder={organization.name}
                  value={confirmName}
                  onChange={(event) => setConfirmName(event.target.value)}
                />
              </label>
            </div>
            <button
              className="admin-danger-button"
              type="submit"
              disabled={busy === "delete" || confirmName.trim().toLowerCase() !== organization.name.trim().toLowerCase()}
            >
              {busy === "delete" ? <LoaderCircle className="spin" size={16} /> : "Eliminar definitivamente"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
