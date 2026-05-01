import type { RuntimeState } from "@shared/schema";

type DrainStatusView = {
  label: string;
  className: string;
};

export function getDrainStatusView(
  runtimeState: RuntimeState | undefined,
  isError: boolean,
): DrainStatusView {
  if (runtimeState?.drainMode) {
    return { label: "paused", className: "text-destructive" };
  }

  if (runtimeState) {
    return { label: "active", className: "text-muted-foreground" };
  }

  if (isError) {
    return { label: "unavailable", className: "text-destructive" };
  }

  return { label: "loading...", className: "text-muted-foreground" };
}

export function getDrainActionLabel(runtimeState: RuntimeState | undefined): string {
  return runtimeState?.drainMode ? "Resume" : "Pause";
}
