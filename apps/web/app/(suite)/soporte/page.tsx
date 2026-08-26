"use client";

import { useEffect, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";
import { useSuite } from "@/lib/suite-context";
import { isSupportChatConfigured, mountSupportChat } from "@/components/support-chat";

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
          <h1>Hablar con DAVALSY.</h1>
          <p>
            Resolvemos dudas rápidas aquí mismo. Si el tema necesita a una persona del equipo, desde
            aquí se avisa.
          </p>
        </div>
        <div className="plan-card">
          <span className="plan-icon"><CircleHelp size={17} /></span>
          <div>
            <small>ESCRIBES COMO</small>
            <strong>{viewer.fullName}</strong>
          </div>
          <span className="status-chip">{organization.name}</span>
        </div>
      </section>

      <div className="soporte-marco" ref={marco}>
        {estado === "cargando" && <p className="soporte-cargando">Abriendo el chat…</p>}
        {estado === "error" && (
          <p className="soporte-cargando">
            No pudimos cargar el chat. Escríbenos a <strong>soporte@davalsy.com</strong> y te
            respondemos por ahí.
          </p>
        )}
      </div>
    </>
  );
}
