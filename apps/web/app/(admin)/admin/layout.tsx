"use client";

import { type ReactNode, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Boxes, Building2, CreditCard, MessageCircleQuestion, ShieldUser, Users } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { BrandMark, LoadingScreen } from "@/components/suite-ui";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { phase, viewer, isPlatformAdmin, isDemo } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (phase === "signed_out") {
      router.replace("/");
      return;
    }
    if (phase === "signed_in" && (!isPlatformAdmin || isDemo)) {
      router.replace("/lobby");
    }
  }, [phase, isPlatformAdmin, isDemo, router]);

  if (phase !== "signed_in" || !viewer || !isPlatformAdmin || isDemo) return <LoadingScreen />;

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <BrandMark compact />
        <span className="admin-badge"><ShieldUser size={14} /> Panel admin DAVALSY</span>
        <Link href="/lobby" className="admin-back"><ArrowLeft size={15} /> Volver a la Suite</Link>
      </header>
      <nav className="admin-subnav">
        <Link href="/admin" className={pathname === "/admin" ? "active" : ""}>
          <Building2 size={15} /> Organizaciones
        </Link>
        <Link href="/admin/soluciones" className={pathname?.startsWith("/admin/soluciones") ? "active" : ""}>
          <Boxes size={15} /> Soluciones
        </Link>
        <Link href="/admin/planes" className={pathname?.startsWith("/admin/planes") ? "active" : ""}>
          <CreditCard size={15} /> Planes
        </Link>
        <Link href="/admin/usuarios" className={pathname?.startsWith("/admin/usuarios") ? "active" : ""}>
          <Users size={15} /> Usuarios
        </Link>
        <Link href="/admin/ayuda" className={pathname?.startsWith("/admin/ayuda") ? "active" : ""}>
          <MessageCircleQuestion size={15} /> Ayuda
        </Link>
      </nav>
      <div className="admin-content">{children}</div>
    </main>
  );
}
