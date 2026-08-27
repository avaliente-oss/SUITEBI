"use client";

import { use, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Check, Copy, KeyRound, LoaderCircle, Mail, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import {
  ORGANIZATION_ROLE_OPTIONS,
  adminAddMember,
  adminCreateInvitation,
  adminListInvitations,
  adminListOrganizationMembers,
  adminListOrganizations,
  adminRevokeInvitation,
  adminSetMemberRole,
  adminSetMemberStatus,
  describeAdminError,
  getSupabaseBrowserClient,
  requestPasswordReset,
  type AdminInvitation,
  type AdminMember,
  type AdminOrganizationSummary,
} from "@/lib/supabase";
import { formatRole } from "@/lib/suite-data";

export default function AdminOrganizationMembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);

  const [organization, setOrganization] = useState<AdminOrganizationSummary | null>(null);
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [invitations, setInvitations] = useState<AdminInvitation[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("viewer");
  const [inviting, setInviting] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<string>("viewer");
  const [adding, setAdding] = useState(false);

  async function load() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    try {
      const [organizations, memberList, invitationList] = await Promise.all([
        adminListOrganizations(supabase),
        adminListOrganizationMembers(supabase, orgId),
        adminListInvitations(supabase, orgId),
      ]);
      setOrganization(organizations.find((org) => org.id === orgId) ?? null);
      setMembers(memberList);
      setInvitations(invitationList);
    } catch (err) {
      setError(describeAdminError(err));
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() se reutiliza tras cada acción, no sólo al montar
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  function invitationLink(token: string) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/invitacion?token=${token}`;
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(invitationLink(token));
      setCopiedToken(token);
      window.setTimeout(() => setCopiedToken(null), 2500);
    } catch {
      setError("No pudimos copiar el enlace. Selecciónalo manualmente.");
    }
  }

  async function runAction(id: string, action: () => Promise<void>, successMessage: string) {
    setError("");
    setNotice("");
    setBusyId(id);
    try {
      await action();
      await load();
      setNotice(successMessage);
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setBusyId(null);
    }
  }

  async function submitAddMember(event: FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setError("");
    setNotice("");
    setAdding(true);
    try {
      await adminAddMember(supabase, orgId, addEmail, addRole);
      setAddEmail("");
      await load();
      setNotice("Listo, ya forma parte de la organización.");
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setAdding(false);
    }
  }

  async function submitInvite(event: FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setError("");
    setNotice("");
    setInviting(true);
    try {
      const created = await adminCreateInvitation(supabase, orgId, inviteEmail, inviteRole);
      setInviteEmail("");
      await load();
      await copyLink(created.token);
      setNotice(`Invitación creada para ${created.email}. El enlace ya está en tu portapapeles: envíaselo.`);
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="admin-page">
      <Link href="/admin" className="admin-back-link"><ArrowLeft size={15} /> Todas las organizaciones</Link>

      <div className="admin-page-head">
        <span className="section-kicker">DAVALSY / ADMIN</span>
        <h1>{organization?.name ?? "Organización"}</h1>
        <p>Miembros, roles e invitaciones de esta organización.</p>
      </div>

      <nav className="admin-tabs">
        <Link href={`/admin/${orgId}`}>Permisos</Link>
        <Link href={`/admin/${orgId}/miembros`} className="active">Miembros</Link>
        <Link href={`/admin/${orgId}/ajustes`}>Ajustes</Link>
        <Link href={`/admin/${orgId}/actividad`}>Actividad</Link>
      </nav>

      {error && <p className="auth-message is-error">{error}</p>}
      {notice && <p className="auth-message is-ok">{notice}</p>}

      <h2 className="admin-section-title">Miembros</h2>

      {!members && !error && <p className="admin-loading">Cargando…</p>}

      {members && (
        <div className="admin-feature-list">
          {members.map((member) => {
            const busy = busyId === member.userId;
            const locked = member.isPrimaryOwner || member.role === "owner" || member.role === "co_owner";

            return (
              <div key={member.userId} className="admin-feature-row admin-member-row">
                <div>
                  <strong>{member.fullName || member.email || "Sin nombre"}</strong>
                  <span className="admin-feature-key">{member.email}</span>
                  {member.isPrimaryOwner && (
                    <p className="admin-owner-note">
                      <ShieldCheck size={12} /> Propietario principal. Su rol y estado sólo los cambia el dueño de la organización.
                    </p>
                  )}
                </div>

                <div className="admin-feature-status">
                  <span className={`status-chip ${member.status === "active" ? "status-full" : "status-trial"}`}>
                    {member.status === "active" ? "Activo" : member.status === "suspended" ? "Suspendido" : member.status}
                  </span>
                  {locked ? (
                    <span className="status-chip">{formatRole(member.role)}</span>
                  ) : (
                    <select
                      className="admin-role-select"
                      value={member.role}
                      disabled={busy}
                      onChange={(event) =>
                        runAction(
                          member.userId,
                          async () => {
                            const supabase = getSupabaseBrowserClient();
                            if (!supabase) return;
                            await adminSetMemberRole(supabase, orgId, member.userId, event.target.value);
                          },
                          "Rol actualizado.",
                        )
                      }
                    >
                      {ORGANIZATION_ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>{formatRole(role)}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="admin-feature-actions">
                  {member.email && (
                    <button
                      type="button"
                      disabled={busy}
                      title="Le envía un correo para que defina una contraseña nueva"
                      onClick={() => {
                        if (!window.confirm(`¿Enviar a ${member.email} un enlace para cambiar su contraseña?`)) return;
                        runAction(
                          member.userId,
                          async () => {
                            const supabase = getSupabaseBrowserClient();
                            if (!supabase) return;
                            await requestPasswordReset(supabase, member.email!);
                          },
                          "Enlace enviado. La persona debe abrirlo desde su correo.",
                        );
                      }}
                    >
                      <KeyRound size={13} /> Contraseña
                    </button>
                  )}
                  {!locked && member.status === "active" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction(
                          member.userId,
                          async () => {
                            const supabase = getSupabaseBrowserClient();
                            if (!supabase) return;
                            await adminSetMemberStatus(supabase, orgId, member.userId, "suspended");
                          },
                          "Miembro suspendido.",
                        )
                      }
                    >
                      <Ban size={13} /> Suspender
                    </button>
                  )}
                  {!locked && member.status !== "active" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction(
                          member.userId,
                          async () => {
                            const supabase = getSupabaseBrowserClient();
                            if (!supabase) return;
                            await adminSetMemberStatus(supabase, orgId, member.userId, "active");
                          },
                          "Miembro reactivado.",
                        )
                      }
                    >
                      <Check size={13} /> Reactivar
                    </button>
                  )}
                  {!locked && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`¿Quitar a ${member.email} de esta organización?`)) return;
                        runAction(
                          member.userId,
                          async () => {
                            const supabase = getSupabaseBrowserClient();
                            if (!supabase) return;
                            await adminSetMemberStatus(supabase, orgId, member.userId, "removed");
                          },
                          "Miembro retirado de la organización.",
                        );
                      }}
                    >
                      <Trash2 size={13} /> Quitar
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {members.length === 0 && <p className="admin-loading">Esta organización no tiene miembros activos.</p>}
        </div>
      )}

      <h2 className="admin-section-title">Agregar a alguien que ya tiene cuenta</h2>

      <form className="settings-card admin-invite-form" onSubmit={submitAddMember}>
        <div className="settings-card-head">
          <span className="settings-icon"><UserPlus size={17} /></span>
          <div>
            <h2>Asignación directa</h2>
            <p>Entra de inmediato, sin enlace ni confirmación. Si aún no tiene cuenta, usa la invitación de abajo.</p>
          </div>
        </div>

        <div className="settings-form admin-invite-grid">
          <label>
            Correo
            <input
              required
              type="email"
              placeholder="persona@empresa.com"
              value={addEmail}
              onChange={(event) => setAddEmail(event.target.value)}
            />
          </label>
          <label>
            Rol
            <select value={addRole} onChange={(event) => setAddRole(event.target.value)}>
              {ORGANIZATION_ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>{formatRole(role)}</option>
              ))}
            </select>
          </label>
        </div>

        <button className="primary-login settings-submit" type="submit" disabled={adding}>
          {adding ? <LoaderCircle className="spin" size={16} /> : "Agregar a la organización"}
        </button>
      </form>

      <h2 className="admin-section-title">Invitar a alguien sin cuenta</h2>

      <form className="settings-card admin-invite-form" onSubmit={submitInvite}>
        <div className="settings-card-head">
          <span className="settings-icon"><UserPlus size={17} /></span>
          <div>
            <h2>Nueva invitación</h2>
            <p>Se genera un enlace válido por 7 días. Cópialo y envíaselo tú: la Suite todavía no envía correos.</p>
          </div>
        </div>

        <div className="settings-form admin-invite-grid">
          <label>
            Correo
            <input
              required
              type="email"
              placeholder="persona@empresa.com"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
            />
          </label>
          <label>
            Rol
            <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
              {ORGANIZATION_ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>{formatRole(role)}</option>
              ))}
            </select>
          </label>
        </div>

        <button className="primary-login settings-submit" type="submit" disabled={inviting}>
          {inviting ? <LoaderCircle className="spin" size={16} /> : <>Crear invitación</>}
        </button>
      </form>

      {invitations.length > 0 && (
        <>
          <h2 className="admin-section-title">Invitaciones pendientes</h2>
          <div className="admin-feature-list">
            {invitations.map((invitation) => {
              const busy = busyId === invitation.id;

              return (
                <div key={invitation.id} className="admin-feature-row admin-member-row">
                  <div>
                    <strong><Mail size={14} /> {invitation.email}</strong>
                    <span className="admin-feature-key">
                      Vence el {new Date(invitation.expiresAt).toLocaleDateString("es-MX")}
                    </span>
                  </div>

                  <div className="admin-feature-status">
                    <span className="status-chip">{formatRole(invitation.role)}</span>
                    <span className="status-chip status-trial">Pendiente</span>
                  </div>

                  <div className="admin-feature-actions">
                    <button type="button" onClick={() => copyLink(invitation.token)} disabled={busy}>
                      <Copy size={13} /> {copiedToken === invitation.token ? "¡Copiado!" : "Copiar enlace"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction(
                          invitation.id,
                          async () => {
                            const supabase = getSupabaseBrowserClient();
                            if (!supabase) return;
                            await adminRevokeInvitation(supabase, invitation.id);
                          },
                          "Invitación revocada.",
                        )
                      }
                    >
                      <Trash2 size={13} /> Revocar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
