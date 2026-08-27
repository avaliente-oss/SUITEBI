"use client";

import { TrendingUp, TriangleAlert, Users } from "lucide-react";
import type { UsageSummary } from "@/lib/supabase";

const motivos: Record<string, string> = {
  FEATURE_NOT_INCLUDED: "no incluida en el plan",
  ROLE_NOT_ALLOWED: "el rol no lo permite",
  SUBSCRIPTION_INACTIVE: "suscripción inactiva",
  ORGANIZATION_INACTIVE: "organización inactiva",
  MEMBERSHIP_INACTIVE: "membresía inactiva",
  UNAUTHENTICATED: "sin sesión",
};

function fecha(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

/**
 * Panel de uso. Mide FRECUENCIA de apertura, no tiempo de sesión: la
 * Suite firma el acceso y redirige, así que nunca sabe cuándo salió el
 * usuario de la app externa.
 */
export function UsagePanel({ datos }: { datos: UsageSummary }) {
  const maximo = Math.max(1, ...datos.daily.map((d) => d.opens));

  return (
    <>
      <div className="uso-metricas">
        <div className="uso-metrica">
          <span className="uso-icono"><TrendingUp size={16} /></span>
          <div>
            <small>APERTURAS</small>
            <strong>{datos.totalOpens}</strong>
            <span>últimos {datos.days} días</span>
          </div>
        </div>
        <div className="uso-metrica">
          <span className="uso-icono"><Users size={16} /></span>
          <div>
            <small>PERSONAS ACTIVAS</small>
            <strong>{datos.activeUsers}</strong>
            <span>abrieron al menos una solución</span>
          </div>
        </div>
        <div className={`uso-metrica ${datos.deniedCount > 0 ? "is-alerta" : ""}`}>
          <span className="uso-icono"><TriangleAlert size={16} /></span>
          <div>
            <small>ACCESOS RECHAZADOS</small>
            <strong>{datos.deniedCount}</strong>
            <span>{datos.deniedCount > 0 ? "alguien intentó y no pudo" : "sin fricción"}</span>
          </div>
        </div>
      </div>

      {datos.totalOpens === 0 ? (
        <p className="admin-loading">
          Todavía no hay aperturas registradas en este periodo. En cuanto alguien entre a una
          solución, aparecerá aquí.
        </p>
      ) : (
        <>
          <section className="settings-card plan-section">
            <div className="settings-card-head">
              <div>
                <h2>Aperturas por día</h2>
                <p>Cada barra es un día. Sirve para ver si el uso se sostiene o se enfría.</p>
              </div>
            </div>
            <div className="uso-barras" role="img" aria-label="Aperturas por día">
              {datos.daily.map((d) => (
                <i
                  key={d.day}
                  style={{ height: `${Math.max(3, (d.opens / maximo) * 100)}%` }}
                  title={`${fecha(d.day)}: ${d.opens} ${d.opens === 1 ? "apertura" : "aperturas"}`}
                />
              ))}
            </div>
          </section>

          <div className="uso-columnas">
            <section className="settings-card">
              <div className="settings-card-head">
                <div><h2>Por solución</h2><p>Cuáles se usan de verdad.</p></div>
              </div>
              <div className="uso-lista">
                {datos.bySolution.map((s) => (
                  <div key={s.name} className="uso-fila">
                    <div>
                      <strong>{s.name}</strong>
                      <small>{s.users} {s.users === 1 ? "persona" : "personas"} · última vez {fecha(s.lastUsed)}</small>
                    </div>
                    <span className="status-chip status-full">{s.opens}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="settings-card">
              <div className="settings-card-head">
                <div><h2>Quién la usa</h2><p>Las personas más activas del periodo.</p></div>
              </div>
              <div className="uso-lista">
                {datos.byUser.map((u) => (
                  <div key={u.name} className="uso-fila">
                    <div>
                      <strong>{u.name}</strong>
                      <small>última vez {fecha(u.lastUsed)}</small>
                    </div>
                    <span className="status-chip">{u.opens}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}

      {datos.denied.length > 0 && (
        <section className="settings-card plan-section">
          <div className="settings-card-head">
            <div>
              <h2>Dónde se están topando</h2>
              <p>Intentos que no prosperaron. Suelen ser la señal más útil de todo el panel.</p>
            </div>
          </div>
          <div className="uso-lista">
            {datos.denied.map((d, i) => (
              <div key={`${d.name}-${d.motivo}-${i}`} className="uso-fila">
                <div>
                  <strong>{d.name}</strong>
                  <small>{motivos[d.motivo] ?? d.motivo}</small>
                </div>
                <span className="status-chip status-trial">{d.veces}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
