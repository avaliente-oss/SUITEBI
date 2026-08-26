"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  errorText,
  authorizeSolution,
  getSupabaseBrowserClient,
  listActiveSolutions,
  requestSolutionBridgeRedirect,
} from "@/lib/supabase";
import {
  type OrganizationContext,
  type Solution,
  type SolutionId,
  type ViewerContext,
} from "@/lib/suite-data";
import { useAuth } from "@/lib/auth-context";

const demoSolutions: Solution[] = [
  {
    id: "erp",
    name: "DavOps ERP",
    eyebrow: "Operación",
    description: "Administra inventario, compras y operación conectada a tu organización.",
    featureKey: "erp.access",
    action: "erp.access",
    icon: "boxes",
    metric: "Conectado",
    metricLabel: "operación en tiempo real",
    external: true,
  },
];

const accessReasons: Record<string, string> = {
  FEATURE_NOT_INCLUDED: "Esta solución no está incluida en el plan actual.",
  ROLE_NOT_ALLOWED: "Tu rol no permite abrir esta solución.",
  SUBSCRIPTION_INACTIVE: "La suscripción de la organización no está activa.",
  ORGANIZATION_INACTIVE: "La organización se encuentra inactiva.",
  MEMBERSHIP_INACTIVE: "Tu membresía no está activa.",
  WORKSPACE_NOT_ALLOWED: "No tienes acceso al espacio de trabajo solicitado.",
};

type SuiteContextValue = {
  viewer: ViewerContext;
  isDemo: boolean;
  organization: OrganizationContext;
  changeOrganization: (id: string) => void;
  solutions: Solution[];
  activeSolutions: SolutionId[];
  focusedSolution: SolutionId;
  setFocusedSolution: (id: SolutionId) => void;
  workspaceMode: "focus" | "split";
  setWorkspaceMode: (mode: "focus" | "split") => void;
  opening: SolutionId | null;
  toast: string;
  setToast: (message: string) => void;
  availableCount: number;
  openSolution: (solution: Solution) => Promise<void>;
  closeSolution: (id: SolutionId) => void;
  signOut: () => Promise<void>;
};

const SuiteContext = createContext<SuiteContextValue | null>(null);

export function SuiteProvider({
  viewer,
  isDemo,
  children,
}: {
  viewer: ViewerContext;
  isDemo: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const { signOut } = useAuth();
  const [organizationId, setOrganizationId] = useState(viewer.organizations[0]?.id ?? "");
  const [solutions, setSolutions] = useState<Solution[]>(isDemo ? demoSolutions : []);
  const [activeSolutions, setActiveSolutions] = useState<SolutionId[]>([]);
  const [focusedSolution, setFocusedSolution] = useState<SolutionId>("erp");
  const [workspaceMode, setWorkspaceMode] = useState<"focus" | "split">("focus");
  const [toast, setToast] = useState("");
  const [opening, setOpening] = useState<SolutionId | null>(null);

  const organization =
    viewer.organizations.find((item) => item.id === organizationId) ?? viewer.organizations[0];

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (isDemo) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    let cancelled = false;
    listActiveSolutions(supabase)
      .then((loaded) => {
        if (!cancelled) setSolutions(loaded);
      })
      .catch(() => {
        if (!cancelled) setToast("No pudimos cargar el catálogo de soluciones.");
      });
    return () => {
      cancelled = true;
    };
  }, [isDemo]);

  function changeOrganization(id: string) {
    setOrganizationId(id);
    setActiveSolutions([]);
  }

  async function openSolution(solution: Solution) {
    if (!organization) return;

    if (!organization.enabledFeatures.includes(solution.featureKey)) {
      setToast(`${solution.name} no está incluido en el plan ${organization.planName}.`);
      return;
    }

    setOpening(solution.id);
    try {
      if (!isDemo) {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) throw new Error("Supabase no está configurado.");
        const decision = await authorizeSolution(
          supabase,
          organization.id,
          solution.action,
          solution.featureKey,
        );
        if (!decision.allowed) {
          setToast(accessReasons[decision.reason_code] ?? "No tienes acceso a esta solución.");
          return;
        }

        if (solution.external) {
          const { redirectUrl } = await requestSolutionBridgeRedirect(
            supabase,
            organization.id,
            solution.id,
          );
          window.location.href = redirectUrl;
          return;
        }
      } else if (solution.external) {
        setToast(`${solution.name} no está disponible en modo demo.`);
        return;
      }

      setActiveSolutions((current) =>
        current.includes(solution.id) ? current : [...current, solution.id],
      );
      setFocusedSolution(solution.id);
      setToast(`${solution.name} ya está lista en tu mesa de trabajo.`);
      router.push("/mesa-activa");
    } catch (error) {
      setToast(errorText(error) || "No pudimos abrir la solución.");
    } finally {
      setOpening(null);
    }
  }

  function closeSolution(solutionId: SolutionId) {
    setActiveSolutions((current) => {
      const next = current.filter((id) => id !== solutionId);
      if (solutionId === focusedSolution && next.length) setFocusedSolution(next[0]);
      return next;
    });
  }

  if (!organization) return null;

  const availableCount = solutions.filter((solution) =>
    organization.enabledFeatures.includes(solution.featureKey),
  ).length;

  return (
    <SuiteContext.Provider
      value={{
        viewer,
        isDemo,
        organization,
        changeOrganization,
        solutions,
        activeSolutions,
        focusedSolution,
        setFocusedSolution,
        workspaceMode,
        setWorkspaceMode,
        opening,
        toast,
        setToast,
        availableCount,
        openSolution,
        closeSolution,
        signOut,
      }}
    >
      {children}
    </SuiteContext.Provider>
  );
}

export function useSuite() {
  const ctx = useContext(SuiteContext);
  if (!ctx) throw new Error("useSuite debe usarse dentro de SuiteProvider");
  return ctx;
}
