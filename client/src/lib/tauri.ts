/**
 * Detect whether the app is running inside a Tauri webview.
 * Works in both Tauri v1 and v2.
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
