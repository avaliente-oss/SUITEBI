export type SolutionId =
  | "command"
  | "connect"
  | "forecast"
  | "alerts"
  | "exports"
  | "developer"
  | "erp";

export type Solution = {
  id: SolutionId;
  name: string;
  eyebrow: string;
  description: string;
  featureKey: string;
  action: string;
  icon: "chart" | "database" | "sparkles" | "bell" | "file" | "code" | "boxes";
  metric: string;
  metricLabel: string;
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

export const solutions: Solution[] = [
  {
    id: "command",
    name: "Command Center",
    eyebrow: "Business intelligence",
    description: "KPIs, tableros ejecutivos y señales críticas en una sola vista.",
    featureKey: "core.read",
    action: "dashboard.view",
    icon: "chart",
    metric: "+18.4%",
    metricLabel: "rendimiento mensual",
  },
  {
    id: "connect",
    name: "Data Connect",
    eyebrow: "Integraciones",
    description: "Conecta, supervisa y refresca tus fuentes de datos operativas.",
    featureKey: "data_sources",
    action: "data_sources.connect",
    icon: "database",
    metric: "8/10",
    metricLabel: "fuentes conectadas",
  },
  {
    id: "forecast",
    name: "Forecast AI",
    eyebrow: "Inteligencia aumentada",
    description: "Detecta tendencias, riesgos y oportunidades antes de que ocurran.",
    featureKey: "ai.analysis",
    action: "ai.use",
    icon: "sparkles",
    metric: "87%",
    metricLabel: "confianza del modelo",
  },
  {
    id: "alerts",
    name: "Signal Desk",
    eyebrow: "Monitoreo",
    description: "Automatiza alertas y responde rápido a cambios importantes.",
    featureKey: "alerts",
    action: "alerts.manage",
    icon: "bell",
    metric: "3",
    metricLabel: "señales abiertas",
  },
  {
    id: "exports",
    name: "Report Studio",
    eyebrow: "Distribución",
    description: "Prepara y comparte entregables claros con cada equipo.",
    featureKey: "dashboard.export",
    action: "report.export",
    icon: "file",
    metric: "24",
    metricLabel: "reportes este mes",
  },
  {
    id: "developer",
    name: "Developer Hub",
    eyebrow: "Automatización",
    description: "Opera la suite desde tus sistemas con acceso seguro a la API.",
    featureKey: "api.access",
    action: "api.use",
    icon: "code",
    metric: "99.98%",
    metricLabel: "disponibilidad API",
  },
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
