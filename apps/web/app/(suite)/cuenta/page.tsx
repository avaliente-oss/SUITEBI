"use client";

import { FormEvent, useState } from "react";
import { Check, KeyRound, User } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useSuite } from "@/lib/suite-context";
import { getSupabaseBrowserClient, updateFullName, updatePassword } from "@/lib/supabase";
import { formatRole } from "@/lib/suite-data";

export default function CuentaPage() {
  const { viewer, refreshViewer } = useAuth();
  const { organization, isDemo } = useSuite();

  const [fullName, setFullName] = useState(viewer?.fullName ?? "");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMessage, setNameMessage] = useState("");
  const [nameError, setNameError] = useState("");

  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");

  if (!viewer) return null;

  async function submitName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNameError("");
    setNameMessage("");

    if (isDemo) {
      setNameError("El modo demo no permite guardar cambios.");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setNameBusy(true);
    try {
      await updateFullName(supabase, fullName.trim());
      await refreshViewer();
      setNameMessage("Tu nombre se actualizó.");
    } catch (error) {
      setNameError(error instanceof Error ? error.message : "No pudimos actualizar tu nombre.");
    } finally {
      setNameBusy(false);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    setPasswordMessage("");

    if (isDemo) {
      setPasswordError("El modo demo no permite guardar cambios.");
      return;
    }

    if (password.length < 8) {
      setPasswordError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    if (password !== passwordConfirm) {
      setPasswordError("Las contraseñas no coinciden.");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setPasswordBusy(true);
    try {
      await updatePassword(supabase, password);
      setPassword("");
      setPasswordConfirm("");
      setPasswordMessage("Tu contraseña se actualizó.");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "No pudimos actualizar tu contraseña.");
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <>
      <section className="welcome-row" id="welcome-row">
        <div>
          <span className="today-label"><i /> TU CUENTA</span>
          <h1>Mi cuenta.</h1>
          <p>Administra tu nombre, tu contraseña y revisa tu rol en la organización.</p>
        </div>
      </section>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon"><User size={18} /></span>
            <div>
              <h2>Perfil</h2>
              <p>Así te van a ver el resto de personas de tu organización.</p>
            </div>
          </div>

          <form onSubmit={submitName} className="settings-form">
            <label htmlFor="account-email">Correo</label>
            <input id="account-email" type="email" value={viewer.email} disabled />

            <label htmlFor="account-name">Nombre completo</label>
            <input
              id="account-name"
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
              disabled={isDemo}
            />

            <label htmlFor="account-role">Rol en {organization.name}</label>
            <input id="account-role" type="text" value={formatRole(organization.role)} disabled />

            {(nameError || nameMessage) && (
              <p className={`auth-message ${nameError ? "is-error" : ""}`}>{nameError || nameMessage}</p>
            )}

            <button className="primary-login settings-submit" type="submit" disabled={nameBusy || isDemo}>
              {nameBusy ? "Guardando..." : "Guardar cambios"}
              {!nameBusy && <Check size={16} />}
            </button>
          </form>
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <span className="settings-icon"><KeyRound size={18} /></span>
            <div>
              <h2>Contraseña</h2>
              <p>Usa una contraseña de al menos 8 caracteres.</p>
            </div>
          </div>

          <form onSubmit={submitPassword} className="settings-form">
            <label htmlFor="account-password">Nueva contraseña</label>
            <input
              id="account-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
              disabled={isDemo}
            />

            <label htmlFor="account-password-confirm">Confirmar contraseña</label>
            <input
              id="account-password-confirm"
              type="password"
              autoComplete="new-password"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
              minLength={8}
              required
              disabled={isDemo}
            />

            {(passwordError || passwordMessage) && (
              <p className={`auth-message ${passwordError ? "is-error" : ""}`}>
                {passwordError || passwordMessage}
              </p>
            )}

            <button className="primary-login settings-submit" type="submit" disabled={passwordBusy || isDemo}>
              {passwordBusy ? "Guardando..." : "Actualizar contraseña"}
              {!passwordBusy && <Check size={16} />}
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
