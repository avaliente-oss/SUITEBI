"use client";

import Link from "next/link";
import { ArrowRight, Command, ExternalLink, Sparkles, Zap } from "lucide-react";
import { news, solutions } from "@/lib/suite-data";
import { useSuite } from "@/lib/suite-context";
import { SolutionCard } from "@/components/suite-ui";

const todayLabel = new Date()
  .toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })
  .toUpperCase();

export default function LobbyPage() {
  const { organization, activeSolutions, opening, availableCount, openSolution, setToast } = useSuite();

  return (
    <>
      <section className="welcome-row" id="welcome-row">
        <div>
          <span className="today-label"><i /> {todayLabel}</span>
          <h1>Tu negocio está en movimiento.</h1>
          <p>Estas son las soluciones listas para trabajar contigo hoy.</p>
        </div>
        <div className="plan-card">
          <span className="plan-icon"><Zap size={17} /></span>
          <div><small>PLAN ACTUAL</small><strong>{organization.planName}</strong></div>
          <span className={`status-chip status-${organization.accessStatus}`}>{organization.accessStatus === "trial" ? "Prueba" : "Activo"}</span>
          <Link href="/plan">Administrar</Link>
        </div>
      </section>

      <section className="pulse-strip">
        <div className="pulse-intro"><span><Command size={17} /></span><div><small>PULSO DAVALSY</small><strong>Todo bajo control</strong></div></div>
        <div className="pulse-stat"><small>SOLUCIONES ACTIVAS</small><strong>{availableCount}<span> / {solutions.length}</span></strong></div>
        <div className="pulse-stat positive"><small>ESTADO DE DATOS</small><strong><i /> Saludable</strong></div>
        <button onClick={() => setToast("El registro de actividad todavía no está disponible.")}>
          <ExternalLink size={15} /> Ver actividad
        </button>
      </section>

      <div className="dashboard-grid">
        <section className="solutions-section" id="solutions-section">
          <div className="section-heading">
            <div><span className="section-kicker">TU SUITE</span><h2>Soluciones disponibles</h2></div>
            <Link href="/soluciones">Ver catálogo <ArrowRight size={16} /></Link>
          </div>
          <div className="solution-grid">
            {solutions.map((solution, index) => (
              <SolutionCard
                key={solution.id}
                solution={solution}
                enabled={organization.enabledFeatures.includes(solution.featureKey)}
                open={activeSolutions.includes(solution.id)}
                opening={opening === solution.id}
                index={index}
                onOpen={() => openSolution(solution)}
              />
            ))}
          </div>
        </section>

        <aside className="news-panel">
          <div className="section-heading compact">
            <div><span className="section-kicker">AL DÍA</span><h2>Noticias DAVALSY</h2></div>
            <button
              aria-label="Ver todas las noticias"
              onClick={() => setToast("El listado completo de noticias todavía no está disponible.")}
            >
              <ArrowRight size={17} />
            </button>
          </div>
          <article className="featured-news">
            <div className="news-visual"><span>NUEVO</span><Sparkles size={31} /><b>AI</b></div>
            <div className="news-copy">
              <span>DESTACADO · 3 MIN</span>
              <h3>La inteligencia que explica, no sólo predice.</h3>
              <p>Conoce la nueva generación de análisis DAVALSY.</p>
              <button onClick={() => setToast("Esta nota todavía no está publicada.")}>
                Descubrir más <ArrowRight size={15} />
              </button>
            </div>
          </article>
          <div className="news-list">
            {news.map((item) => (
              <article key={item.title}>
                <time><strong>{item.date.split(" ")[0]}</strong><span>{item.date.split(" ")[1]}</span></time>
                <div><span className={`news-tag ${item.tone}`}>{item.tag}</span><h3>{item.title}</h3><p>{item.excerpt}</p></div>
              </article>
            ))}
          </div>
          <button
            className="all-news"
            onClick={() => setToast("El listado completo de noticias todavía no está disponible.")}
          >
            Ver todas las novedades <ArrowRight size={16} />
          </button>
        </aside>
      </div>
    </>
  );
}
