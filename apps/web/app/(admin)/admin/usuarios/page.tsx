"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Ban, Check, LoaderCircle, Pencil, Search, ShieldUser, Trash2, UserPlus } from "lucide-react";
import {
  adminAddPlatformAdmin,
  adminListPlatformAdmins,
  adminRemovePlatformAdmin,
  adminSearchUsers,
  adminSetUserActive,
  adminUpdateUserProfile,
  describeAdminError,
  getSupabaseBrowserClient,
  type AdminPlatformAdmin,
  type AdminUserSearchResult,
} from "@/lib/supabase";
import { formatRole } from "@/lib/suite-data";

export default function AdminUsuariosPage() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUserSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [admins, setAdmins] = useState<AdminPlatformAdmin[] | null>(null);
  const [newAdmin, setNewAdmin] = useState("");
  const [savingAdmin, setSavingAdmin] = useState(false);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busyUser, setBusyUser] = useState<string | null>(null);

  async function loadUsers(search: string) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setSearching(true);
    try {
      setUsers(await adminSearchUsers(supabase, search));
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setSearching(false);
    }
  }

  async function loadAdmins() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    try {
      setAdmins(await adminListPlatformAdmins(supabase));
    } catch (err) {
      setError(describeAdminError(err));
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ambas cargas se reutilizan tras cada acción
    loadUsers("");
    loadAdmins();
  }, []);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setError("");
    loadUsers(query);
  }

  async function runUserAction(userId: string, action: () => Promise<void>, message: string) {
    setError("");
    setNotice("");
    setBusyUser(userId);
    try {
      await action();
      await loadUsers(query);
      setNotice(message);
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setBusyUser(null);
    }
  }

  function saveName(user: AdminUserSearchResult) {
    runUserAction(
      user.userId,
      async () => {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) return;
        await adminUpdateUserProfile(supabase, user.userId, editName);
      },
      "Nombre actualizado.",
    ).then(() => setEditingUser(null));
  }

  function toggleActive(user: AdminUserSearchResult) {
    if (user.isActive && !window.confirm(`¿Desactivar a ${user.email}? No podrá entrar a ninguna organización.`)) {
      return;
    }
    runUserAction(
      user.userId,
      async () => {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) return;
        await adminSetUserActive(supabase, user.userId, !user.isActive);
      },
      user.isActive ? "Usuario desactivado." : "Usuario reactivado.",
    );
  }

  async function submitAdmin(event: FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setError("");
    setNotice("");
    setSavingAdmin(true);
    try {
      await adminAddPlatformAdmin(supabase, newAdmin);
      setNewAdmin("");
      await loadAdmins();
      setNotice("Administrador agregado. Podrá entrar al panel con ese correo.");
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setSavingAdmin(false);
    }
  }

  async function removeAdmin(email: string) {
    if (!window.confirm(`¿Quitar a ${email} del panel admin?`)) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setError("");
    setNotice("");
    setBusyEmail(email);
    try {
      await adminRemovePlatformAdmin(supabase, email);
      await loadAdmins();
      setNotice("Administrador retirado.");
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setBusyEmail(null);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <span className="section-kicker">DAVALSY / ADMIN</span>
        <h1>Usuarios</h1>
        <p>
          Directorio de todas las personas registradas en la Suite y a qué organizaciones pertenecen.
          Para cambiar roles o invitar gente, entra a la organización correspondiente.
        </p>
      </div>

      {error && <p className="auth-message is-error">{error}</p>}
      {notice && <p className="auth-message is-ok">{notice}</p>}

      <form className="admin-search" onSubmit={submitSearch}>
        <input
          type="search"
          placeholder="Buscar por correo o nombre…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" disabled={searching}>
          {searching ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />} Buscar
        </button>
      </form>

      {!users && !error && <p className="admin-loading">Cargando…</p>}

      {users && (
        <div className="admin-feature-list">
          {users.map((user) => (
            <div key={user.userId} className="admin-feature-row admin-member-row">
              <div>
                {editingUser === user.userId ? (
                  <div className="admin-inline-edit">
                    <input
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      placeholder="Nombre completo"
                    />
                    <button type="button" onClick={() => saveName(user)} disabled={busyUser === user.userId}>
                      <Check size={13} /> Guardar
                    </button>
                    <button type="button" onClick={() => setEditingUser(null)}>Cancelar</button>
                  </div>
                ) : (
                  <strong>{user.fullName || "Sin nombre"}</strong>
                )}
                <span className="admin-feature-key">{user.email}</span>
                {!user.isActive && <p className="admin-owner-note"><Ban size={12} /> Cuenta desactivada: no puede entrar a ninguna organización.</p>}
              </div>

              <div className="admin-user-orgs">
                {user.organizations.length === 0 ? (
                  <span className="status-chip">Sin organización</span>
                ) : (
                  user.organizations.map((org) => (
                    <Link key={org.organizationId} href={`/admin/${org.organizationId}/miembros`} className="admin-user-org">
                      <strong>{org.organizationName}</strong>
                      <span>
                        {formatRole(org.role)}
                        {org.isPrimaryOwner ? " · principal" : ""}
                        {org.status !== "active" ? ` · ${org.status}` : ""}
                      </span>
                    </Link>
                  ))
                )}
              </div>

              <div className="admin-feature-actions">
                <button
                  type="button"
                  disabled={busyUser === user.userId}
                  onClick={() => {
                    setEditingUser(user.userId);
                    setEditName(user.fullName);
                  }}
                >
                  <Pencil size={13} /> Nombre
                </button>
                <button type="button" disabled={busyUser === user.userId} onClick={() => toggleActive(user)}>
                  {user.isActive ? <><Ban size={13} /> Desactivar</> : <><Check size={13} /> Reactivar</>}
                </button>
              </div>
            </div>
          ))}

          {users.length === 0 && <p className="admin-loading">No encontramos usuarios con ese criterio.</p>}
        </div>
      )}

      <h2 className="admin-section-title">Administradores de plataforma</h2>
      <p className="admin-section-note">
        Estos correos pueden entrar a este panel y administrar todas las organizaciones. Se autoriza por
        correo, así que puedes darlo de alta antes de que la persona se registre.
      </p>

      <form className="admin-search" onSubmit={submitAdmin}>
        <input
          type="email"
          required
          placeholder="persona@davalsy.com"
          value={newAdmin}
          onChange={(event) => setNewAdmin(event.target.value)}
        />
        <button type="submit" disabled={savingAdmin}>
          {savingAdmin ? <LoaderCircle className="spin" size={15} /> : <UserPlus size={15} />} Agregar
        </button>
      </form>

      {admins && (
        <div className="admin-feature-list">
          {admins.map((admin) => (
            <div key={admin.email} className="admin-feature-row admin-member-row">
              <div>
                <strong><ShieldUser size={14} /> {admin.email}</strong>
                <span className="admin-feature-key">
                  Desde el {new Date(admin.createdAt).toLocaleDateString("es-MX")}
                </span>
              </div>

              <div className="admin-feature-status">
                <span className={`status-chip ${admin.hasAccount ? "status-full" : ""}`}>
                  {admin.hasAccount ? "Cuenta activa" : "Sin registrarse aún"}
                </span>
              </div>

              <div className="admin-feature-actions">
                <button type="button" disabled={busyEmail === admin.email} onClick={() => removeAdmin(admin.email)}>
                  <Trash2 size={13} /> Quitar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
