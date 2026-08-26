"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  errorText,
  checkPlatformAdmin,
  completePendingOrganizationSetup,
  getSupabaseBrowserClient,
  isSupabaseConfigured,
  loadViewerContext,
} from "@/lib/supabase";
import { demoViewer, type ViewerContext } from "@/lib/suite-data";

export type AppPhase = "loading" | "signed_out" | "signed_in";

type AuthContextValue = {
  phase: AppPhase;
  viewer: ViewerContext | null;
  authError: string;
  isDemo: boolean;
  isPlatformAdmin: boolean;
  refreshViewer: () => Promise<void>;
  enterDemo: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AppPhase>(isSupabaseConfigured ? "loading" : "signed_out");
  const [viewer, setViewer] = useState<ViewerContext | null>(null);
  const [authError, setAuthError] = useState("");
  const [isDemo, setIsDemo] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    if (!supabase) return;

    let active = true;

    const hydrate = async () => {
      try {
        await completePendingOrganizationSetup(supabase);
        const [context, adminStatus] = await Promise.all([
          loadViewerContext(supabase),
          checkPlatformAdmin(supabase),
        ]);
        if (!active) return;
        setViewer(context);
        setIsPlatformAdmin(adminStatus);
        setPhase("signed_in");
        setAuthError("");
      } catch (error) {
        if (!active) return;
        setViewer(null);
        setPhase("signed_out");
        setAuthError(errorText(error) || "No pudimos cargar tu cuenta.");
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) hydrate();
      else setPhase("signed_out");
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session) hydrate();
      else {
        setViewer(null);
        setPhase("signed_out");
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  async function refreshViewer() {
    if (!supabase) return;
    setPhase("loading");
    try {
      await completePendingOrganizationSetup(supabase);
      setViewer(await loadViewerContext(supabase));
      setPhase("signed_in");
      setAuthError("");
      setIsPlatformAdmin(await checkPlatformAdmin(supabase));
    } catch (error) {
      setPhase("signed_out");
      setAuthError(errorText(error) || "No pudimos cargar tu cuenta.");
    }
  }

  function enterDemo() {
    setViewer(demoViewer);
    setIsDemo(true);
    setIsPlatformAdmin(false);
    setPhase("signed_in");
  }

  async function signOut() {
    if (!isDemo && supabase) await supabase.auth.signOut();
    setViewer(null);
    setIsDemo(false);
    setIsPlatformAdmin(false);
    setPhase("signed_out");
  }

  return (
    <AuthContext.Provider
      value={{ phase, viewer, authError, isDemo, isPlatformAdmin, refreshViewer, enterDemo, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
