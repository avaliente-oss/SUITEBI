"use client";

import { solutions } from "@/lib/suite-data";
import { useSuite } from "@/lib/suite-context";
import { SolutionCard } from "@/components/suite-ui";

export default function SolucionesPage() {
  const { organization, activeSolutions, opening, openSolution } = useSuite();

  return (
    <section className="solutions-section" id="solutions-section">
      <div className="section-heading">
        <div>
          <span className="section-kicker">TU SUITE</span>
          <h2>Todas las soluciones</h2>
        </div>
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
  );
}
