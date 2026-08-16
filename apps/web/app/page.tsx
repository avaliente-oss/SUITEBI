"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { LoadingScreen } from "@/components/suite-ui";
import { LoginScreen } from "@/components/login-screen";

export default function Home() {
  const { phase, authError, refreshViewer, enterDemo } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (phase === "signed_in") router.replace("/lobby");
  }, [phase, router]);

  if (phase === "loading" || phase === "signed_in") return <LoadingScreen />;

  return <LoginScreen error={authError} onAuthenticated={refreshViewer} onDemo={enterDemo} />;
}
