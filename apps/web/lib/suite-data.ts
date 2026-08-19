export type SolutionId = string;

/** Íconos curados: deben existir como entrada en solutionIcons (components/suite-ui.tsx). */
export const SOLUTION_ICON_OPTIONS = [
  "boxes",
  "chart",
  "users",
  "database",
  "sparkles",
  "bell",
  "file",
  "globe",
  "settings",
  "truck",
] as const;

export type SolutionIcon = (typeof SOLUTION_ICON_OPTIONS)[number];

export type Solution = {
  id: SolutionId;
  name: string;
  eyebrow: string;
  description: string;
  featureKey: string;
  action: string;
  icon: SolutionIcon;
  metric: string;
  metricLabel: string;
  externalUrl?: string | null;
  /** Apps que viven fuera de la Suite (otro dominio) y se abren vía puente de sesión, no en la mesa activa. */
  external?: boolean;
};

export type OrganizationContext = {
  id: string;
  name: string;
  slug: string;
  role: string;
  planId: string;
  planName: string;
  accessStatus: string;
  renewalDate: string | null;
  enabledFeatures: string[];
};

export type ViewerContext = {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  organizations: OrganizationContext[];
};

export const news = [
  {
    tag: "Producto",
    title: "Forecast AI ahora explica cada recomendación",
    excerpt: "Más contexto, supuestos visibles y acciones sugeridas para tu equipo.",
    date: "12 AGO",
    tone: "lime",
  },
  {
    tag: "DAVALSY Lab",
    title: "Nueva guía: de hojas dispersas a una operación conectada",
    excerpt: "Un marco práctico para construir una sola versión de la verdad.",
    date: "08 AGO",
    tone: "cyan",
  },
  {
    tag: "Comunidad",
    title: "Sesión privada: decisiones con datos para líderes",
    excerpt: "Acompáñanos el 22 de agosto en una conversación sin humo.",
    date: "04 AGO",
    tone: "coral",
  },
];

export const demoViewer: ViewerContext = {
  id: "demo-user",
  email: "alberto@davalsy.com",
  fullName: "Alberto Valiente",
  avatarUrl: null,
  organizations: [
    {
      id: "demo-org",
      name: "DAVALSY Solutions",
      slug: "davalsy-solutions",
      role: "owner",
      planId: "business",
      planName: "Business",
      accessStatus: "full",
      renewalDate: "2026-09-15",
      enabledFeatures: [
        "core.read",
        "dashboards",
        "users",
        "data_sources",
        "daily_refreshes",
        "dashboard.export",
        "alerts",
        "ai.analysis",
        "api.access",
      ],
    },
    {
      id: "demo-org-2",
      name: "Norte Industrial",
      slug: "norte-industrial",
      role: "analyst",
      planId: "starter",
      planName: "Starter",
      accessStatus: "trial",
      renewalDate: "2026-08-30",
      enabledFeatures: ["core.read", "dashboards", "users", "data_sources", "daily_refreshes"],
    },
  ],
};

export function formatRole(role: string) {
  const roles: Record<string, string> = {
    owner: "Propietario",
    co_owner: "Copropietario",
    admin: "Administrador",
    analyst: "Analista",
    editor: "Editor",
    viewer: "Consulta",
    external_viewer: "Invitado",
  };

  return roles[role] ?? role;
}
