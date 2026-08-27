"use client";

import { ShieldUser, User } from "lucide-react";
import { describeAuditAction, type AuditEntry } from "@/lib/supabase";

function cuando(iso: string) {
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Detalles útiles de la metadata, sin volcar el JSON crudo en pantalla. */
function detalle(entrada: AuditEntry): string | null {
  const m = entrada.metadata ?? {};
  const partes: string[] = [];

  if (typeof m.email === "string") partes.push(m.email);
  if (typeof m.role === "string") partes.push(`rol ${m.role}`);
  if (typeof m.from === "string" && typeof m.to === "string") partes.push(`${m.from} → ${m.to}`);
  if (typeof m.plan_id === "string") partes.push(`plan ${m.plan_id}`);
  if (typeof m.name === "string") partes.push(m.name);
  if (typeof m.status === "string") partes.push(m.status);

  return partes.length ? partes.join(" · ") : null;
}

export function AuditLog({ entradas }: { entradas: AuditEntry[] }) {
  if (entradas.length === 0) {
    return <p className="admin-loading">Todavía no hay movimientos registrados.</p>;
  }

  return (
    <div className="audit-lista">
      {entradas.map((entrada) => {
        const extra = detalle(entrada);
        return (
          <div key={entrada.id} className="audit-fila">
            <span className={`audit-icono ${entrada.isPlatform ? "is-platform" : ""}`}>
              {entrada.isPlatform ? <ShieldUser size={14} /> : <User size={14} />}
            </span>
            <div>
              <strong>{describeAuditAction(entrada.action)}</strong>
              {extra && <small>{extra}</small>}
            </div>
            <div className="audit-meta">
              <span>{entrada.actor}</span>
              <time>{cuando(entrada.occurredAt)}</time>
            </div>
          </div>
        );
      })}
    </div>
  );
}
