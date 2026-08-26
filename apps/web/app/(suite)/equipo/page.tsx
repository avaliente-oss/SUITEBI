"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Ban, Check, Copy, KeyRound, LoaderCircle, Mail, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useSuite } from "@/lib/suite-context";
import {
  ORGANIZATION_ROLE_OPTIONS,
  describeAdminError,
  getSupabaseBrowserClient,
  orgAddMember,
  orgCreateInvitation,
  orgListTeam,
  orgRevokeInvitation,
  orgSetMemberRole,
  orgSetMemberStatus,
  requestPasswordReset,
  type OrgTeam,
  type OrgTeamMember,
} from "@/lib/supabase";
import { formatRole } from "@/lib/suite-data";

export default function EquipoPage() {
  const { organization, setToast, isDemo } = useSuite();

  const [team, setTeam] = useState<OrgTeam | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mode, setMode] = useState<"add" | "invite">("add");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("viewer");
  const [sending, setSending] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  async function load() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    try {
      setTeam(await orgListTeam(supabase, organization.id));
    } catch (err) {
      setError(describeAdminError(err));
    }
  }

  useEffect(() => {
    if (isDemo) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() se reutiliza tras cada acción
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization.id, isDemo]);

  async function run(id: string, action: () => Promise<void>, message: string) {
    setError("");
    setBusyId(id);
    try {
      await action();
      await load();
      setToast(message);
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink(token: string) {
    const link = `${window.location.origin}/invitacion?token=${token}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedToken(token);
      window.setTimeout(() => setCopiedToken(null), 2500);
    } catch {
      setError("No pudimos copiar el enlace. Selecciónalo manualmente.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setError("");
    setSending(true);
    try {
      if (mode === "add") {
        await orgAddMember(supabase, organization.id, email, role);
        setEmail("");
        await load();
        setToast("Listo, ya forma parte de tu equipo.");
      } else {
        const created = await orgCreateInvitation(supabase, organization.id, email, role);
        setEmail("");
        await load();
        await copyLink(created.token);
        setToast(`Invitación creada. El enlace ya está en tu portapapeles: envíaselo a ${created.email}.`);
      }
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setSending(false);
    }
  }

  function sendReset(member: OrgTeamMember) {
    if (!member.email) return;
    if (!window.confirm(`¿Enviar a ${member.email} un enlace para cambiar su contraseña?`)) return;

    run(
      member.userId,
      async () => {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) return;
        await requestPasswordReset(supabase, member.email!);
      },
      "Enlace enviado. La persona debe abrirlo desde su correo.",
    );
  }

  const full = team?.userLimit !== null && team !== null && team.activeCount >= (team.userLimit ?? 0);

  return (
    <>
      <section className="welcome-row" id="welcome-row">
        <div>
          <span className="today-label"><i /> ORGANIZACIÓN</span>
          <h1>Equipo y accesos.</h1>
          <p>Quién entra a {organization.name}, con qué rol y con qué permisos.</p>
        </div>
        {team && (
          <div className="plan-card">
            <span className="plan-icon"><ShieldCheck size={17} /></span>
            <div>
              <small>MIEMBROS ACTIVOS</small>
              <strong>
                {team.activeCount}
                {team.userLimit !== null ? ` / ${team.userLimit}` : ""}
              </strong>
            </div>
          </div>
        )}
      </section>

      {error && <p className="auth-message is-error">{error}</p>}

      {!team && !error && <p className="admin-loading">Cargando…</p>}

      {team && !team.canManage && !team.canInvite && (
        <p className="admin-section-note">
          Tu rol te permite ver el equipo, pero no modificarlo. Pídele a un propietario o
          administrador de la organización que haga los cambios.
        </p>
      )}

      {team && (team.canManage || team.canInvite) && (
        <section className="settings-card plan-section">
          <div className="settings-card-head">
            <span className="settings-icon"><UserPlus size={17} /></span>
            <div>
              <h2>Sumar a alguien</h2>
              <p>
                Si ya tiene cuenta en la Suite, entra de inmediato. Si no, se le genera un enlace
                de invitación para que cree su contraseña.
              </p>
            </div>
          </div>

          <div className="team-mode-switch">
            <button
              type="button"
              className={mode === "add" ? "active" : ""}
              onClick={() => setMode("add")}
              disabled={!team.canManage}
            >
              Ya tiene cuenta
            </button>
            <button
              type="button"
              className={mode === "invite" ? "active" : ""}
              onClick={() => setMode("invite")}
              disabled={!team.canInvite}
            >
              Invitar por enlace
            </button>
          </div>

          <form onSubmit={submit}>
            <div className="settings-form admin-invite-grid">
              <label>
                Correo
                <input
                  required
                  type="email"
                  placeholder="persona@empresa.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label>
                Rol
                <select value={role} onChange={(event) => setRole(event.target.value)}>
                  {ORGANIZATION_ROLE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{formatRole(option)}</option>
                  ))}
                </select>
              </label>
            </div>

            {full && (
              <p className="auth-message is-warning">
                Llegaste al máximo de usuarios de tu plan. Sube de plan para sumar a más gente.
              </p>
            )}

            <button className="primary-login settings-submit" type="submit" disabled={sending}>
              {sending ? <LoaderCircle className="spin" size={16} /> : mode === "add" ? "Agregar al equipo" : "Crear invitación"}
            </button>
          </form>
        </section>
      )}

      {team && (
        <section className="settings-card plan-section">
          <div className="settings-card-head">
            <div>
              <h2>Miembros</h2>
              <p>El propietario principal no se puede modificar desde aquí.</p>
            </div>
          </div>

          <div className="admin-feature-list">
            {team.members.map((member) => {
              const busy = busyId === member.userId;
              const locked =
                member.isPrimaryOwner ||
                member.isSelf ||
                member.role === "owner" ||
                member.role === "co_owner" ||
                !team.canManage;

              return (
                <div key={member.userId} className="admin-feature-row admin-member-row">
                  <div>
                    <strong>{member.fullName || member.email || "Sin nombre"}</strong>
                    <span className="admin-feature-key">{member.email}</span>
                    {member.isPrimaryOwner && (
                      <p className="admin-owner-note"><ShieldCheck size={12} /> Propietario principal</p>
                    )}
                    {member.isSelf && !member.isPrimaryOwner && (
                      <p className="admin-owner-note">Eres tú</p>
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
                          run(
                            member.userId,
                            async () => {
                              const supabase = getSupabaseBrowserClient();
                              if (!supabase) return;
                              await orgSetMemberRole(supabase, organization.id, member.userId, event.target.value);
                            },
                            "Rol actualizado.",
                          )
                        }
                      >
                        {ORGANIZATION_ROLE_OPTIONS.map((option) => (
                          <option key={option} value={option}>{formatRole(option)}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="admin-feature-actions">
                    {team.canManage && member.email && (
                      <button type="button" disabled={busy} onClick={() => sendReset(member)}>
                        <KeyRound size={13} /> Contraseña
                      </button>
                    )}
                    {!locked && member.status === "active" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(
                            member.userId,
                            async () => {
                              const supabase = getSupabaseBrowserClient();
                              if (!supabase) return;
                              await orgSetMemberStatus(supabase, organization.id, member.userId, "suspended");
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
                          run(
                            member.userId,
                            async () => {
                              const supabase = getSupabaseBrowserClient();
                              if (!supabase) return;
                              await orgSetMemberStatus(supabase, organization.id, member.userId, "active");
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
                          if (!window.confirm(`¿Quitar a ${member.email} del equipo?`)) return;
                          run(
                            member.userId,
                            async () => {
                              const supabase = getSupabaseBrowserClient();
                              if (!supabase) return;
                              await orgSetMemberStatus(supabase, organization.id, member.userId, "removed");
                            },
                            "Miembro retirado del equipo.",
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
          </div>
        </section>
      )}

      {team && team.invitations.length > 0 && (
        <section className="settings-card plan-section">
          <div className="settings-card-head">
            <div>
              <h2>Invitaciones pendientes</h2>
              <p>Enlaces vigentes que todavía nadie ha usado.</p>
            </div>
          </div>

          <div className="admin-feature-list">
            {team.invitations.map((invitation) => (
              <div key={invitation.id} className="admin-feature-row admin-member-row">
                <div>
                  <strong><Mail size={14} /> {invitation.email}</strong>
                  <span className="admin-feature-key">
                    Vence el {new Date(invitation.expiresAt).toLocaleDateString("es-MX")}
                  </span>
                </div>
                <div className="admin-feature-status">
                  <span className="status-chip">{formatRole(invitation.role)}</span>
                </div>
                <div className="admin-feature-actions">
                  <button type="button" onClick={() => copyLink(invitation.token)}>
                    <Copy size={13} /> {copiedToken === invitation.token ? "¡Copiado!" : "Copiar enlace"}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === invitation.id}
                    onClick={() =>
                      run(
                        invitation.id,
                        async () => {
                          const supabase = getSupabaseBrowserClient();
                          if (!supabase) return;
                          await orgRevokeInvitation(supabase, invitation.id);
                        },
                        "Invitación revocada.",
                      )
                    }
                  >
                    <Trash2 size={13} /> Revocar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
