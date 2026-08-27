"use client";

import { type ReactNode, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  CreditCard,
  GalleryHorizontalEnd,
  Headphones,
  LayoutDashboard,
  Blocks,
  LogOut,
  Menu,
  MessageSquareText,
  Search,
  ShieldCheck,
  ShieldUser,
  User,
  X,
} from "lucide-react";
import { formatRole } from "@/lib/suite-data";
import { useAuth } from "@/lib/auth-context";
import { useSuite } from "@/lib/suite-context";
import { Avatar, BrandMark } from "@/components/suite-ui";

type NavItem = {
  href: "/lobby" | "/mesa-activa" | "/soluciones" | "/cuenta" | "/plan" | "/equipo" | "/soporte" | "/actividad";
  label: string;
  icon: typeof LayoutDashboard;
  shortcut?: string;
};

const navItems: NavItem[] = [
  { href: "/lobby", label: "Lobby", icon: LayoutDashboard, shortcut: "⌘1" },
  { href: "/mesa-activa", label: "Mesa activa", icon: GalleryHorizontalEnd },
  { href: "/soluciones", label: "Todas las soluciones", icon: Blocks },
];

const accountNavItems: NavItem[] = [
  { href: "/cuenta", label: "Mi cuenta", icon: User },
  { href: "/plan", label: "Plan y facturación", icon: CreditCard },
];

export function SuiteShell({ children }: { children: ReactNode }) {
  const {
    viewer,
    isDemo,
    organization,
    changeOrganization,
    activeSolutions,
    toast,
    setToast,
    signOut,
  } = useSuite();
  const { isPlatformAdmin } = useAuth();
  const [mobileNav, setMobileNav] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.replace("/");
  }

  function notReady(label: string) {
    setToast(`${label} todavía no está disponible. Lo estamos construyendo.`);
  }


  return (
    <main className="suite-shell">
      <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
        <div className="sidebar-head">
          <BrandMark compact />
          <button className="close-mobile" onClick={() => setMobileNav(false)} aria-label="Cerrar menú"><X size={19} /></button>
        </div>

        <nav className="primary-nav" aria-label="Navegación principal">
          <span className="nav-label">ESPACIO</span>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "active" : ""}
                onClick={() => setMobileNav(false)}
              >
                <Icon size={18} /> {item.label}
                {item.shortcut ? <span>{item.shortcut}</span> : null}
                {item.href === "/mesa-activa" ? <b>{activeSolutions.length}</b> : null}
              </Link>
            );
          })}

          <span className="nav-label second">CUENTA</span>
          {accountNavItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "active" : ""}
                onClick={() => setMobileNav(false)}
              >
                <Icon size={18} /> {item.label}
              </Link>
            );
          })}

          <span className="nav-label second">ORGANIZACIÓN</span>
          <button onClick={() => notReady("Noticias DAVALSY")}><MessageSquareText size={18} /> Noticias DAVALSY <i /></button>
          <button onClick={() => notReady("Recursos")}><BookOpen size={18} /> Recursos</button>
          <Link href="/equipo" className={pathname === "/equipo" ? "active" : ""}>
            <ShieldCheck size={18} /> Equipo y accesos
          </Link>
          <Link href="/actividad" className={pathname === "/actividad" ? "active" : ""}>
            <Activity size={18} /> Actividad
          </Link>

          {isPlatformAdmin && (
            <>
              <span className="nav-label second">DAVALSY</span>
              <Link href="/admin" className={pathname.startsWith("/admin") ? "active" : ""}>
                <ShieldUser size={18} /> Panel admin
              </Link>
            </>
          )}
        </nav>

        <div className="sidebar-support">
          <Link
            href="/soporte"
            className={`support-cta ${pathname === "/soporte" ? "active" : ""}`}
            onClick={() => setMobileNav(false)}
          >
            <Headphones size={17} /> Hablar con DAVALSY
          </Link>
        </div>

        <div className="sidebar-profile">
          <Avatar viewer={viewer} />
          <div><strong>{viewer.fullName}</strong><span>{formatRole(organization.role)}</span></div>
          <button onClick={handleSignOut} title="Cerrar sesión" aria-label="Cerrar sesión"><LogOut size={17} /></button>
        </div>
      </aside>

      <section className="suite-main">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Abrir menú"><Menu size={21} /></button>
          <div className="organization-picker">
            <span className="org-monogram">{organization.name.charAt(0)}</span>
            <div><small>ORGANIZACIÓN</small><strong>{organization.name}</strong></div>
            {viewer.organizations.length > 1 && (
              <select
                aria-label="Cambiar organización"
                value={organization.id}
                onChange={(event) => changeOrganization(event.target.value)}
              >
                {viewer.organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            )}
            <ChevronDown size={16} />
          </div>

          <button className="command-search" onClick={() => notReady("El buscador de la suite")}>
            <Search size={17} /><span>Buscar en la suite</span><kbd>⌘ K</kbd>
          </button>

          <div className="topbar-actions">
            {isDemo && <span className="demo-badge">MODO DEMO</span>}
            <button
              aria-label="Notificaciones"
              className="icon-button"
              onClick={() => notReady("El centro de notificaciones")}
            >
              <Bell size={19} /><i />
            </button>
            <Link href="/cuenta" aria-label="Mi cuenta">
              <Avatar viewer={viewer} small />
            </Link>
          </div>
        </header>

        <div className="dashboard-content">{children}</div>
      </section>

      {toast && <div className="toast"><span><Check size={16} /></span>{toast}<button onClick={() => setToast("")} aria-label="Cerrar aviso"><X size={15} /></button></div>}
    </main>
  );
}
