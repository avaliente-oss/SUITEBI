"use client";

import { useEffect, useRef, useState } from "react";
import { Headphones } from "lucide-react";
import { useSuite } from "@/lib/suite-context";
import { isSupportChatConfigured, mountSupportChat } from "@/components/support-chat";
import { getSupabaseBrowserClient, listActiveFaqs, type Faq } from "@/lib/supabase";

export default function SoportePage() {
  const { organization, viewer } = useSuite();
  const marco = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">(
    isSupportChatConfigured ? "cargando" : "error",
  );
  const [faqs, setFaqs] = useState<Faq[]>([]);

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

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    let cancelado = false;
    listActiveFaqs(supabase).then((lista) => {
      if (!cancelado) setFaqs(lista);
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
          <span className="soporte-aside-title">PREGUNTAS FRECUENTES</span>

          {faqs.length === 0 ? (
            <p className="soporte-aside-vacio">
              Todavía no hay preguntas publicadas. Escríbenos en el chat y con gusto te ayudamos.
            </p>
          ) : (
            <div className="faq-lista">
              {faqs.map((faq) => (
                <details key={faq.id} className="faq-item">
                  <summary>{faq.question}</summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
