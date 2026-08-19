"use client";

import { type ReactNode, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldUser } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { BrandMark, LoadingScreen } from "@/components/suite-ui";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { phase, viewer, isPlatformAdmin, isDemo } = useAuth();
  const router = useRouter();

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
      <div className="admin-content">{children}</div>
    </main>
  );
}
