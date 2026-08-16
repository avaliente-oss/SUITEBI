"use client";

import { useSuite } from "@/lib/suite-context";
import { ActiveWorkspace } from "@/components/suite-ui";

export default function MesaActivaPage() {
  const { activeSolutions, focusedSolution, workspaceMode, setFocusedSolution, closeSolution, setWorkspaceMode } =
    useSuite();

  return (
    <ActiveWorkspace
      activeSolutions={activeSolutions}
      focusedSolution={focusedSolution}
      mode={workspaceMode}
      onFocus={setFocusedSolution}
      onClose={closeSolution}
      onMode={setWorkspaceMode}
    />
  );
}
