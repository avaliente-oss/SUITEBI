"use client";

import { type ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { SuiteProvider } from "@/lib/suite-context";
import { EmptyOrganization, LoadingScreen } from "@/components/suite-ui";
import { SuiteShell } from "@/components/suite-shell";

export default function SuiteLayout({ children }: { children: ReactNode }) {
  const { phase, viewer, isDemo, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (phase === "signed_out") router.replace("/");
  }, [phase, router]);

  if (phase === "loading" || phase === "signed_out" || !viewer) return <LoadingScreen />;

  if (viewer.organizations.length === 0) {
    return <EmptyOrganization viewer={viewer} onSignOut={signOut} />;
  }

  return (
    <SuiteProvider viewer={viewer} isDemo={isDemo}>
      <SuiteShell>{children}</SuiteShell>
    </SuiteProvider>
  );
}
