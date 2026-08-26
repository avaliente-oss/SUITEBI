"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CreditCard, Headphones, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { useSuite } from "@/lib/suite-context";
import { isSupportChatConfigured, mountSupportChat } from "@/components/support-chat";

const atajos = [
  {
    href: "/equipo",
    icon: ShieldCheck,
    titulo: "Invitar a tu equipo",
    texto: "Suma personas, cambia sus roles o quita accesos.",
  },
  {
    href: "/plan",
    icon: CreditCard,
    titulo: "Cambiar de plan",
    texto: "Compara lo que incluye cada uno y cámbialo tú mismo.",
  },
  {
    href: "/cuenta",
    icon: KeyRound,
    titulo: "Cambiar tu contraseña",
    texto: "Actualiza tus datos y tu contraseña desde tu cuenta.",
  },
];

export default function SoportePage() {
  const { organization, viewer } = useSuite();
  const marco = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">(
    isSupportChatConfigured ? "cargando" : "error",
  );

  useEffect(() => {
    if (!isSupportChatConfigured || !marco.current) return;
    let cancelado = false;

    mountSupportChat(marco.current)
      .then((ok) => {
        if (!cancelado) setEstado(ok ? "listo" : "error");
      })
      .catch(() => {
        if (!cancelado) setEstado("error");
      });

    return () => {
      cancelado = true;
    };
  }, []);

  return (
    <>
      <section className="welcome-row" id="welcome-row">
        <div>
          <span className="today-label"><i /> SOPORTE</span>
          <h1>¿En qué te ayudamos?</h1>
          <p>Resolvemos dudas rápidas aquí mismo. Si hace falta una persona del equipo, la avisamos.</p>
        </div>
        <div className="plan-card">
          <span className="plan-icon"><Headphones size={17} /></span>
          <div>
            <small>ESCRIBES COMO</small>
            <strong>{viewer.fullName}</strong>
          </div>
          <span className="status-chip">{organization.name}</span>
        </div>
      </section>

      <div className="soporte-grid">
        <div className="soporte-marco" ref={marco}>
          {estado === "cargando" && <p className="soporte-cargando">Abriendo el chat…</p>}
          {estado === "error" && (
            <p className="soporte-cargando">
              El chat no está disponible en este momento.
              <br />
              Escríbenos a <strong>soporte@davalsy.com</strong> y te respondemos por ahí.
            </p>
          )}
        </div>

        <aside className="soporte-aside">
          <span className="soporte-aside-title">RESUÉLVELO TÚ MISMO</span>
          {atajos.map((atajo) => {
            const Icono = atajo.icon;
            return (
              <Link key={atajo.href} href={atajo.href} className="soporte-tarjeta">
                <span className="icono"><Icono size={17} /></span>
                <span>
                  <strong>{atajo.titulo}</strong>
                  <small>{atajo.texto}</small>
                </span>
              </Link>
            );
          })}

          <span className="soporte-aside-title">¿PREFIERES CORREO?</span>
          <a
            className="soporte-tarjeta"
            href={`mailto:soporte@davalsy.com?subject=${encodeURIComponent(
              `Soporte · ${organization.name}`,
            )}&body=${encodeURIComponent(
              `\n\n---\nOrganización: ${organization.name}\nPlan: ${organization.planName}\nUsuario: ${viewer.fullName} (${viewer.email})`,
            )}`}
          >
            <span className="icono"><Mail size={17} /></span>
            <span>
              <strong>soporte@davalsy.com</strong>
              <small>Se abre con los datos de tu cuenta ya escritos.</small>
            </span>
          </a>
        </aside>
      </div>
    </>
  );
}
